import { useEffect, useState } from 'react';
import { LOOK_AHEAD_PAPERS, type LookAheadPrintRequest, type PrintPreview } from '../../../shared/api';
import { PAPER } from '@cx/render';
import { useProject, useStore } from '../../store';

/**
 * The preview iframe is a separate document and cannot see the page's CSS variables, so the
 * frame colours are read from the design tokens and injected into it.
 */
function previewFrameCss(): string {
  const tokens = getComputedStyle(document.documentElement);
  const v = (name: string) => tokens.getPropertyValue(name).trim();
  return `.sheet{margin:0 auto 24px;box-shadow:${v('--shadow-sheet')}} body{background:${v('--bg-app')};padding:24px 0}`;
}

/**
 * Reports > 3-week look-ahead: every sheet of the next look-ahead from the data-date week,
 * as it would print. Print / Export PDF opens the Print dialog, which issues it with a revision.
 */
export function LookAheadView() {
  const store = useStore();
  const info = useProject();
  const [paper, setPaper] = useState<LookAheadPrintRequest['paper']>('tabloid');
  const [doc, setDoc] = useState<PrintPreview>();
  const revision = info?.revision;
  const filePath = info?.filePath;
  const dataDate = info?.project.dataDate;
  useEffect(() => {
    if (!dataDate) return;
    let live = true;
    const req: LookAheadPrintRequest = { kind: 'lookahead', paper, weeks: 3, start: dataDate, assetIds: null, showTimes: true, note: '' };
    void store.run(() => store.api.print.preview(req)).then((r) => live && r.ok && setDoc(r.value));
    return () => {
      live = false;
    };
  }, [store, paper, revision, filePath, dataDate]);
  if (!info) return null;
  const scale = doc ? Math.min(1, 1240 / (doc.widthIn * 96)) : 1;
  return (
    <div className="view view-column" aria-label="3-week look-ahead">
      <div className="toolbar">
        <span className="toolbar-title">3-week look-ahead</span>
        <div className="seg" role="group" aria-label="Paper size">
          {LOOK_AHEAD_PAPERS.map((id) => (
            <button key={id} type="button" className="btn" aria-pressed={paper === id} onClick={() => setPaper(id)}>
              {PAPER[id].label}
            </button>
          ))}
        </div>
        <span className="muted">{doc ? `${doc.sheets} sheet(s)` : ''}</span>
        <span className="toolbar-spacer" />
        <button type="button" className="btn btn-primary" onClick={() => void store.dispatch({ type: 'print', kind: 'lookahead' })}>
          Print / Export PDF…
        </button>
      </div>
      <main className="preview">
        {info.project.tasks.length === 0 && <p className="hint pad">This project has no assets yet.</p>}
        {doc && info.project.tasks.length > 0 && (
          <iframe
            title="Print preview"
            sandbox=""
            srcDoc={doc.html.replace('</style>', `${previewFrameCss()}</style>`)}
            style={{ width: doc.widthIn * 96 + 48, height: (doc.heightIn * 96 + 24) * doc.sheets + 48, transform: `scale(${scale})`, transformOrigin: 'top left' }}
          />
        )}
      </main>
    </div>
  );
}
