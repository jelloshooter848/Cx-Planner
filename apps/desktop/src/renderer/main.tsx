import { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { PaperId } from '@cx/render';
import type { AppState, LookAheadPreview } from '../shared/api';
import './styles.css';

const PAPERS: ReadonlyArray<readonly [PaperId, string]> = [
  ['letter', 'Letter'],
  ['tabloid', 'Tabloid'],
  ['ansi-d', 'ANSI D'],
  ['arch-d', 'ARCH D'],
];

/** Keeps the latest AppState from the main process. */
function useAppState(): AppState | undefined {
  const [state, setState] = useState<AppState>();
  useEffect(() => {
    const keepNewer = (s: AppState) => setState((prev) => (prev && prev.seq > s.seq ? prev : s));
    const off = window.cx.onState(keepNewer);
    void window.cx.getState().then(keepNewer);
    return off;
  }, []);
  return state;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function StartScreen({ state, showNew, setShowNew }: { state: AppState; showNew: boolean; setShowNew: (v: boolean) => void }) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [error, setError] = useState('');
  const create = async (e: FormEvent) => {
    e.preventDefault();
    const r = await window.cx.newProject({ name, startDate });
    if (!r.ok && r.code !== 'canceled') setError(r.message);
    if (r.ok) setShowNew(false);
  };
  return (
    <main className="start">
      <section className="card">
        <h1>Cx Planner</h1>
        <div className="actions">
          <button className="primary" onClick={() => setShowNew(true)}>New project…</button>
          <button onClick={() => void window.cx.openProject()}>Open…</button>
        </div>
        {showNew && (
          <form className="new-project" onSubmit={create} aria-label="New project">
            <label>
              Project name
              <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Start date
              <input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <div className="actions">
              <button type="submit" className="primary">Create…</button>
              <button type="button" onClick={() => setShowNew(false)}>Cancel</button>
            </div>
            {error && <p className="error" role="alert">{error}</p>}
          </form>
        )}
        <h2>Recent projects</h2>
        {state.recent.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <ul className="recent">
            {state.recent.map((r) => (
              <li key={r.path}>
                <button onClick={() => void window.cx.openRecent(r.path)} title={r.path}>
                  <b>{r.name}</b> <span className="muted">{r.exists ? r.path : `${r.path} (not found)`}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">
          Workspace: {state.workspacePath ?? 'none'}{' '}
          <button className="link" onClick={() => void window.cx.chooseWorkspace()}>Change…</button>
        </p>
      </section>
    </main>
  );
}

function ProjectScreen({ state }: { state: AppState }) {
  const [paper, setPaper] = useState<PaperId>('tabloid');
  const [doc, setDoc] = useState<LookAheadPreview>();
  const [status, setStatus] = useState('');
  useEffect(() => {
    void window.cx.print.lookAheadHtml(paper).then((r) => r.ok && setDoc(r.value));
  }, [paper, state.revision, state.filePath]);
  const project = state.project!;
  const scale = doc ? Math.min(1, 1240 / (doc.widthIn * 96)) : 1;
  return (
    <>
      <div className="toolbar">
        <button onClick={() => void window.cx.undo()} disabled={!state.canUndo} title={state.undoLabel ?? ''}>Undo</button>
        <button onClick={() => void window.cx.redo()} disabled={!state.canRedo} title={state.redoLabel ?? ''}>Redo</button>
        <span>3-week look-ahead</span>
        <div className="seg">
          {PAPERS.map(([id, label]) => (
            <button key={id} aria-pressed={paper === id} onClick={() => setPaper(id)}>{label}</button>
          ))}
        </div>
        <span className="muted">{doc ? `${doc.sheets} sheet(s)` : ''}</span>
        <button
          className="primary"
          onClick={async () => {
            const r = await window.cx.print.lookAheadPdf(paper);
            setStatus(r.ok ? `Saved ${r.value.filePath}` : r.code === 'canceled' ? '' : r.message);
          }}
        >
          Print / Export PDF
        </button>
        <span className="muted">{status}</span>
      </div>
      <main className="preview">
        {project.tasks.length === 0 && <p className="empty">This project has no assets yet.</p>}
        {doc && project.tasks.length > 0 && (
          <iframe
            title="Print preview"
            sandbox=""
            srcDoc={doc.html.replace('</style>', `.sheet{margin:0 auto 24px;box-shadow:0 1px 6px #0003} body{background:#e5e7eb;padding:24px 0}</style>`)}
            style={{ width: doc.widthIn * 96 + 48, height: (doc.heightIn * 96 + 24) * doc.sheets + 48, transform: `scale(${scale})`, transformOrigin: 'top left' }}
          />
        )}
      </main>
    </>
  );
}

function StatusBar({ state }: { state: AppState }) {
  const p = state.project;
  if (!p) return null;
  const saved = state.lastSavedAt ? `Saved ${new Date(state.lastSavedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Saved';
  return (
    <footer className="statusbar">
      <span>
        {p.assets.length} assets · {p.tasks.length} tasks{state.projectFinish ? ` · Finishes ${state.projectFinish}` : ''}
        {state.scheduleError ? ` · ${state.scheduleError}` : ''}
      </span>
      <span>
        Data as of {p.dataDate} · Rev {state.revision} · {saved}
      </span>
    </footer>
  );
}

function App() {
  const state = useAppState();
  const [showNew, setShowNew] = useState(false);
  useEffect(() => window.cx.onMenu((cmd) => cmd === 'new-project' && setShowNew(true)), []);
  useEffect(() => {
    // Project undo/redo; text fields keep their own.
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) void window.cx.undo();
      else if (k === 'y' || (k === 'z' && e.shiftKey)) void window.cx.redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!state) return null;
  const showStart = !state.project || showNew;
  return (
    <div className="app">
      <header className="titlebar">
        <b>Cx Planner</b>
        {state.project && <> — {state.project.name} <span className="muted-light">({state.fileName})</span></>}
        {state.project && (
          <span className="titlebar-actions">
            <button onClick={() => setShowNew(true)}>New…</button>
            <button onClick={() => void window.cx.openProject()}>Open…</button>
            <button onClick={() => void window.cx.saveAs()}>Save As…</button>
            <button onClick={() => void window.cx.closeProject()}>Close</button>
          </span>
        )}
      </header>
      {showStart ? <StartScreen state={state} showNew={showNew} setShowNew={setShowNew} /> : <ProjectScreen state={state} />}
      {!showStart && <StatusBar state={state} />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
