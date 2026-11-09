import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { PAPER, type PaperId } from '@cx/render';
import type { Asset, Id } from '@cx/core';
import {
  FULL_SCHEDULE_PAPERS,
  LOOK_AHEAD_PAPERS,
  LOOK_AHEAD_WEEKS,
  PRINT_KINDS,
  type ChecklistTaskSummary,
  type PrintKind,
  type PrintPreview,
  type PrintSetup,
} from '../../../shared/api';
import { Modal } from '../../components/Modal';
import { longDate, plural, shortDate } from '../../format';
import { useAssetFilter, useProject, useSelect, useStore } from '../../store';
import { DAY_WIDTHS, defaultSettings, fitScale, KIND_LABELS, lookAheadStarts, printRequest, type AssetScope, type PrintSettings } from './print-options';
import './Print.css';

const PX_PER_IN = 96;
/** Wait this long after the last change before laying the preview out again. */
const PREVIEW_DELAY_MS = 250;

const paperLabel = (id: PaperId) => `${PAPER[id].label} (${PAPER[id].widthIn} × ${PAPER[id].heightIn} in)`;

/**
 * File > Print / Export PDF. Three kinds of print: a look-ahead (Letter or Tabloid), the full
 * schedule (large format) and blank test sheets (Letter, one per task with a checklist).
 * Each kind counts its own revisions from the project's print records: the dialog shows the
 * letter the print will get, the issued date (the data date) and a note for the revision.
 *
 * The preview is the same HTML the PDF is made from, laid out by the main process and shown
 * one sheet at a time in a sandboxed iframe scaled to fit. Exporting asks where to save,
 * writes the PDF and records the print, which moves the revision on to the next letter.
 */
export function PrintDialog() {
  const store = useStore();
  const info = useProject();
  const [setup, setSetup] = useState<PrintSetup | null>(null);
  const [error, setError] = useState('');
  const project = info?.project;
  const filePath = info?.filePath;

  useEffect(() => {
    let live = true;
    void store.api.print.setup().then((r) => {
      if (!live) return;
      if (r.ok) setSetup(r.value);
      else setError(r.message);
    });
    return () => {
      live = false;
    };
  }, [store, filePath]);

  const close = () => store.closeDialog();
  if (!project) return null;
  return (
    <Modal title="Print / Export PDF" onClose={close} className="print-dialog" width={1180} description={`${project.name} · data date ${longDate(project.dataDate)}`}>
      {setup ? (
        <PrintForm key={filePath} setup={setup} assets={project.assets} onSetup={setSetup} onClose={close} />
      ) : (
        <div className="pd-loading">{error ? <p className="form-error" role="alert">{error}</p> : <p className="hint">Loading…</p>}</div>
      )}
    </Modal>
  );
}

interface FormProps {
  setup: PrintSetup;
  assets: Asset[];
  onSetup(setup: PrintSetup): void;
  onClose(): void;
}

/** The kind switcher: a radio group with a roving tabindex, so arrow keys move between kinds. */
function KindChoice({ value, onChange }: { value: PrintKind; onChange(kind: PrintKind): void }) {
  const refs = useRef(new Map<PrintKind, HTMLButtonElement>());
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const i = PRINT_KINDS.indexOf(value);
    const next = PRINT_KINDS[(i + step + PRINT_KINDS.length) % PRINT_KINDS.length]!;
    onChange(next);
    refs.current.get(next)?.focus();
  };
  return (
    <div className="seg pd-kinds" role="radiogroup" aria-label="Kind of print" onKeyDown={onKeyDown}>
      {PRINT_KINDS.map((k) => (
        <button
          key={k}
          ref={(el) => {
            if (el) refs.current.set(k, el);
            else refs.current.delete(k);
          }}
          type="button"
          role="radio"
          aria-checked={value === k}
          tabIndex={value === k ? 0 : -1}
          className="btn"
          onClick={() => onChange(k)}
        >
          {KIND_LABELS[k]}
        </button>
      ))}
    </div>
  );
}

function PrintForm({ setup, assets, onSetup, onClose }: FormProps) {
  const store = useStore();
  const kind = useSelect((s) => s.ui.printKind);
  // The Schedule sidebar's asset filter; "Current asset filter" is offered while one is set.
  const filter = useAssetFilter();
  // The look-ahead starts at the window shaded on the Schedule (its toolbar's Look-ahead weeks).
  const weeks = useSelect((s) => s.ui.lookAheadWeeks);
  const [settings, setSettings] = useState<PrintSettings>(() => defaultSettings(setup.dataDate, setup.checklistTasks.map((t) => t.taskId), filter !== null, weeks));
  const [preview, setPreview] = useState<PrintPreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [updating, setUpdating] = useState(false);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<'pdf' | 'printer' | null>(null);
  const [saved, setSaved] = useState<{ path: string; rev: string; notRecorded?: string } | null>(null);
  const [status, setStatus] = useState('');

  const request = useMemo(() => printRequest(kind, settings, filter), [kind, settings, filter]);
  const requestKey = JSON.stringify(request);
  const history = useMemo(() => setup.history.filter((h) => h.kind === kind), [setup, kind]);
  const nextRev = setup.nextRevision[kind];

  // Lay the preview out again shortly after the last change (typing a note, ticking tasks).
  useEffect(() => {
    let live = true;
    setUpdating(true);
    const timer = setTimeout(() => {
      void store.api.print.preview(request).then((r) => {
        if (!live) return;
        setUpdating(false);
        if (r.ok) {
          setPreview(r.value);
          setPreviewError('');
          setPage((p) => Math.min(Math.max(1, p), r.value.sheets));
        } else {
          setPreview(null);
          setPreviewError(r.message);
        }
      });
    }, PREVIEW_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // requestKey stands for request (a new object every render); nextRev refreshes the
    // revision block after an export.
  }, [store, requestKey, nextRev]);

  // A different kind starts on its first sheet, and the last export's message no longer applies.
  useEffect(() => {
    setPage(1);
    setSaved(null);
    setStatus('');
  }, [kind]);

  const refreshSetup = async () => {
    const r = await store.api.print.setup();
    if (r.ok) onSetup(r.value);
  };

  const exportPdf = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || !preview) return;
    setBusy('pdf');
    setStatus('');
    try {
      const r = await store.run(() => store.api.print.exportPdf(request));
      if (r.ok) {
        setSaved({ path: r.value.filePath, rev: r.value.rev, notRecorded: r.value.notRecorded });
        setSettings((s) => ({ ...s, note: '' }));
        await refreshSetup();
      }
    } finally {
      setBusy(null);
    }
  };

  const toPrinter = async () => {
    if (busy || !preview) return;
    setBusy('printer');
    setSaved(null);
    try {
      const r = await store.run(() => store.api.print.toPrinter(request));
      if (r.ok) {
        setStatus(`Rev ${r.value.rev} sent to the printer (${plural(r.value.sheets, 'sheet')}).`);
        setSettings((s) => ({ ...s, note: '' }));
        await refreshSetup();
      }
    } finally {
      setBusy(null);
    }
  };

  const set = <K extends 'lookAhead' | 'fullSchedule' | 'testSheets'>(key: K, patch: Partial<PrintSettings[K]>) =>
    setSettings((s) => ({ ...s, [key]: { ...s[key], ...patch } }));

  return (
    <form className="pd-form" onSubmit={(e) => void exportPdf(e)}>
      <div className="pd-body">
        <div className="pd-options">
          <KindChoice value={kind} onChange={(k) => store.setPrintKind(k)} />

          {kind === 'lookahead' && (
            <fieldset className="pd-group">
              <legend className="section-label">Look-ahead</legend>
              <label className="field">
                <span className="field-label">Weeks</span>
                <select className="input" name="weeks" value={settings.lookAhead.weeks} onChange={(e) => set('lookAhead', { weeks: Number(e.target.value) as PrintSettings['lookAhead']['weeks'] })}>
                  {LOOK_AHEAD_WEEKS.map((w) => (
                    <option key={w} value={w}>
                      {w} weeks
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Starting</span>
                <select className="input" name="start" value={settings.lookAhead.start} onChange={(e) => set('lookAhead', { start: e.target.value })}>
                  {lookAheadStarts(setup.dataDate).map(([d, label]) => (
                    <option key={d} value={d}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <PaperChoice name="la-paper" papers={LOOK_AHEAD_PAPERS} value={settings.lookAhead.paper} onChange={(paper) => set('lookAhead', { paper })} />
              <AssetChoice name="la-assets" value={settings.lookAhead.assets} total={assets.length} filter={filter} onChange={(a) => set('lookAhead', { assets: a })} />
              <label className="pd-check">
                <input type="checkbox" name="show-times" checked={settings.lookAhead.showTimes} onChange={(e) => set('lookAhead', { showTimes: e.target.checked })} /> Show TIMES readiness columns
              </label>
            </fieldset>
          )}

          {kind === 'full-schedule' && (
            <fieldset className="pd-group">
              <legend className="section-label">Full schedule</legend>
              <PaperChoice name="fs-paper" papers={FULL_SCHEDULE_PAPERS} value={settings.fullSchedule.paper} onChange={(paper) => set('fullSchedule', { paper })} />
              <label className="field">
                <span className="field-label">Day width</span>
                <select
                  className="input"
                  name="day-width"
                  value={String(settings.fullSchedule.dayWidthIn)}
                  onChange={(e) => set('fullSchedule', { dayWidthIn: e.target.value === 'null' ? null : Number(e.target.value) })}
                >
                  {DAY_WIDTHS.map(([w, label]) => (
                    <option key={String(w)} value={String(w)}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <AssetChoice name="fs-assets" value={settings.fullSchedule.assets} total={assets.length} filter={filter} onChange={(a) => set('fullSchedule', { assets: a })} />
            </fieldset>
          )}

          {kind === 'test-sheets' && (
            <TestSheetChoice tasks={setup.checklistTasks} assets={assets} chosen={settings.testSheets.taskIds} onChange={(taskIds) => set('testSheets', { taskIds })} />
          )}

          <fieldset className="pd-group pd-revision">
            <legend className="section-label">Revision</legend>
            <dl className="pd-rev">
              <div>
                <dt>Revision</dt>
                <dd data-testid="print-revision">{nextRev}</dd>
              </div>
              <div>
                <dt>Issued</dt>
                <dd>{longDate(setup.dataDate)}</dd>
              </div>
            </dl>
            <label className="field">
              <span className="field-label">Note for this revision</span>
              <input
                className="input"
                name="note"
                maxLength={200}
                value={settings.note}
                placeholder={history.length === 0 ? 'e.g. Issued for coordination' : 'e.g. Progress update'}
                onChange={(e) => setSettings((s) => ({ ...s, note: e.target.value }))}
              />
            </label>
            {history.length > 0 ? (
              <ol className="pd-history" aria-label="Earlier revisions">
                {history
                  .slice(-6)
                  .reverse()
                  .map((h) => (
                    <li key={h.id}>
                      <b>{h.rev}</b> · {shortDate(h.issued)} · {h.note || 'Issued'}
                      <span className="muted">
                        {' '}
                        · {PAPER[h.paper as PaperId]?.label ?? h.paper}, {plural(h.sheets, 'sheet')}
                      </span>
                    </li>
                  ))}
              </ol>
            ) : (
              <p className="hint">First issue of this print.</p>
            )}
          </fieldset>
        </div>

        <SheetPreview preview={preview} error={previewError} updating={updating} page={page} onPage={setPage} />
      </div>

      <footer className="pd-foot">
        <div className="pd-status" role="status">
          {saved && (
            <>
              <span className="pd-saved" title={saved.path}>
                Saved Rev {saved.rev}: {saved.path}
                {saved.notRecorded && ` (not recorded: ${saved.notRecorded})`}
              </span>
              <button type="button" className="btn btn-quiet" onClick={() => void store.run(() => store.api.print.showInFolder(saved.path))}>
                Open folder
              </button>
            </>
          )}
          {status && <span>{status}</span>}
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn" disabled={!preview || busy !== null} onClick={() => void toPrinter()}>
            {busy === 'printer' ? 'Printing…' : 'Print…'}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!preview || busy !== null}>
            {busy === 'pdf' ? 'Exporting…' : `Export PDF (Rev ${nextRev})`}
          </button>
        </div>
      </footer>
    </form>
  );
}

function PaperChoice<P extends PaperId>({ name, papers, value, onChange }: { name: string; papers: readonly P[]; value: P; onChange(p: P): void }) {
  return (
    <fieldset className="pd-radios">
      <legend className="field-label">Paper</legend>
      {papers.map((p) => (
        <label key={p}>
          <input type="radio" name={name} checked={value === p} onChange={() => onChange(p)} /> {paperLabel(p)}
        </label>
      ))}
    </fieldset>
  );
}

function AssetChoice({ name, value, total, filter, onChange }: { name: string; value: AssetScope; total: number; filter: Id[] | null; onChange(a: AssetScope): void }) {
  // With no filter set, "all" is the only choice whatever was chosen before.
  const effective = filter ? value : 'all';
  return (
    <fieldset className="pd-radios">
      <legend className="field-label">Assets</legend>
      <label>
        <input type="radio" name={name} checked={effective === 'all'} onChange={() => onChange('all')} /> All assets ({total})
      </label>
      <label className={filter ? undefined : 'muted'}>
        <input type="radio" name={name} checked={effective === 'filter'} disabled={!filter} onChange={() => onChange('filter')} /> Current asset filter
        {filter ? ` (${filter.length})` : ' (none set)'}
      </label>
    </fieldset>
  );
}

function TestSheetChoice({ tasks, assets, chosen, onChange }: { tasks: ChecklistTaskSummary[]; assets: Asset[]; chosen: Id[]; onChange(ids: Id[]): void }) {
  const picked = useMemo(() => new Set(chosen), [chosen]);
  const groups = useMemo(() => {
    const byAsset = new Map<Id, ChecklistTaskSummary[]>();
    for (const t of tasks) byAsset.set(t.assetId, [...(byAsset.get(t.assetId) ?? []), t]);
    return assets.filter((a) => byAsset.has(a.id)).map((a) => ({ asset: a, tasks: byAsset.get(a.id)! }));
  }, [tasks, assets]);
  // Keep schedule order whatever order boxes are ticked in.
  const setPicked = (next: Set<Id>) => onChange(tasks.filter((t) => next.has(t.taskId)).map((t) => t.taskId));
  const toggle = (ids: Id[], on: boolean) => {
    const next = new Set(picked);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setPicked(next);
  };
  if (tasks.length === 0) {
    return (
      <div className="pd-group">
        <h3 className="section-label">Test sheets</h3>
        <p className="hint">No tasks have checklists yet. Tasks added from a template whose steps have checklist items get a test sheet.</p>
      </div>
    );
  }
  return (
    <fieldset className="pd-group">
      <legend className="section-label">Test sheets · Letter</legend>
      <div className="pd-pick-actions">
        <span className="muted">
          {chosen.length} of {plural(tasks.length, 'task')}
        </span>
        <button type="button" className="btn-link" onClick={() => setPicked(new Set(tasks.map((t) => t.taskId)))}>
          Select all
        </button>
        <button type="button" className="btn-link" onClick={() => setPicked(new Set())}>
          Clear
        </button>
      </div>
      <ul className="pd-tasks" aria-label="Tasks with checklists">
        {groups.map(({ asset, tasks: ts }) => {
          const n = ts.filter((t) => picked.has(t.taskId)).length;
          return (
            <li key={asset.id}>
              <IndeterminateCheckbox
                label={
                  <>
                    <b>{asset.tag}</b> <span className="muted">{asset.description}</span>
                  </>
                }
                checked={n === ts.length}
                indeterminate={n > 0 && n < ts.length}
                onChange={(on) => toggle(ts.map((t) => t.taskId), on)}
              />
              <ul>
                {ts.map((t) => (
                  <li key={t.taskId}>
                    <label className="pd-check pd-task">
                      <input type="checkbox" checked={picked.has(t.taskId)} onChange={(e) => toggle([t.taskId], e.target.checked)} />
                      <span className="pd-code">{t.code}</span>
                      <span>
                        {t.name}
                        <span className="muted"> · {plural(t.items, 'item')}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function IndeterminateCheckbox({ label, checked, indeterminate, onChange }: { label: ReactNode; checked: boolean; indeterminate: boolean; onChange(on: boolean): void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className="pd-check pd-asset">
      <input ref={ref} type="checkbox" checked={checked} aria-checked={indeterminate ? 'mixed' : checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

/**
 * The preview iframe is a separate document and cannot see the page's CSS, so the sheet frame
 * and the "one sheet at a time" rule are injected into it.
 */
function frameCss(page: number): string {
  const tokens = getComputedStyle(document.documentElement);
  const shadow = tokens.getPropertyValue('--shadow-sheet').trim();
  return `html,body{background:transparent!important;overflow:hidden}.sheet{display:none;box-shadow:${shadow}}.sheet[data-sheet="${page}"]{display:block}`;
}

function SheetPreview({ preview, error, updating, page, onPage }: { preview: PrintPreview | null; error: string; updating: boolean; page: number; onPage(p: number): void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const w = (preview?.widthIn ?? 0) * PX_PER_IN;
  const h = (preview?.heightIn ?? 0) * PX_PER_IN;
  const scale = fitScale(w, h, box.w - 32, box.h - 32);
  const srcDoc = useMemo(() => (preview ? preview.html.replace('</style>', `${frameCss(page)}</style>`) : ''), [preview, page]);
  const sheets = preview?.sheets ?? 0;

  return (
    <section className="pd-preview" aria-label="Preview">
      <div className="pd-preview-bar">
        <span className="pd-preview-title">{preview ? preview.title : 'Preview'}</span>
        <span className="muted" data-testid="print-sheet-count">
          {preview ? `${plural(sheets, 'sheet')} · ${preview.widthIn} × ${preview.heightIn} in` : ''}
        </span>
        <span className="toolbar-spacer" />
        {updating && <span className="muted small">Updating…</span>}
        <div className="seg" role="group" aria-label="Sheet">
          <button type="button" className="btn" aria-label="Previous sheet" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            ‹
          </button>
          <span className="pd-page" aria-live="polite">
            Sheet {sheets ? page : 0} of {sheets}
          </span>
          <button type="button" className="btn" aria-label="Next sheet" disabled={page >= sheets} onClick={() => onPage(page + 1)}>
            ›
          </button>
        </div>
      </div>
      <div className="pd-preview-box" ref={boxRef}>
        {error && (
          <p className="pd-preview-msg" role="alert">
            {error}
          </p>
        )}
        {preview && !error && (
          <div className="pd-sheet" style={{ width: w * scale, height: h * scale }}>
            <iframe
              title={`Sheet ${page} of ${sheets}`}
              sandbox=""
              srcDoc={srcDoc}
              style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: 'top left' }}
            />
          </div>
        )}
      </div>
    </section>
  );
}
