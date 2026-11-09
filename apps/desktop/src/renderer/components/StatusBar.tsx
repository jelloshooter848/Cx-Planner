import { useMemo } from 'react';
import { statusText, type InView } from '../format';
import { effectiveView, useAssetFilter, useAppState, useSelect, useStore, useUi } from '../store';

/**
 * Bottom line: the project name (opens Project settings), counts on the left, data date
 * (opens the data date picker) and save state on the right; or the current view's own line,
 * without the project name.
 */
export function StatusBar() {
  const app = useAppState();
  const store = useStore();
  const { status } = useUi();
  const onSchedule = useSelect((s) => effectiveView(s) === 'schedule');
  const filter = useAssetFilter();
  const appProject = app?.project;
  // On the Schedule view (once it has assets) the counts read "N of M assets in view"; the
  // asset filter narrows them.
  const inView = useMemo((): InView | null => {
    if (!onSchedule || !appProject || appProject.assets.length === 0) return null;
    if (!filter) return { assets: appProject.assets.length, tasks: appProject.tasks.length };
    const shown = new Set(filter);
    return { assets: filter.length, tasks: appProject.tasks.filter((t) => shown.has(t.assetId)).length };
  }, [onSchedule, filter, appProject]);
  if (!app) return <footer className="statusbar" />;
  const t = status ? { ...status, savedDetail: '' } : statusText(app, undefined, inView);
  const project = status ? null : app.project;
  return (
    <footer className="statusbar" data-testid="statusbar">
      <span className="statusbar-left">
        {project && (
          <>
            <button
              type="button"
              className="statusbar-link statusbar-project"
              title="Project settings"
              aria-label={`Project settings: ${project.name}`}
              onClick={() => void store.dispatch({ type: 'project-settings' })}
            >
              {project.name}
            </button>
            <span aria-hidden="true"> · </span>
          </>
        )}
        {t.left}
      </span>
      {project && 'dataDate' in t && t.dataDate ? (
        <span className="statusbar-right">
          <button
            type="button"
            className="statusbar-link statusbar-data-date"
            title="Change the data date"
            aria-label={`${t.dataDate}. Change the data date`}
            onClick={() => void store.dispatch({ type: 'data-date' })}
          >
            {t.dataDate}
          </button>
          <span aria-hidden="true"> · </span>
          <span title={t.savedDetail || undefined}>{t.saveState}</span>
        </span>
      ) : (
        <span className="statusbar-right" title={t.savedDetail || undefined}>
          {t.right}
        </span>
      )}
    </footer>
  );
}
