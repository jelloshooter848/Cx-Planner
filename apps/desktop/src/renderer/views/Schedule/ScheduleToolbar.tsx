/**
 * The Schedule view's toolbar (01-Main): add assets and tasks, link and indent, undo/redo,
 * zoom, the baseline (later) and look-ahead window, and print. Edit buttons explain in their
 * tooltip what they will do, or why they are disabled.
 */
import type { Command, Id, Project } from '@cx/core';
import { LOOK_AHEAD_WEEKS, type LookAheadWeeks } from '../../../shared/api';
import { isMac } from '../../platform';
import { keyHint } from '../../menus';
import { useAppState, useSelect, useStore, type ScheduleZoom } from '../../store';
import { addTaskAction, linkAction, shiftAction, type ToolAction } from './schedule-actions';

const ZOOMS: ReadonlyArray<readonly [ScheduleZoom, string]> = [
  ['day', 'Day'],
  ['week', 'Week'],
  ['month', 'Month'],
];

export interface ScheduleToolbarProps {
  project: Project;
  /** Asset ids shown in the Gantt, or null for all (the asset filter). */
  assetsInView: Id[] | null;
}

export function ScheduleToolbar({ project, assetsInView }: ScheduleToolbarProps) {
  const store = useStore();
  const app = useAppState();
  const zoom = useSelect((s) => s.ui.scheduleZoom);
  const selectedId = useSelect((s) => s.ui.selectedTaskId);
  const selectedIds = useSelect((s) => s.ui.selectedTaskIds);
  const weeks = useSelect((s) => s.ui.lookAheadWeeks);

  const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `task-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const run = async (cmd: Command) => store.run(() => store.api.apply(cmd));

  const add = addTaskAction(project, selectedId, 'new');
  const link = linkAction(project, selectedIds);
  const indent = shiftAction(project, selectedId, assetsInView, 'indent');
  const outdent = shiftAction(project, selectedId, assetsInView, 'outdent');

  const onAdd = async () => {
    const id = newId();
    const a = addTaskAction(project, selectedId, id);
    if (!a.ok) return;
    const r = await run(a.command);
    if (r.ok) store.selectTask(id);
  };
  const onRun = (a: ToolAction) => async () => {
    if (a.ok) await run(a.command);
  };

  const canUndo = app?.canUndo ?? false;
  const canRedo = app?.canRedo ?? false;
  const undoTitle = canUndo ? `Undo: ${app?.undoLabel ?? 'last edit'} (${keyHint('Ctrl+Z', isMac)})` : 'Nothing to undo';
  const redoTitle = canRedo ? `Redo: ${app?.redoLabel ?? 'last undone edit'} (${keyHint('Ctrl+Y', isMac)})` : 'Nothing to redo';

  return (
    <div className="toolbar schedule-toolbar" role="toolbar" aria-label="Schedule tools">
      <div className="toolbar-group">
        <button type="button" className="btn btn-primary" onClick={() => void store.dispatch({ type: 'add-assets' })}>
          Add asset from template
        </button>
        <ToolButton label="Add task" action={add} onClick={() => void onAdd()} />
        <ToolButton label="Link tasks" action={link} onClick={() => void onRun(link)()} />
        <ToolButton label="Indent" action={indent} onClick={() => void onRun(indent)()} />
        <ToolButton label="Outdent" action={outdent} onClick={() => void onRun(outdent)()} />
        <span className="toolbar-sep" aria-hidden="true" />
        <button type="button" className="btn" disabled={!canUndo} title={undoTitle} onClick={() => void store.dispatch({ type: 'undo' })}>
          Undo
        </button>
        <button type="button" className="btn" disabled={!canRedo} title={redoTitle} onClick={() => void store.dispatch({ type: 'redo' })}>
          Redo
        </button>
        <span className="toolbar-sep" aria-hidden="true" />
        <div className="seg" role="group" aria-label="Zoom">
          {ZOOMS.map(([id, label]) => (
            <button key={id} type="button" className="btn" aria-pressed={zoom === id} onClick={() => store.setScheduleZoom(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <span className="toolbar-spacer" />
      <div className="toolbar-group">
        <button type="button" className="btn" disabled title="Baselines are not available yet">
          Baseline: Rev A
        </button>
        <label className="btn btn-select" title="Weeks shaded on the schedule as the look-ahead window">
          <span className="sr-only">Look-ahead window</span>
          <select aria-label="Look-ahead" value={weeks} onChange={(e) => store.setLookAheadWeeks(Number(e.target.value) as LookAheadWeeks)}>
            {LOOK_AHEAD_WEEKS.map((w) => (
              <option key={w} value={w}>
                Look-ahead: {w} weeks
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-primary" onClick={() => void store.dispatch({ type: 'print' })}>
          Print / Export PDF
        </button>
      </div>
    </div>
  );
}

function ToolButton({ label, action, onClick }: { label: string; action: ToolAction; onClick(): void }) {
  const title = action.ok ? action.label : action.reason;
  return (
    <button type="button" className="btn" disabled={!action.ok} title={title} onClick={onClick}>
      {label}
    </button>
  );
}
