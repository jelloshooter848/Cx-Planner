import { useEffect, useState } from 'react';
import type { PaperId } from '@cx/render';
import type { LookAheadPreview } from '../../../shared/api';
import { useProject, useStore } from '../../store';

const PAPERS: ReadonlyArray<readonly [PaperId, string]> = [
  ['letter', 'Letter'],
  ['tabloid', 'Tabloid'],
  ['ansi-d', 'ANSI D'],
  ['arch-d', 'ARCH D'],
];

/** Reports > 3-week look-ahead: print preview and PDF export. */
export function LookAheadView() {
  const store = useStore();
  const info = useProject();
  const [paper, setPaper] = useState<PaperId>('tabloid');
  const [doc, setDoc] = useState<LookAheadPreview>();
  const [status, setStatus] = useState('');
  const revision = info?.revision;
  const filePath = info?.filePath;
  useEffect(() => {
    let live = true;
    void store.run(() => store.api.print.lookAheadHtml(paper)).then((r) => live && r.ok && setDoc(r.value));
    return () => {
      live = false;
    };
  }, [store, paper, revision, filePath]);
  if (!info) return null;
  const scale = doc ? Math.min(1, 1240 / (doc.widthIn * 96)) : 1;
  const exportPdf = async () => {
    setStatus('');
    const r = await store.run(() => store.api.print.lookAheadPdf(paper));
    if (r.ok) setStatus(`Saved ${r.value.filePath}`);
  };
  return (
    <div className="view view-column" aria-label="3-week look-ahead">
      <div className="toolbar">
        <span className="toolbar-title">3-week look-ahead</span>
        <div className="seg" role="group" aria-label="Paper size">
          {PAPERS.map(([id, label]) => (
            <button key={id} type="button" className="btn" aria-pressed={paper === id} onClick={() => setPaper(id)}>
              {label}
            </button>
          ))}
        </div>
        <span className="muted">{doc ? `${doc.sheets} sheet(s)` : ''}</span>
        <span className="toolbar-spacer" />
        <span className="muted small">{status}</span>
        <button type="button" className="btn btn-primary" onClick={() => void exportPdf()}>
          Print / Export PDF
        </button>
      </div>
      <main className="preview">
        {info.project.tasks.length === 0 && <p className="hint pad">This project has no assets yet.</p>}
        {doc && info.project.tasks.length > 0 && (
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
