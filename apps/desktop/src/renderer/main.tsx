import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CxApi } from '../preload/preload';
import './styles.css';

declare global {
  interface Window {
    cx: CxApi;
  }
}

const PAPERS = [
  ['letter', 'Letter'],
  ['tabloid', 'Tabloid'],
  ['ansi-d', 'ANSI D'],
  ['arch-d', 'ARCH D'],
] as const;

function App() {
  const [paper, setPaper] = useState<string>('tabloid');
  const [doc, setDoc] = useState<{ html: string; sheets: number; widthIn: number; heightIn: number }>();
  const [status, setStatus] = useState('');
  useEffect(() => {
    void window.cx.lookAheadHtml(paper).then(setDoc);
  }, [paper]);
  const scale = doc ? Math.min(1, 1240 / (doc.widthIn * 96)) : 1;
  return (
    <div className="app">
      <header className="titlebar"><b>Cx Planner</b> — Riverside Data Center – Bldg A (sample)</header>
      <div className="toolbar">
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
            const r = await window.cx.lookAheadPdf(paper);
            setStatus(r.saved ? `Saved ${r.path}` : '');
          }}
        >
          Print / Export PDF
        </button>
        <span className="muted">{status}</span>
      </div>
      <main className="preview">
        {doc && (
          <iframe
            title="Print preview"
            sandbox=""
            srcDoc={doc.html.replace('</style>', `.sheet{margin:0 auto 24px;box-shadow:0 1px 6px #0003} body{background:#e5e7eb;padding:24px 0}</style>`)}
            style={{ width: doc.widthIn * 96 + 48, height: (doc.heightIn * 96 + 24) * doc.sheets + 48, transform: `scale(${scale})`, transformOrigin: 'top left' }}
          />
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
