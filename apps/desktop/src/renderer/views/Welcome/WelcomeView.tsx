import type { RecentFile } from '../../../shared/api';
import { lastOpenedText } from '../../format';
import { useAppState, useStore } from '../../store';

/**
 * Shown when no project is open: new, open, the sample project and the recent list.
 * Recent files that can no longer be found are greyed, marked "Not found" (not by colour
 * alone) and offer "Remove from list" instead of opening.
 */
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

        <div className="welcome-sample">
          <div className="welcome-sample-text">
            <span className="welcome-sample-title">Riverside Data Center – Bldg A</span>
            <span className="hint">A made-up job with nine assets, test sheets and progress, to try things out. A copy is saved in Documents › Cx Planner Samples.</span>
          </div>
          <button type="button" className="btn" onClick={() => void store.dispatch({ type: 'open-sample' })}>
            Open sample project
          </button>
        </div>

        <h2 className="section-label" id="recent-heading">
          Recent projects
        </h2>
        {recent.length === 0 ? (
          <p className="hint">No recent projects yet.</p>
        ) : (
          <ul className="recent-list" aria-labelledby="recent-heading">
            {recent.map((r) => (
              <RecentRow key={r.path} file={r} />
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

function RecentRow({ file }: { file: RecentFile }) {
  const store = useStore();
  const opened = lastOpenedText(file.lastOpened);
  const text = (
    <>
      <span className="recent-name">{file.name}</span>
      <span className="recent-path">{file.path}</span>
    </>
  );
  if (!file.exists) {
    return (
      <li className="recent-row recent-missing">
        <div className="recent-item" title={`${file.path} could not be found`}>
          {text}
        </div>
        <span className="recent-when">Not found</span>
        <button type="button" className="btn-link recent-remove" aria-label={`Remove ${file.name} from list`} onClick={() => void store.dispatch({ type: 'remove-recent', path: file.path })}>
          Remove from list
        </button>
      </li>
    );
  }
  return (
    <li className="recent-row">
      <button type="button" className="recent-item" title={file.path} onClick={() => void store.dispatch({ type: 'open-recent', path: file.path })}>
        {text}
      </button>
      {opened && (
        <span className="recent-when" title="Last opened">
          {opened}
        </span>
      )}
    </li>
  );
}
