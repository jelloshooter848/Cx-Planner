/**
 * The task properties panel on the right of the Schedule view (01-Main). It shows the
 * selected task and edits it in place: each field commits on blur or Enter as one command
 * through the main process, so every change is one undo step. Problems (a bad duration, an
 * unknown predecessor, a link that would make a loop) show under the field and leave the
 * project as it was.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { formatPredecessors, parsePredecessors, setPredecessorsCommand, templateTaskFor, type Asset, type Command, type Project, type Task, type TaskPatch, type TaskType, type TaskTemplateLink } from '@cx/core';
import { Modal } from '../../components/Modal';
import { shortDate } from '../../format';
import { useProject, useSchedule, useSelectedTask, useStore, type Store } from '../../store';
import './TaskPanel.css';
import { floatNote, parseDateInput, parseDuration, parsePercent, TASK_TYPE_LABELS, typeChangePatch } from './task-fields';

/** An error message to show under the field, or null when the edit was saved (or changed nothing). */
type Commit = (text: string) => Promise<string | null>;

/** Applies an edit; returns the refusal message (not shown as a notice: the field shows it). */
async function edit(store: Store, cmd: Command): Promise<string | null> {
  try {
    const r = await store.api.apply(cmd);
    return r.ok ? null : r.message;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function TaskPanel() {
  const task = useSelectedTask();
  const info = useProject();
  return (
    <aside className="task-panel" aria-label="Task details">
      {task && info ? (
        <TaskPanelBody key={task.id} task={task} project={info.project} />
      ) : (
        <p className="hint task-panel-empty">Select a task to see and edit its details.</p>
      )}
    </aside>
  );
}

function TaskPanelBody({ task, project }: { task: Task; project: Project }) {
  const store = useStore();
  const schedule = useSchedule();
  const asset = project.assets.find((a) => a.id === task.assetId);
  const s = schedule.tasks[task.id];
  const update = (patch: TaskPatch) => edit(store, { kind: 'updateTask', id: task.id, patch });
  const text = (key: 'name' | 'responsible' | 'notes', required: boolean): Commit => async (raw) => {
    const value = key === 'notes' ? raw.replace(/\s+$/, '') : raw.trim();
    if (value === (task[key] ?? '')) return null;
    if (value === '') return required ? 'A task needs a name' : update({ [key]: null });
    return update({ [key]: value });
  };

  const commitStart: Commit = async (raw) => {
    if (raw.trim() === '') return task.startNoEarlierThan ? update({ startNoEarlierThan: null }) : null;
    const ref = s?.start ?? project.dataDate;
    const p = parseDateInput(raw, ref);
    if (!p.ok) return p.error;
    if (p.value === task.startNoEarlierThan || (!task.startNoEarlierThan && p.value === s?.start)) return null;
    return update({ startNoEarlierThan: p.value });
  };
  const commitDuration: Commit = async (raw) => {
    const p = parseDuration(raw);
    if (!p.ok) return p.error;
    return p.value === task.durationDays ? null : update({ durationDays: p.value });
  };
  const commitPercent: Commit = async (raw) => {
    const p = parsePercent(raw);
    if (!p.ok) return p.error;
    return p.value === task.percentComplete ? null : update({ percentComplete: p.value });
  };
  const commitPreds: Commit = async (raw) => {
    const p = parsePredecessors(raw, project, task.id);
    if (p.errors.length > 0) return p.errors.map((e) => e.message).join('. ');
    const cmd = setPredecessorsCommand(project, task.id, p.predecessors);
    return cmd ? edit(store, cmd) : null;
  };
  const [typeError, setTypeError] = useState<string | null>(null);
  const changeType = async (type: TaskType) => setTypeError(type === task.type ? null : await update(typeChangePatch(task, type)));

  const started = !!task.actualStart;
  const startHint = started
    ? `Started ${shortDate(task.actualStart!)} (actual)`
    : task.startNoEarlierThan
      ? `Not before ${shortDate(task.startNoEarlierThan)}`
      : s
        ? 'Computed from links'
        : null;
  const note = floatNote(project, task, schedule.tasks, schedule.projectFinish);
  const ids = { type: useId() };

  return (
    <div className="task-panel-body">
      <h2 className="task-panel-head">
        Task {task.code}
        {asset ? ` · ${asset.tag}` : ''}
      </h2>
      <Field label="Task name" value={task.name} commit={text('name', true)} name="name" />
      <div className="task-panel-pair">
        <Field
          label="Start"
          value={s ? shortDate(s.start) : ''}
          commit={commitStart}
          name="start"
          readOnly={started}
          placeholder="Not scheduled"
          hint={
            startHint && (
              <>
                {startHint}
                {task.startNoEarlierThan && !started && (
                  <>
                    {' · '}
                    <button type="button" className="btn-link" onClick={() => void update({ startNoEarlierThan: null })}>
                      Clear
                    </button>
                  </>
                )}
              </>
            )
          }
          title="Type a date to keep this task from starting before it. Leave empty to schedule it from its predecessors."
        />
        <Field label="Duration (working days)" value={String(task.durationDays)} commit={commitDuration} name="duration" inputMode="numeric" />
      </div>
      <div className="task-panel-pair">
        <Field label="% complete" value={String(task.percentComplete)} commit={commitPercent} name="percent" inputMode="numeric" />
        <Field label="Predecessors" value={formatPredecessors(project, task.id)} commit={commitPreds} name="predecessors" placeholder="e.g. 1.3 FS" />
      </div>
      <div className="field task-field">
        <label className="field-label" htmlFor={ids.type}>
          Type
        </label>
        <select
          id={ids.type}
          className="input"
          value={task.type}
          aria-invalid={typeError ? true : undefined}
          onChange={(e) => void changeType(e.target.value as TaskType)}
        >
          {(Object.keys(TASK_TYPE_LABELS) as TaskType[]).map((t) => (
            <option key={t} value={t}>
              {TASK_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        {typeError && (
          <p className="field-error" role="alert">
            {typeError}
          </p>
        )}
      </div>
      <Field label="Responsible" value={task.responsible ?? ''} commit={text('responsible', false)} name="responsible" />
      <TestSheet asset={asset} task={task} />
      {note &&
        (note.kind === 'critical' ? (
          <p className="task-callout is-critical" data-testid="float-note">
            <strong>Critical path.</strong> {note.text}
          </p>
        ) : (
          <p className="task-float" data-testid="float-note">
            {note.text}
          </p>
        ))}
      <Field label="Notes" value={task.notes ?? ''} commit={text('notes', false)} name="notes" multiline />
      <div className="task-panel-actions">
        <button type="button" className="btn" onClick={() => void store.dispatch({ type: 'delete-task' })}>
          Delete task…
        </button>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  /** The saved value, shown whenever the field is not being edited. */
  value: string;
  commit: Commit;
  /** Data attribute for tests and styling. */
  name: string;
  multiline?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  inputMode?: 'numeric';
  hint?: ReactNode;
  title?: string;
}

/**
 * A text field that commits on blur and on Enter (Ctrl+Enter in a multi-line field).
 * Escape puts the saved value back. A refused edit keeps the typed text and shows why.
 */
function Field({ label, value, commit, name, multiline, readOnly, placeholder, inputMode, hint, title }: FieldProps) {
  const id = useId();
  const errId = useId();
  /** The text being edited, or null to show the saved value. */
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The text being committed, while a commit is in flight. */
  const saving = useRef<string | null>(null);
  // A new saved value (an undo, an edit elsewhere) replaces an unchanged draft.
  useEffect(() => {
    setDraft((d) => (d === value ? null : d));
  }, [value]);

  const save = async () => {
    if (draft === null || readOnly) return;
    const typed = draft;
    if (typed === value) {
      setDraft(null);
      setError(null);
      return;
    }
    // Enter then blur (or Tab) before the commit returns would save the same text twice;
    // the second command, built from the old project, could be refused and show a false error.
    if (saving.current !== null) return;
    saving.current = typed;
    try {
      const problem = await commit(typed);
      setError(problem);
      // Keep the text while there is a problem so it can be fixed; otherwise show the saved value.
      if (!problem) setDraft((d) => (d === typed ? null : d));
    } finally {
      saving.current = null;
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && (draft !== null || error)) {
      e.preventDefault();
      e.stopPropagation();
      setDraft(null);
      setError(null);
    } else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void save();
    }
  };
  const common = {
    id,
    className: 'input',
    value: draft ?? value,
    readOnly,
    placeholder,
    title,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errId : undefined,
    onChange: (e: { target: { value: string } }) => {
      setDraft(e.target.value);
    },
    onBlur: () => void save(),
    onKeyDown,
  };
  return (
    <div className="field task-field" data-field={name}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {multiline ? <textarea {...common} rows={4} /> : <input {...common} type="text" inputMode={inputMode} autoComplete="off" spellCheck={false} />}
      {error ? (
        <p id={errId} className="field-error" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="field-hint">{hint}</p>
      )}
    </div>
  );
}

/** The test sheet the task's template gives it, with its checklist (read-only for now). */
function TestSheet({ asset, task }: { asset: Asset | undefined; task: Task }) {
  const store = useStore();
  const [link, setLink] = useState<TaskTemplateLink | null | 'loading'>(asset?.templateId && task.templateKey ? 'loading' : null);
  const [open, setOpen] = useState(false);
  const templateId = asset?.templateId;
  const version = asset?.templateVersion;
  useEffect(() => {
    if (!templateId || !task.templateKey) {
      setLink(null);
      return;
    }
    let live = true;
    void store.api.templates.inProject(templateId).then(
      (r) => live && setLink(r.ok ? templateTaskFor([r.value], asset, task) : null),
      () => live && setLink(null),
    );
    return () => {
      live = false;
    };
    // The snapshot only changes with the asset's template id or version, or the task's key.
  }, [store, templateId, version, task.templateKey]);

  const sheetName = link && link !== 'loading' ? `${link.template.name} · ${link.templateTask.testForm ?? link.templateTask.name}` : null;
  return (
    <div className="field task-field" data-field="test-sheet">
      <span className="field-label">Test sheet</span>
      <div className="task-sheet">
        {link === 'loading' ? (
          <span className="muted">Loading…</span>
        ) : link ? (
          <>
            <span className="task-sheet-name" title={`${sheetName} (template version ${link.template.version})`}>
              {sheetName} <span className="muted">(v{link.template.version})</span>
            </span>
            <button type="button" className="btn-link" onClick={() => setOpen(true)} aria-label={`Open test sheet ${sheetName}`}>
              Open
            </button>
          </>
        ) : (
          <span className="muted">None: not made from a template</span>
        )}
      </div>
      {open && link && link !== 'loading' && (
        <Modal title={sheetName ?? 'Test sheet'} description={`Task ${task.code} ${task.name} · checklist from template version ${link.template.version}`} onClose={() => setOpen(false)} width={520}>
          {link.templateTask.checklist.length > 0 ? (
            <ol className="checklist" aria-label="Checklist items">
              {link.templateTask.checklist.map((c) => (
                <li key={c.id}>{c.text}</li>
              ))}
            </ol>
          ) : (
            <p className="hint">This template task has no checklist items.</p>
          )}
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
