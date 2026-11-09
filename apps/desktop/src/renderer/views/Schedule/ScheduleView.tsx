import { Fragment } from 'react';
import { TaskTypeSymbol, taskTypeLabel } from '../../components/Symbols';
import { shortDate } from '../../format';
import { useAppState, useProject, useSchedule, useStore } from '../../store';

/**
 * The schedule view. For now a read-only grid of assets and tasks with their computed
 * dates; the Gantt with editing replaces it.
 */
export function ScheduleView() {
  const info = useProject();
  const schedule = useSchedule();
  const store = useStore();
  const hasWorkspace = !!useAppState()?.workspacePath;
  if (!info) return null;
  const { project } = info;
  const addAssets = (
    <button type="button" className="btn" disabled={!hasWorkspace} onClick={() => void store.dispatch({ type: 'add-assets' })}>
      Add assets…
    </button>
  );
  return (
    <main className="view view-schedule" aria-label="Schedule">
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
        <>
        <div className="view-toolbar">{addAssets}</div>
        <div className="panel grid-wrap">
          <table className="grid" aria-label="Tasks">
            <thead>
              <tr>
                <th className="col-id">ID</th>
                <th>Task</th>
                <th>Type</th>
                <th className="num">Dur</th>
                <th>Start</th>
                <th>Finish</th>
                <th className="num">%</th>
                <th>Float</th>
              </tr>
            </thead>
            <tbody>
              {project.assets.map((a, ai) => (
                <Fragment key={a.id}>
                  <tr className="grid-group">
                    <td className="col-id">{ai + 1}</td>
                    <td colSpan={7}>
                      <b>{a.tag}</b> <span className="muted">{[a.description, a.location].filter(Boolean).join(' · ')}</span>
                    </td>
                  </tr>
                  {project.tasks
                    .filter((t) => t.assetId === a.id)
                    .map((t) => {
                      const s = schedule.tasks[t.id];
                      return (
                        <tr key={t.id}>
                          <td className="col-id">{t.code}</td>
                          <td className="indent">{t.name}</td>
                          <td>
                            <span className="type-cell">
                              <TaskTypeSymbol type={t.type} />
                              {taskTypeLabel(t.type)}
                            </span>
                          </td>
                          <td className="num">{t.durationDays} d</td>
                          <td>{s ? shortDate(s.start) : '—'}</td>
                          <td>{s ? shortDate(s.finish) : '—'}</td>
                          <td className="num">{t.percentComplete}%</td>
                          <td>{s ? (s.critical ? <span className="critical">Critical · {s.totalFloat} d</span> : `${s.totalFloat} d`) : '—'}</td>
                        </tr>
                      );
                    })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </main>
  );
}
