import { useLayoutEffect, useMemo, useRef } from 'react';
import { currentLookAheadWindow } from '../../dialogs/Print/print-options';
import type { SchedulePanel } from '../../layout-prefs';
import { useAssetFilter, useProject, useSchedule, useSelect, useStore } from '../../store';
import { AssetSidebar } from './AssetSidebar';
import { GanttView } from './GanttView';
import { ScheduleToolbar } from './ScheduleToolbar';
import { CollapsedPanel } from './SidePanels';
import { TaskPanel } from './TaskPanel';
import './ScheduleView.css';

/**
 * The schedule view: toolbar, the asset filter sidebar, the Gantt of the assets in view and the
 * selected task's panel. Either side panel can be folded to a thin strip (ui.scheduleLayout).
 */
export function ScheduleView() {
  const store = useStore();
  const info = useProject();
  const schedule = useSchedule();
  const filter = useAssetFilter();
  const weeks = useSelect((s) => s.ui.lookAheadWeeks);
  const layout = useSelect((s) => s.ui.scheduleLayout);
  // Folding or opening a panel from its button moves focus to the button that undoes it.
  const focusAfter = useRef<SchedulePanel | null>(null);
  const toggle = (panel: SchedulePanel) => {
    focusAfter.current = panel;
    store.togglePanel(panel);
  };
  useLayoutEffect(() => {
    const panel = focusAfter.current;
    if (!panel) return;
    focusAfter.current = null;
    document.querySelector<HTMLElement>(`[data-panel-toggle="${panel}"]`)?.focus();
  }, [layout.assetsCollapsed, layout.detailsCollapsed]);
  const assetIds = useMemo(() => (filter ? new Set(filter) : null), [filter]);
  const project = info?.project;
  // The same window the Print dialog's test sheets default to.
  const lookAhead = useMemo(() => (project ? currentLookAheadWindow(project, weeks) : null), [project, weeks]);
  if (!info || !project) return null;
  return (
    <main className="view view-column view-schedule" aria-label="Schedule">
      <ScheduleToolbar project={project} assetsInView={filter} />
      {schedule.error && (
        <p className="banner banner-warn" role="status">
          The schedule cannot be computed: {schedule.error}
        </p>
      )}
      {project.assets.length === 0 ? (
        <div className="empty">
          <h2>No assets yet</h2>
          <p className="hint">Assets added from a template appear here with their tasks and dates.</p>
          <p>
            <button type="button" className="btn" onClick={() => void store.dispatch({ type: 'add-assets' })}>
              Add assets…
            </button>
          </p>
        </div>
      ) : (
        <div className="schedule-body">
          {layout.assetsCollapsed ? (
            <CollapsedPanel panel="assets" title="Assets in view" onToggle={() => toggle('assets')} />
          ) : (
            <AssetSidebar project={project} onCollapse={() => toggle('assets')} />
          )}
          {filter?.length === 0 ? (
            <div className="gantt gantt-empty" role="status">
              <p>No assets in view. Tick assets in the sidebar or clear the filter.</p>
              <p>
                <button type="button" className="btn" onClick={() => store.setAssetFilter(null)}>
                  Clear filter
                </button>
              </p>
            </div>
          ) : (
            <GanttView key={`${info.filePath}#${project.id}`} project={project} schedule={schedule.tasks} assetIds={assetIds} lookAhead={lookAhead} />
          )}
          {layout.detailsCollapsed ? <CollapsedPanel panel="details" title="Details" onToggle={() => toggle('details')} /> : <TaskPanel onCollapse={() => toggle('details')} />}
        </div>
      )}
    </main>
  );
}
