<<<<<<< HEAD
import { useMemo } from 'react';
import { statusText, type InView } from '../format';
import { effectiveView, useAssetFilter, useAppState, useSelect, useUi } from '../store';
=======
import { statusText } from '../format';
import { useAppState, useStore, useUi } from '../store';
>>>>>>> claude/nice-goldberg-kgalnj

/**
 * Bottom line: the project name (opens Project settings), counts on the left, data date and
 * save state on the right; or the current view's own line, without the project name.
 */
export function StatusBar() {
  const app = useAppState();
  const store = useStore();
  const { status } = useUi();
  const onSchedule = useSelect((s) => effectiveView(s) === 'schedule');
  const filter = useAssetFilter();
  const project = app?.project;
  // On the Schedule view an asset filter narrows the counts to what is in view.
  const inView = useMemo((): InView | null => {
    if (!onSchedule || !filter || !project) return null;
    const shown = new Set(filter);
    return { assets: filter.length, tasks: project.tasks.filter((t) => shown.has(t.assetId)).length };
  }, [onSchedule, filter, project]);
  if (!app) return <footer className="statusbar" />;
<<<<<<< HEAD
  const t = status ? { ...status, savedDetail: '' } : statusText(app, undefined, inView);
=======
  const t = status ? { ...status, savedDetail: '' } : statusText(app);
  const project = status ? null : app.project;
>>>>>>> claude/nice-goldberg-kgalnj
  return (
    <footer className="statusbar" data-testid="statusbar">
      <span className="statusbar-left">
        {project && (
          <>
            <button
              type="button"
              className="statusbar-project"
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
      <span className="statusbar-right" title={t.savedDetail || undefined}>
        {t.right}
      </span>
    </footer>
  );
}
