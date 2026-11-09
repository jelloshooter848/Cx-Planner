/**
 * The task properties panel on the right of the Schedule view (01-Main). It shows the
 * selected task and edits it in place: each field commits on blur or Enter as one command
 * through the main process, so every change is one undo step. Problems (a bad duration, an
 * unknown predecessor, a link that would make a loop) show under the field and leave the
 * project as it was.
 *
 * Progress (% complete, actual start, actual finish) follows the rules of core's
 * planProgress: e.g. 100% asks for the actual finish, and % above 0 fills in the actual start.
 */
import { useEffect, useId, useState } from 'react';
import { formatPredecessors, parsePredecessors, setPredecessorsCommand, templateTaskFor, type Asset, type Project, type Task, type TaskPatch, type TaskType, type TaskTemplateLink } from '@cx/core';
import { Modal } from '../../components/Modal';
import { shortDate } from '../../format';
import { useProject, useSchedule, useSelectedAsset, useSelectedTask, useStore } from '../../store';
import { AssetPanelBody } from './AssetPanel';
import { edit, Field, type Commit } from './PanelField';
import './TaskPanel.css';
import { useProgressEditor } from './ProgressEdit';
import { floatNote, parseActualDate, parseDateInput, parseDuration, parsePercent, TASK_TYPE_LABELS, typeChangePatch } from './task-fields';

/** The panel on the right: the selected asset's properties, or the selected task's. */
export function TaskPanel() {
  const task = useSelectedTask();
  const asset = useSelectedAsset();
  const info = useProject();
  if (asset && info) {
    return (
      <aside className="task-panel" aria-label="Asset details">
        <AssetPanelBody key={asset.id} asset={asset} project={info.project} />
      </aside>
    );
  }
  return (
    <aside className="task-panel" aria-label="Task details">
      {task && info ? (
        <TaskPanelBody key={task.id} task={task} project={info.project} />
      ) : (
        <p className="hint task-panel-empty">Select a task, or an asset’s header row, to see and edit its details.</p>
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
  const progress = useProgressEditor(project, schedule.tasks);
  const commitPercent: Commit = async (raw) => {
    const p = parsePercent(raw);
    if (!p.ok) return p.error;
    return p.value === task.percentComplete ? null : progress.edit(task, { percentComplete: p.value }).saved;
  };
  const commitActual = (key: 'actualStart' | 'actualFinish'): Commit => async (raw) => {
    const p = parseActualDate(raw, task[key] ?? s?.start ?? project.dataDate);
    if (!p.ok) return p.error;
    return p.value === (task[key] ?? null) ? null : progress.edit(task, { [key]: p.value }).saved;
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
      <div className="task-panel-pair">
        <Field
          label="Actual start"
          value={task.actualStart ? shortDate(task.actualStart) : ''}
          commit={commitActual('actualStart')}
          name="actual-start"
          placeholder="Not started"
          title="The day work began. Clear it to set the task back to not started."
        />
        <Field
          label="Actual finish"
          value={task.actualFinish ? shortDate(task.actualFinish) : ''}
          commit={commitActual('actualFinish')}
          name="actual-finish"
          placeholder="Not finished"
          title="The day work finished. Entering it marks the task 100% complete."
        />
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
      {progress.prompt}
      <div className="task-panel-actions">
        {asset && (
          <button
            type="button"
            className="btn"
            onClick={() => store.selectAsset(asset.id)}
            title={`Edit ${asset.tag}'s tag, description, location and system`}
          >
            Edit asset {asset.tag}
          </button>
        )}
        <button type="button" className="btn" onClick={() => void store.dispatch({ type: 'delete-task' })}>
          Delete task…
        </button>
      </div>
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
