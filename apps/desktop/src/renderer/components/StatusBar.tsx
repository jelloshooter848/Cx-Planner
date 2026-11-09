import { statusText } from '../format';
import { useAppState, useStore } from '../store';

/**
 * Bottom line: the project name (opens Project settings), counts on the left, data date and
 * save state on the right.
 */
export function StatusBar() {
  const app = useAppState();
  const store = useStore();
  if (!app) return <footer className="statusbar" />;
  const t = statusText(app);
  const project = app.project;
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
