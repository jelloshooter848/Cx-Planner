import { useAppState, useStore } from '../../store';

/** Shown when no project is open: new, open, and the recent list. */
export function WelcomeView() {
  const store = useStore();
  const app = useAppState();
  const recent = app?.recent ?? [];
  return (
    <main className="welcome" aria-label="Welcome">
      <section className="welcome-card">
        <h1 className="welcome-title">Cx Planner</h1>
        <p className="welcome-sub">QA/QC and commissioning planning for electrical work.</p>
        <div className="welcome-actions">
          <button type="button" className="btn btn-primary btn-lg" onClick={() => void store.dispatch({ type: 'new-project' })}>
            New project…
          </button>
          <button type="button" className="btn btn-lg" onClick={() => void store.dispatch({ type: 'open-project' })}>
            Open project…
          </button>
        </div>
        <h2 className="section-label">Recent projects</h2>
        {recent.length === 0 ? (
          <p className="hint">No recent projects yet.</p>
        ) : (
          <ul className="recent-list">
            {recent.map((r) => (
              <li key={r.path}>
                <button type="button" className="recent-item" title={r.path} onClick={() => void store.dispatch({ type: 'open-recent', path: r.path })}>
                  <span className="recent-name">{r.name}</span>
                  <span className="recent-path">{r.exists ? r.path : `${r.path} (not found)`}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="welcome-workspace">
          <span>Workspace: {app?.workspacePath ?? 'none'}</span>
          <button type="button" className="btn-link" onClick={() => void store.dispatch({ type: 'choose-workspace' })}>
            Change…
          </button>
        </p>
      </section>
    </main>
  );
}
