import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addTemplateTask, blankTemplate, previewTemplate, type Template } from '@cx/core';
import type { TemplateSummary } from '../../../shared/api';
import { Modal } from '../../components/Modal';
import { plural } from '../../format';
import { useAppState, useStore } from '../../store';
import { assetsUsing, cleanTemplate, countWord, sameTemplate, templateProblems, uniqueName } from './editor-model';
import { ListEditor } from './ListEditor';
import { ReapplyDialog } from './ReapplyDialog';
import { TaskProperties } from './TaskProperties';
import { TaskTable } from './TaskTable';
import { TemplatePreview } from './TemplatePreview';
import './templates.css';

interface Draft {
  /** The template as stored in the workspace. */
  base: Template;
  /** What the editor shows; differs from base until saved. */
  draft: Template;
  selectedKey: string | null;
}

/**
 * The unsaved draft survives leaving the Templates view (it is kept until the window
 * closes), so switching to the schedule and back loses nothing. One per window.
 */
let kept: Draft | null = null;
/** The workspace `kept` belongs to. */
let keptWorkspace: string | null = null;

/** A pending step that would drop unsaved changes, waiting for the user to choose. */
interface Pending {
  what: string;
  run: () => Promise<void> | void;
}

/**
 * Templates view (mockup 02): the library on the left, the selected template's task table
 * and schedule preview in the middle, the selected task's properties on the right.
 * Templates live in the workspace (window.cx.templates); edits are a local draft until Save.
 */
export function TemplatesView() {
  const store = useStore();
  const app = useAppState();
  const api = store.api.templates;
  const [list, setList] = useState<TemplateSummary[] | null>(null);
  const workspace = app?.workspacePath ?? null;
  const [doc, setDocState] = useState<Draft | null>(() => (keptWorkspace === workspace ? kept : null));
  const [pending, setPending] = useState<Pending | null>(null);
  const [reapplying, setReapplying] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const problemsRef = useRef<HTMLDivElement>(null);
  const project = app?.project ?? null;

  const setDoc = useCallback(
    (d: Draft | null) => {
      kept = d;
      keptWorkspace = workspace;
      setDocState(d);
    },
    [workspace],
  );
  const dirty = doc !== null && !sameTemplate(doc.base, doc.draft);

  const refresh = useCallback(async () => {
    const r = await store.run(() => api.list());
    setList(r.ok ? r.value : []);
    return r.ok ? r.value : [];
  }, [store, api]);

  const open = useCallback(
    async (id: string) => {
      const r = await store.run(() => api.get(id));
      if (!r.ok) return;
      setDoc({ base: r.value, draft: r.value, selectedKey: r.value.tasks[0]?.key ?? null });
      setShowProblems(false);
      setMessage('');
    },
    [store, api, setDoc],
  );

  // Load the library (again when the workspace changes) and open a template.
  useEffect(() => {
    let live = true;
    void refresh().then((items) => {
      if (!live) return;
      if (kept && keptWorkspace === workspace && items.some((t) => t.id === kept!.base.id)) {
        setDocState(kept);
        return;
      }
      const first = items[0];
      if (first) void open(first.id);
      else setDoc(null);
    });
    return () => {
      live = false;
    };
  }, [workspace, refresh, open, setDoc]);

  /** Runs `step` now, or after asking when it would drop unsaved changes. */
  const guard = (what: string, step: () => Promise<void> | void) => {
    if (dirty) setPending({ what, run: step });
    else void step();
  };

  // From `kept`, which setDoc updates at once, so two changes in one event (remove a row,
  // then select its neighbour) both land.
  const edit = (draft: Template) => kept && setDoc({ ...kept, draft });
  const select = (selectedKey: string | null) => kept && setDoc({ ...kept, selectedKey });

  const problems = useMemo(() => (doc ? templateProblems(doc.draft) : []), [doc]);
  const problemKeys = useMemo(() => new Set(problems.flatMap((p) => (p.taskKey ? [p.taskKey] : []))), [problems]);
  const preview = useMemo(() => (doc ? previewTemplate(cleanTemplate(doc.draft)) : null), [doc]);

  const save = async (): Promise<boolean> => {
    if (!doc) return false;
    if (problems.length > 0) {
      setShowProblems(true);
      requestAnimationFrame(() => problemsRef.current?.focus());
      return false;
    }
    setBusy(true);
    const r = await store.run(() => api.save(cleanTemplate(doc.draft)));
    setBusy(false);
    if (!r.ok) return false;
    const selectedKey = r.value.tasks.some((t) => t.key === doc.selectedKey) ? doc.selectedKey : (r.value.tasks[0]?.key ?? null);
    setDoc({ base: r.value, draft: r.value, selectedKey });
    setShowProblems(false);
    setMessage(`Saved as version ${r.value.version}`);
    await refresh();
    return true;
  };

  const names = list?.map((t) => t.name) ?? [];

  const duplicate = async () => {
    if (!doc) return;
    const name = uniqueName(`${doc.draft.name.trim() || 'Template'} (copy)`, names);
    // A clean template is copied in the workspace (logged as a duplicate); unsaved edits are saved into the copy.
    const r = dirty
      ? await store.run(() => api.save({ ...cleanTemplate(doc.draft), id: newTemplateId(), name, kind: 'custom', version: 1 }))
      : await store.run(() => api.duplicate(doc.base.id, name));
    if (!r.ok) return;
    await refresh();
    setDoc({ base: r.value, draft: r.value, selectedKey: r.value.tasks[0]?.key ?? null });
    setMessage(
      dirty ? `Copied with your unsaved changes into ${r.value.name}; ${doc.base.name} is unchanged` : `Duplicated as ${r.value.name}`,
    );
  };

  const newTemplate = async () => {
    const r = await store.run(() => api.save(blankTemplate(newTemplateId(), uniqueName('New template', names))));
    if (!r.ok) return;
    await refresh();
    setDoc({ base: r.value, draft: r.value, selectedKey: null });
    setMessage('');
  };

  const importFile = async () => {
    const r = await store.run(() => api.import());
    if (!r.ok) return;
    await refresh();
    setDoc({ base: r.value.template, draft: r.value.template, selectedKey: r.value.template.tasks[0]?.key ?? null });
    setMessage(
      r.value.idChanged
        ? `Imported ${r.value.template.name} as a new template (its id was already in use)`
        : `Imported ${r.value.template.name}`,
    );
  };

  const exportFile = async () => {
    if (!doc) return;
    const r = await store.run(() => api.export(doc.base.id));
    if (r.ok) setMessage(`Exported to ${r.value.filePath}`);
  };

  const addTask = () => {
    if (!doc) return;
    const at = doc.selectedKey ? doc.draft.tasks.findIndex((t) => t.key === doc.selectedKey) : undefined;
    const { template, key } = addTemplateTask(doc.draft, {}, at);
    setDoc({ ...doc, draft: template, selectedKey: key });
  };

  const starters = list?.filter((t) => t.kind === 'starter') ?? [];
  const custom = list?.filter((t) => t.kind === 'custom') ?? [];
  const group = (title: string, items: TemplateSummary[]) => (
    <>
      <h2 className="section-label">{title}</h2>
      <ul className="side-list" aria-label={title}>
        {items.map((t) => {
          const current = doc?.base.id === t.id;
          return (
            <li key={t.id}>
              <button
                type="button"
                className={`side-item side-button${current ? ' is-current' : ''}`}
                aria-current={current ? 'true' : undefined}
                onClick={() => !current && guard(`open ${t.name}`, () => open(t.id))}
              >
                <span className="side-name">{t.name}</span>
                <span className="muted small">{plural(t.taskCount, 'task')}</span>
              </button>
            </li>
          );
        })}
        {items.length === 0 && <li className="side-item muted">None</li>}
      </ul>
    </>
  );

  const users = doc ? assetsUsing(project?.assets, doc.base.id) : [];
  const selectedIndex = doc?.selectedKey ? doc.draft.tasks.findIndex((t) => t.key === doc.selectedKey) : -1;
  const selectedTask = selectedIndex >= 0 ? doc!.draft.tasks[selectedIndex] : undefined;
  const span = preview?.ok ? plural(preview.spanDays, 'working day') : 'span unknown';

  return (
    <div className="view view-split tpl-view" aria-label="Templates">
      <aside className="sidebar tpl-library" aria-label="Template library">
        <div className="tpl-library-lists">
          {list === null ? (
            <p className="hint pad">Loading…</p>
          ) : (
            <>
              {group('Starter templates', starters)}
              {group('My templates', custom)}
            </>
          )}
        </div>
        <div className="tpl-library-foot">
          <button
            type="button"
            className="btn btn-primary tpl-wide"
            disabled={!workspace}
            onClick={() => guard('create a new template', newTemplate)}
          >
            New template
          </button>
          <button type="button" className="btn tpl-wide" disabled={!workspace} onClick={() => guard('import a template', importFile)}>
            Import template file…
          </button>
          <p className="hint">Starters are editable copies. Edit them, duplicate them, or build your own from scratch.</p>
          {!project && (
            <button type="button" className="btn-link" onClick={() => guard('leave the template editor', () => store.setView('schedule'))}>
              Back to start page
            </button>
          )}
        </div>
      </aside>

      {!doc ? (
        <main className="view-main">
          <div className="empty">
            <h2>Templates</h2>
            <p className="hint">
              {list && list.length === 0 ? 'The library is empty. Create a template or import one.' : 'Choose a template on the left.'}
            </p>
          </div>
        </main>
      ) : (
        <>
          <main className="view-main tpl-main" aria-label="Template editor">
            <header className="tpl-head">
              <div className="tpl-title">
                <input
                  className="tpl-name"
                  aria-label="Template name"
                  value={doc.draft.name}
                  onChange={(e) => edit({ ...doc.draft, name: e.target.value })}
                />
                <p className="hint" data-testid="template-summary">
                  {doc.base.kind === 'starter' ? 'Starter template' : 'My template'} · {plural(doc.draft.tasks.length, 'task')} · {span}
                  {project ? ` · used by ${plural(users.length, 'asset')}` : ''} · v{doc.base.version}
                  {dirty && <b className="tpl-unsaved"> · Unsaved changes</b>}
                </p>
              </div>
              <div className="tpl-actions">
                {dirty && (
                  <button type="button" className="btn btn-quiet" onClick={() => setDoc({ ...doc, draft: doc.base })}>
                    Discard changes
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void duplicate()}
                  title={dirty ? 'Copies what is shown, unsaved changes included, into a new template' : undefined}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || dirty}
                  onClick={() => void exportFile()}
                  title={dirty ? 'Save first: the file holds the saved template' : undefined}
                >
                  Export template file
                </button>
                <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={() => void save()}>
                  Save
                </button>
              </div>
            </header>
            {message && (
              <p className="hint tpl-message" role="status">
                {message}
              </p>
            )}

            <TaskTable
              template={doc.draft}
              selectedKey={doc.selectedKey}
              problemKeys={problemKeys}
              onSelect={select}
              onChange={edit}
              onAdd={addTask}
            />

            {problems.length > 0 && (
              <div
                ref={problemsRef}
                tabIndex={-1}
                className={`tpl-problems${showProblems ? ' is-shown' : ''}`}
                role={showProblems ? 'alert' : 'status'}
                aria-label="Problems to fix before saving"
              >
                <b>
                  <span className="conflict-mark" aria-hidden="true">
                    !
                  </span>
                  {showProblems ? 'Fix these before saving:' : `${plural(problems.length, 'problem')} to fix before saving:`}
                </b>
                <ul>
                  {problems.map((p, i) => (
                    <li key={i}>
                      {p.taskKey ? (
                        <button type="button" className="btn-link" onClick={() => select(p.taskKey!)}>
                          {p.message}
                        </button>
                      ) : (
                        p.message
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview && <TemplatePreview preview={preview} selectedKey={doc.selectedKey} />}

            <section className="panel tpl-details" aria-label="Template details">
              <h2 className="section-label">Template details</h2>
              <label className="field">
                <span className="field-label">What it is for</span>
                <input
                  className="input"
                  value={doc.draft.assetDescription}
                  placeholder="e.g. Low-voltage switchgear lineup"
                  onChange={(e) => edit({ ...doc.draft, assetDescription: e.target.value })}
                />
              </label>
              <div className="tpl-details-lists">
                <div>
                  <h3 className="field-label tpl-props-sub">Install stages, in order</h3>
                  <ListEditor<string>
                    label="Stage"
                    noun="stage"
                    items={doc.draft.stages}
                    onChange={(stages) => edit({ ...doc.draft, stages })}
                    text={(s) => s}
                    withText={(_s, t) => t}
                    create={() => ''}
                    addLabel="Add stage"
                    placeholder="e.g. Delivered"
                  />
                </div>
                <div>
                  <h3 className="field-label tpl-props-sub">Required turnover documents</h3>
                  <ListEditor<string>
                    label="Document"
                    noun="document"
                    items={doc.draft.requiredDocs}
                    onChange={(requiredDocs) => edit({ ...doc.draft, requiredDocs })}
                    text={(s) => s}
                    withText={(_s, t) => t}
                    create={() => ''}
                    addLabel="Add document"
                    placeholder="e.g. Test report"
                  />
                </div>
              </div>
            </section>
          </main>

          <aside className="tpl-side" aria-label="Task details">
            {selectedTask ? (
              <TaskProperties template={doc.draft} task={selectedTask} index={selectedIndex} onChange={edit} />
            ) : (
              <p className="hint">Select a task in the table to edit its properties.</p>
            )}
            <div className="tpl-reapply" data-testid="reapply-note">
              <p>
                Changes apply to <b>new assets</b> only.{' '}
                {project ? (
                  <>{users.length === 1 ? 'One existing asset uses' : `${countWord(users.length)} existing assets use`} this template.</>
                ) : (
                  'Open a project to re-apply it to existing assets.'
                )}
              </p>
              <button
                type="button"
                className="btn"
                disabled={!project || users.length === 0 || dirty}
                title={dirty ? 'Save first: the saved template is what gets re-applied' : undefined}
                onClick={() => setReapplying(true)}
              >
                Re-apply to existing assets…
              </button>
            </div>
          </aside>
        </>
      )}

      {pending && (
        <Modal title="Unsaved changes" onClose={() => setPending(null)}>
          <p>
            {doc?.draft.name || 'This template'} has unsaved changes. Save them before you {pending.what}?
          </p>
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const step = pending.run;
                setPending(null);
                if (doc) setDoc({ ...doc, draft: doc.base });
                void step();
              }}
            >
              Discard changes
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                const step = pending.run;
                setPending(null);
                if (await save()) await step();
              }}
            >
              Save
            </button>
          </div>
        </Modal>
      )}

      {reapplying && doc && project && (
        <ReapplyDialog
          template={doc.base}
          project={project}
          assets={users}
          onClose={() => setReapplying(false)}
          onDone={(summary) => {
            setReapplying(false);
            setMessage(`${summary}. Edit > Undo takes it back.`);
          }}
        />
      )}
    </div>
  );
}

/** A fresh library id (the workspace keeps ids it is given for new templates). */
function newTemplateId(): string {
  return `tpl-${crypto.randomUUID()}`;
}
