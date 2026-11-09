import { statusText } from '../format';
import { useAppState, useStore, useUi } from '../store';

/**
 * Bottom line: the project name (opens Project settings), counts on the left, data date and
 * save state on the right; or the current view's own line, without the project name.
 */
export function StatusBar() {
  const app = useAppState();
  const store = useStore();
  const { status } = useUi();
  if (!app) return <footer className="statusbar" />;
  const t = status ? { ...status, savedDetail: '' } : statusText(app);
  const project = status ? null : app.project;
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
