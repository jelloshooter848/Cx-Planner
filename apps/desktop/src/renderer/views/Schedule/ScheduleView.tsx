import { useProject, useSchedule, useSelect, useStore, type ScheduleZoom } from '../../store';
import { GanttView } from './GanttView';

const ZOOMS: ReadonlyArray<readonly [ScheduleZoom, string]> = [
  ['day', 'Day'],
  ['week', 'Week'],
  ['month', 'Month'],
];

/** The schedule view: toolbar and the Gantt of every asset's tasks. */
export function ScheduleView() {
  const store = useStore();
  const info = useProject();
  const schedule = useSchedule();
  const zoom = useSelect((s) => s.ui.scheduleZoom);
  if (!info) return null;
  const { project } = info;
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
        </div>
      ) : (
        <GanttView key={`${info.filePath}#${project.id}`} project={project} schedule={schedule.tasks} />
      )}
    </main>
  );
}
