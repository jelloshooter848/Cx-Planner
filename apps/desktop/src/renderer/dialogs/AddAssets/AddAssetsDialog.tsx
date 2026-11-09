import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import {
  buildAddAssetsCommand,
  expandTagPattern,
  findTagProblems,
  MAX_PATTERN_TAGS,
  parseAssetRows,
  previewAddAssets,
  templateSpanDays,
  type AssetRowInput,
  type AssetSequence,
  type Project,
  type Template,
} from '@cx/core';
import type { TemplateSummary } from '../../../shared/api';
import { Modal } from '../../components/Modal';
import { TaskTypeSymbol } from '../../components/Symbols';
import { longDate, plural } from '../../format';
import { useAppState, useStore } from '../../store';
import './AddAssets.css';

/** A template from the workspace library, with its length for the picker. */
interface LibraryTemplate {
  summary: TemplateSummary;
  template: Template;
  /** Working days end to end, or null when the template cannot be laid out. */
  spanDays: number | null;
}

interface Row extends AssetRowInput {
  /** React key; stable while the row exists. */
  key: number;
}

type SequenceKind = AssetSequence['kind'];

const BLANK: AssetRowInput = { tag: '', description: '', location: '', system: '' };
const isBlank = (r: AssetRowInput) => !r.tag.trim() && !r.description.trim() && !r.location.trim() && !r.system.trim();
const MAX_STAGGER = 365;

/**
 * Edit > Add assets from template (mockup 05). Pick a template from the workspace library,
 * list the assets (typed, expanded from a tag pattern like "PNL-L1-01..12", or pasted from
 * Excel), choose when they start and how they follow each other, and see the task count
 * and finish date before adding. Adding is one `addAssetsFromTemplate` edit, so one Undo
 * takes it all back; the main process stores the template snapshot with it.
 */
export function AddAssetsDialog() {
  const store = useStore();
  const app = useAppState();
  const project = app?.project ?? null;
  const close = () => store.closeDialog();
  if (!project) return null;
  return <AddAssetsForm project={project} workspace={app?.workspacePath ?? null} onClose={close} />;
}

function AddAssetsForm({ project, workspace, onClose }: { project: Project; workspace: string | null; onClose: () => void }) {
  const store = useStore();
  const [library, setLibrary] = useState<LibraryTemplate[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [templateId, setTemplateId] = useState('');
  const nextKey = useRef(1);
  const newRow = (r: AssetRowInput = BLANK): Row => ({ ...r, key: nextKey.current++ });
  const [rows, setRows] = useState<Row[]>(() => [newRow()]);
  const [pattern, setPattern] = useState('');
  const [patternLocation, setPatternLocation] = useState('');
  const [patternSystem, setPatternSystem] = useState('');
  const [patternError, setPatternError] = useState('');
  const [pasteNote, setPasteNote] = useState('');
  const [start, setStart] = useState(project.dataDate);
  const [sequence, setSequence] = useState<SequenceKind>('together');
  const [staggerDays, setStaggerDays] = useState('5');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Load the library: the list, then each template for its tasks and length.
  useEffect(() => {
    let live = true;
    void (async () => {
      const list = await store.api.templates.list();
      if (!live) return;
      if (!list.ok) {
        setLoadError(list.message);
        setLibrary([]);
        return;
      }
      const loaded = await Promise.all(list.value.map((summary) => store.api.templates.get(summary.id).then((r) => (r.ok ? { summary, template: r.value } : null))));
      if (!live) return;
      const items = loaded
        .filter((x): x is { summary: TemplateSummary; template: Template } => x !== null)
        .map((x) => ({ ...x, spanDays: spanOf(x.template) }));
      setLibrary(items);
      setTemplateId((id) => id || (items[0]?.summary.id ?? ''));
    })().catch((e: unknown) => live && (setLoadError(e instanceof Error ? e.message : String(e)), setLibrary([])));
    return () => {
      live = false;
    };
  }, [store, workspace]);

  const chosen = library?.find((t) => t.summary.id === templateId) ?? null;
  const template = chosen?.template ?? null;

  // Rows the user has filled in; blank rows are ignored.
  const filled = useMemo(() => rows.filter((r) => !isBlank(r)), [rows]);
  const tagProblems = useMemo(() => {
    const problems = findTagProblems(project, filled.map((r) => r.tag));
    const byKey = new Map<number, string>();
    for (const [i, message] of problems) byKey.set(filled[i]!.key, message);
    return byKey;
  }, [project, filled]);

  const stagger = Number(staggerDays);
  const staggerError =
    sequence === 'stagger' && !(staggerDays.trim() !== '' && Number.isInteger(stagger) && stagger >= 0 && stagger <= MAX_STAGGER)
      ? `Stagger must be a whole number of working days from 0 to ${MAX_STAGGER}`
      : '';
  const startError = sequence === 'stagger' && start === '' ? 'Choose a start date to stagger from' : '';

  const cmd = useMemo(() => {
    if (!template || filled.length === 0 || tagProblems.size > 0 || staggerError || startError) return null;
    const seq: AssetSequence = sequence === 'stagger' ? { kind: 'stagger', days: stagger } : { kind: sequence };
    return buildAddAssetsCommand(project, { template, rows: filled, ...(start ? { startNoEarlierThan: start } : {}), sequence: seq });
  }, [project, template, filled, tagProblems, staggerError, startError, sequence, stagger, start]);
  const preview = useMemo(() => (cmd ? previewAddAssets(project, cmd) : null), [project, cmd]);

  const count = filled.length;
  const taskCount = count * (template?.tasks.length ?? 0);

  // ---- Row editing ----------------------------------------------------------------------

  const setCell = (key: number, field: keyof AssetRowInput, value: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const removeRow = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [newRow()]));

  /**
   * Puts new rows in place of row `atKey` when it is blank, else after it. With no row
   * (`null`) they go in place of a blank last row, else at the end. Other rows stay.
   */
  const insertRows = (incoming: AssetRowInput[], atKey: number | null) => {
    setRows((rs) => {
      const at = atKey === null ? rs.length - 1 : rs.findIndex((r) => r.key === atKey);
      const made = incoming.map((r) => newRow(r));
      if (at < 0) return [...rs, ...made];
      const replace = isBlank(rs[at]!);
      return [...rs.slice(0, replace ? at : at + 1), ...made, ...rs.slice(at + 1)];
    });
  };

  const addFromPattern = () => {
    let tags: string[];
    try {
      tags = expandTagPattern(pattern);
    } catch (e) {
      setPatternError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (tags.length === 0) {
      setPatternError('Type a tag or a pattern like PNL-L1-01..12');
      return;
    }
    setPatternError('');
    insertRows(tags.map((tag) => ({ ...BLANK, tag, location: patternLocation.trim(), system: patternSystem.trim() })), null);
    setPattern('');
  };

  /** Rows pasted from a sheet into a row cell (`key`) or the pattern box (`null`). */
  const onPaste = (e: ClipboardEvent<HTMLInputElement>, key: number | null) => {
    const text = e.clipboardData.getData('text/plain');
    // A plain value pastes as usual; tabs or line breaks mean rows copied from a sheet.
    if (!/[\t\n\r]/.test(text.replace(/[\r\n]+$/, ''))) return;
    e.preventDefault();
    const pasted = parseAssetRows(text);
    const room = Math.max(0, MAX_PATTERN_TAGS - rows.filter((r) => !isBlank(r)).length);
    setPasteNote(
      pasted.length > room ? `Pasted the first ${plural(room, 'row')} of ${pasted.length}: at most ${MAX_PATTERN_TAGS} assets can be added at once.` : '',
    );
    if (key === null) setPatternError('');
    const kept = pasted.slice(0, room);
    if (kept.length > 0) insertRows(kept, key);
  };

  // ---- Submit -----------------------------------------------------------------------------

  const canAdd = !!cmd && !!preview && !preview.error && !busy;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!cmd || !canAdd) return;
    setBusy(true);
    setError('');
    try {
      const r = await store.api.apply(cmd);
      if (r.ok) onClose();
      else setError(r.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  // Enter in a cell must not add the assets by accident; in the pattern box it expands it.
  const onFormKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    if (e.target.name === 'pattern') addFromPattern();
  };

  const summaryText = [plural(count, 'asset'), plural(taskCount, 'task')].join(' · ');

  return (
    <Modal title="Add assets from a template" description="Tasks, durations and links are created for each asset and appear on the Gantt." onClose={onClose} width={940} className="add-assets">
      <form className="aa-form" onSubmit={submit} onKeyDown={onFormKeyDown} noValidate>
        <div className="aa-body">
          <div className="aa-main">
            <label className="field">
              <span className="field-label">Template</span>
              <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={!library || library.length === 0}>
                {!library && <option value="">Loading…</option>}
                {library?.length === 0 && <option value="">{workspace ? 'No templates in the workspace' : 'No workspace folder chosen'}</option>}
                {library?.map((t) => (
                  <option key={t.summary.id} value={t.summary.id}>
                    {templateLabel(t)}
                  </option>
                ))}
              </select>
            </label>
            {!workspace && (
              <p className="hint aa-no-workspace">
                Templates come from the workspace folder.{' '}
                <button type="button" className="btn-link" onClick={() => void store.dispatch({ type: 'choose-workspace' })}>
                  Choose a workspace folder…
                </button>{' '}
                (File &gt; Workspace folder…)
              </p>
            )}
            {loadError && <p className="form-error" role="alert">{loadError}</p>}

            <div className="aa-quick" role="group" aria-label="Quick fill">
              <label className="field aa-pattern">
                <span className="field-label">Tag or pattern</span>
                <input
                  className="input"
                  name="pattern"
                  value={pattern}
                  placeholder="e.g. PNL-L1-01..12 or SWGR-1A..1D"
                  aria-invalid={patternError ? true : undefined}
                  onPaste={(e) => onPaste(e, null)}
                  onChange={(e) => {
                    setPattern(e.target.value);
                    setPatternError('');
                  }}
                />
              </label>
              <label className="field">
                <span className="field-label">Location</span>
                <input className="input" name="pattern-location" value={patternLocation} onChange={(e) => setPatternLocation(e.target.value)} placeholder="e.g. Elec Rm 101" />
              </label>
              <label className="field">
                <span className="field-label">System</span>
                <input className="input" name="pattern-system" value={patternSystem} onChange={(e) => setPatternSystem(e.target.value)} placeholder="e.g. Normal power" />
              </label>
              <button type="button" className="btn" onClick={addFromPattern}>
                Add rows
              </button>
            </div>
            {patternError && (
              <p className="form-error" role="alert">
                {patternError}
              </p>
            )}

            <div className="aa-rows">
              <table className="aa-table" aria-label="Assets to add">
                <thead>
                  <tr>
                    <th className="aa-n">#</th>
                    <th className="aa-c-tag">Tag</th>
                    <th>Description</th>
                    <th className="aa-c-loc">Location</th>
                    <th className="aa-c-sys">System</th>
                    <th className="aa-x">
                      <span className="visually-hidden">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const problem = tagProblems.get(r.key);
                    const problemId = `aa-problem-${r.key}`;
                    const cell = (field: keyof AssetRowInput, label: string, placeholder?: string) => (
                      <input
                        className="aa-cell"
                        value={r[field]}
                        aria-label={`${label}, row ${i + 1}`}
                        placeholder={placeholder}
                        aria-invalid={field === 'tag' && problem ? true : undefined}
                        aria-describedby={field === 'tag' && problem ? problemId : undefined}
                        onChange={(e) => setCell(r.key, field, e.target.value)}
                        onPaste={(e) => onPaste(e, r.key)}
                      />
                    );
                    return (
                      <tr key={r.key} className={problem ? 'aa-bad' : undefined}>
                        <td className="aa-n">
                          {problem ? (
                            <span className="aa-flag" title={problem}>
                              !<span id={problemId} className="visually-hidden">{problem}</span>
                            </span>
                          ) : (
                            i + 1
                          )}
                        </td>
                        <td>{cell('tag', 'Tag')}</td>
                        <td>{cell('description', 'Description', template?.assetDescription)}</td>
                        <td>{cell('location', 'Location')}</td>
                        <td>{cell('system', 'System')}</td>
                        <td className="aa-x">
                          <button type="button" className="btn btn-quiet aa-remove" aria-label={`Remove row ${i + 1}`} onClick={() => removeRow(r.key)}>
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="aa-rows-foot">
              <button type="button" className="btn-link" onClick={() => setRows((rs) => [...rs, newRow()])}>
                + Add row
              </button>
              <span className="hint">Paste rows from Excel (Tag, Description, Location, System) into any cell.</span>
            </div>
            {template?.assetDescription && (
              <p className="hint aa-default-desc">
                Blank descriptions use: <span className="aa-default-text">{template.assetDescription}</span>
              </p>
            )}
            {pasteNote && (
              <p className="form-error" role="status">
                {pasteNote}
              </p>
            )}
            <div aria-live="polite">
              {tagProblems.size > 0 && (
                <ul className="aa-problems" aria-label="Tag problems">
                  {[...new Set(tagProblems.values())].map((m) => (
                    <li key={m}>
                      <span className="aa-flag" aria-hidden="true">!</span> {m}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="aa-when">
              <label className="field">
                <span className="field-label">Start no earlier than</span>
                <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={startError ? true : undefined} />
              </label>
              <fieldset className="aa-seq">
                <legend className="field-label">Order</legend>
                <label>
                  <input type="radio" name="sequence" checked={sequence === 'together'} onChange={() => setSequence('together')} /> All start together
                </label>
                <label>
                  <input type="radio" name="sequence" checked={sequence === 'follow'} onChange={() => setSequence('follow')} /> Each follows the previous asset
                </label>
                <label>
                  <input type="radio" name="sequence" checked={sequence === 'stagger'} onChange={() => setSequence('stagger')} /> Stagger starts by
                  <input
                    className="input aa-days"
                    type="number"
                    min={0}
                    max={MAX_STAGGER}
                    value={staggerDays}
                    aria-label="Stagger days"
                    aria-invalid={staggerError ? true : undefined}
                    onChange={(e) => {
                      setStaggerDays(e.target.value);
                      setSequence('stagger');
                    }}
                  />
                  working days
                </label>
              </fieldset>
            </div>
            {(staggerError || startError) && (
              <p className="form-error" role="alert">
                {staggerError || startError}
              </p>
            )}
          </div>

          <aside className="aa-side" aria-label="Tasks per asset">
            <h3 className="section-label aa-side-title">Tasks per asset</h3>
            {template ? (
              <>
                <ul className="aa-tasks">
                  {template.tasks.map((t) => (
                    <li key={t.key}>
                      <span className="aa-task-name">
                        <TaskTypeSymbol type={t.type} />
                        {t.name}
                      </span>
                      <span className="muted">{t.type === 'milestone' ? 'Milestone' : `${t.durationDays} d`}</span>
                    </li>
                  ))}
                </ul>
                <p className="hint aa-span">
                  {chosen?.spanDays !== null && chosen?.spanDays !== undefined ? `${plural(chosen.spanDays, 'working day')} per asset. ` : ''}You can edit any task after it is added.
                </p>
              </>
            ) : (
              <p className="hint">{library ? 'Choose a template.' : 'Loading templates…'}</p>
            )}
            <h3 className="section-label">Preview</h3>
            <dl className="aa-preview" aria-label="Preview">
              <dt>Assets</dt>
              <dd>{count}</dd>
              <dt>Tasks</dt>
              <dd>{taskCount}</dd>
              <dt>New assets finish</dt>
              <dd>{preview?.finish ? longDate(preview.finish) : '—'}</dd>
              <dt>Project finish</dt>
              <dd>{preview?.projectFinish ? longDate(preview.projectFinish) : '—'}</dd>
            </dl>
            {preview?.error && (
              <p className="form-error" role="alert">
                {preview.error}
              </p>
            )}
          </aside>
        </div>

        <footer className="aa-foot">
          <span className="aa-summary" data-testid="add-assets-summary">
            {summaryText}
            {preview?.finish ? ` · finish ${longDate(preview.finish)}` : ''}
          </span>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!canAdd}>
              {count > 0 ? `Add ${plural(count, 'asset')}` : 'Add assets'}
            </button>
          </div>
        </footer>
      </form>
    </Modal>
  );
}

function spanOf(t: Template): number | null {
  try {
    return templateSpanDays(t);
  } catch {
    return null;
  }
}

/** "Panelboard / distribution — 4 tasks · 3 d". */
function templateLabel(t: LibraryTemplate): string {
  const parts = [plural(t.summary.taskCount, 'task')];
  if (t.spanDays !== null) parts.push(`${t.spanDays} d`);
  return `${t.summary.name} — ${parts.join(' · ')}`;
}
