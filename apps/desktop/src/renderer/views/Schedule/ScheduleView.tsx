import { useProject, useSchedule, useSelect, useStore, type ScheduleZoom } from '../../store';
import { GanttView } from './GanttView';
import { TaskPanel } from './TaskPanel';

const ZOOMS: ReadonlyArray<readonly [ScheduleZoom, string]> = [
  ['day', 'Day'],
  ['week', 'Week'],
  ['month', 'Month'],
];

/** The schedule view: toolbar, the Gantt of every asset's tasks and the selected task's panel. */
export function ScheduleView() {
  const store = useStore();
  const info = useProject();
  const schedule = useSchedule();
  const zoom = useSelect((s) => s.ui.scheduleZoom);
  const progressMode = useSelect((s) => s.ui.progressMode);
  if (!info) return null;
  const { project } = info;
  const addAssets = (
    <button type="button" className="btn" onClick={() => void store.dispatch({ type: 'add-assets' })}>
      Add assets…
    </button>
  );
  return (
    <main className="view view-column view-schedule" aria-label="Schedule">
      <div className="toolbar" role="toolbar" aria-label="Schedule tools">
        <div className="seg" role="group" aria-label="Zoom">
          {ZOOMS.map(([id, label]) => (
            <button key={id} type="button" className="btn" aria-pressed={zoom === id} onClick={() => store.setScheduleZoom(id)}>
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn"
          aria-pressed={progressMode}
          title="Edit % complete and actual dates right in the grid. Enter moves down, Tab moves across."
          onClick={() => store.setProgressMode(!progressMode)}
        >
          Progress mode
        </button>
        {progressMode && <span className="toolbar-hint">Click a % or actual date to edit it · Enter moves down · Tab moves across</span>}
        <span className="toolbar-spacer" />
        {addAssets}
        <button type="button" className="btn" onClick={() => void store.dispatch({ type: 'print' })}>
          Print…
        </button>
      </div>
      {schedule.error && (
        <p className="banner banner-warn" role="status">
          The schedule cannot be computed: {schedule.error}
        </p>
      )}
      {project.assets.length === 0 ? (
        <div className="empty">
          <h2>No assets yet</h2>
          <p className="hint">Assets added from a template appear here with their tasks and dates.</p>
          <p>{addAssets}</p>
        </div>
      ) : (
        <div className="schedule-body">
          <GanttView key={`${info.filePath}#${project.id}`} project={project} schedule={schedule.tasks} />
          <TaskPanel />
        </div>
      )}
    </main>
  );
}
