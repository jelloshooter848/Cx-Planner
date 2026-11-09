import { useCallback, useEffect, useRef, useState } from 'react';
import {
  latestItemValues,
  readPacket,
  RESULTS_EXT,
  samplePacket,
  writePacket,
  writeResults,
  type PacketManifest,
  type ResultRecord,
} from '@cx/packet';
import { appendRecord, listPackets, nextTimestamp, markExported, recordsFor, savePacket } from './db';

type Rec = ResultRecord & { exported: boolean; packetId?: string };
type View = { name: 'home' } | { name: 'sheet'; packet: PacketManifest; sheetId: string } | { name: 'sign'; packet: PacketManifest; sheetId: string };

const uid = () => crypto.randomUUID();

export function App() {
  const [view, setView] = useState<View>({ name: 'home' });
  const [packets, setPackets] = useState<PacketManifest[]>([]);
  const [error, setError] = useState<string>();
  const refresh = useCallback(() => listPackets().then(setPackets), []);
  useEffect(() => void refresh(), [refresh]);

  async function importFile(file: File) {
    setError(undefined);
    try {
      const manifest = readPacket(new Uint8Array(await file.arrayBuffer()));
      await savePacket(manifest);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const home = (
    <>
      <header>
        <h1>Cx Field</h1>
        <p className="muted">Packets on this device</p>
      </header>
      {error && <p className="error">{error}</p>}
      {packets.length === 0 && <p className="muted">No packets yet. Open a packet file you were sent.</p>}
      {packets.map((p) => (
        <section key={p.packetId} className="card">
          <div className="row">
            <strong>{p.packetId}</strong>
            <span className="muted">{p.dueDate ? `Due ${p.dueDate}` : ''}</span>
          </div>
          <p className="muted">{p.projectName} · from {p.issuedBy}</p>
          {p.sheets.map((s) => {
            const active = view.name !== 'home' && view.packet.packetId === p.packetId && view.sheetId === s.id;
            return (
              <button key={s.id} className={`list${active ? ' active' : ''}`} aria-current={active || undefined} onClick={() => setView({ name: 'sheet', packet: p, sheetId: s.id })}>
                <span>{s.title}</span>
                <span className="muted">{s.assetTag} · {s.items.length} items</span>
              </button>
            );
          })}
        </section>
      ))}
      <label className="button primary">
        Open packet file
        {/* No accept filter: iOS greys out unknown extensions such as .cxpk. */}
        <input type="file" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
      </label>
      <button className="button" onClick={() => importFile(new File([writePacket(samplePacket()) as BlobPart], 'sample.cxpk'))}>
        Load sample packet
      </button>
      <Diagnostics />
    </>
  );

  // Phones show one pane at a time. On iPad-width screens the packet list stays on the left
  // and the checklist or sign-off fills the right, in portrait and landscape.
  return (
    <div className={`shell${view.name === 'home' ? '' : ' has-detail'}`}>
      <aside className="pane list-pane">{home}</aside>
      <section className="pane detail-pane">
        {view.name === 'sheet' && (
          <SheetView key={view.sheetId} packet={view.packet} sheetId={view.sheetId} onBack={() => setView({ name: 'home' })} onReview={() => setView({ ...view, name: 'sign' })} />
        )}
        {view.name === 'sign' && <SignView key={view.sheetId} packet={view.packet} sheetId={view.sheetId} onBack={() => setView({ ...view, name: 'sheet' })} />}
        {view.name === 'home' && <p className="muted empty">Choose a checklist from a packet.</p>}
      </section>
    </div>
  );
}

function SheetView({ packet, sheetId, onBack, onReview }: { packet: PacketManifest; sheetId: string; onBack: () => void; onReview: () => void }) {
  const sheet = packet.sheets.find((s) => s.id === sheetId)!;
  const [records, setRecords] = useState<Rec[]>([]);
  const load = useCallback(() => recordsFor(packet.packetId).then(setRecords), [packet.packetId]);
  useEffect(() => void load(), [load]);
  const latest = latestItemValues(records);

  async function answer(itemId: string, value: 'pass' | 'fail' | 'na') {
    await appendRecord(packet.packetId, { kind: 'item', id: uid(), at: nextTimestamp(), sheetId, itemId, value });
    await load();
  }

  return (
    <div className="detail">
      <button className="back" data-pane="list" onClick={onBack}>‹ Packets</button>
      <h1>{sheet.title}</h1>
      <p className="muted">{sheet.assetTag} · {packet.packetId}</p>
      {sheet.items.map((item, i) => {
        const v = latest.get(`${sheetId}/${item.id}`)?.value;
        return (
          <section key={item.id} className="card item">
            <p className="text"><span className="num">{i + 1}</span> {item.text}</p>
            <div className="seg" role="group" aria-label={`Item ${i + 1}`}>
              {(['pass', 'fail', 'na'] as const).map((opt) => (
                <button key={opt} aria-pressed={v === opt} className={v === opt ? `on ${opt}` : ''} onClick={() => answer(item.id, opt)}>
                  {opt === 'pass' ? '✓ Pass' : opt === 'fail' ? '✗ Fail' : '– N/A'}
                </button>
              ))}
            </div>
          </section>
        );
      })}
      <button className="button primary" onClick={onReview}>Review and sign</button>
    </div>
  );
}

function SignView({ packet, sheetId, onBack }: { packet: PacketManifest; sheetId: string; onBack: () => void }) {
  const sheet = packet.sheets.find((s) => s.id === sheetId)!;
  const [records, setRecords] = useState<Rec[]>([]);
  const [initials, setInitials] = useState('');
  const [signature, setSignature] = useState('');
  const [status, setStatus] = useState<string>();
  const load = useCallback(() => recordsFor(packet.packetId).then(setRecords), [packet.packetId]);
  useEffect(() => void load(), [load]);
  const latest = [...latestItemValues(records).values()].filter((r) => r.sheetId === sheetId);
  const count = (v: string) => latest.filter((r) => r.value === v).length;
  const unanswered = sheet.items.length - latest.length;
  const unexported = records.filter((r) => !r.exported).length;
  const signed = records.some((r) => r.kind === 'signoff' && r.sheetId === sheetId);

  async function complete() {
    await appendRecord(packet.packetId, { kind: 'signoff', id: uid(), at: nextTimestamp(), sheetId, initials: initials.trim(), ...(signature ? { signature } : {}) });
    await load();
  }

  async function exportResults() {
    const all = await recordsFor(packet.packetId);
    const bytes = writeResults({
      format: 'cx-results', version: 1, packetId: packet.packetId, device: navigator.userAgent.slice(0, 120),
      exportedAt: new Date().toISOString(), records: all.map(({ exported: _e, packetId: _p, ...r }) => r as ResultRecord),
    });
    const name = `${packet.packetId}-results${RESULTS_EXT}`;
    const file = new File([bytes as BlobPart], name, { type: 'application/zip' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        setStatus('Shared. Send it back to the office.');
      } else {
        const url = URL.createObjectURL(file);
        const a = Object.assign(document.createElement('a'), { href: url, download: name });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        setStatus(`Saved ${name}. Send it back to the office.`);
      }
      await markExported(all.map((r) => r.id));
      await load();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setStatus(`Export failed: ${(e as Error).message}`);
    }
  }

  return (
    <div className="detail">
      <button className="back" onClick={onBack}>‹ Checklist</button>
      <h1>Review and sign</h1>
      <p className="muted">{sheet.title} · {sheet.assetTag}</p>
      <div className="tiles">
        <div className="tile pass"><b>{count('pass')}</b>Pass</div>
        <div className="tile fail"><b>{count('fail')}</b>Fail</div>
        <div className="tile"><b>{count('na')}</b>N/A</div>
      </div>
      {unanswered > 0 && <p className="error">{unanswered} item(s) not answered yet.</p>}
      {!signed ? (
        <>
          <label className="field">Initials<input value={initials} onChange={(e) => setInitials(e.target.value)} maxLength={4} autoCapitalize="characters" /></label>
          <p className="label">Signature</p>
          <SignaturePad onChange={setSignature} />
          <button className="button primary" disabled={!initials.trim() || unanswered > 0} onClick={complete}>Mark sheet complete</button>
        </>
      ) : (
        <p className="ok">Signed off.</p>
      )}
      {unexported > 0 && <p className="warn">{unexported} result(s) not sent yet. Results stay on this phone until exported.</p>}
      <button className="button" onClick={exportResults}>Export results ({packet.packetId})</button>
      {status && <p className="muted">{status}</p>}
    </div>
  );
}

function SignaturePad({ onChange }: { onChange: (path: string) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const [d, setD] = useState('');
  const drawing = useRef(false);
  const point = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return `${Math.round(((e.clientX - r.left) / r.width) * 300)} ${Math.round(((e.clientY - r.top) / r.height) * 100)}`;
  };
  return (
    <div className="sig">
      <svg
        ref={ref}
        viewBox="0 0 300 100"
        onPointerDown={(e) => { drawing.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); setD((p) => `${p} M${point(e)}`); }}
        onPointerMove={(e) => drawing.current && setD((p) => `${p} L${point(e)}`)}
        onPointerUp={() => { drawing.current = false; onChange(d.trim()); }}
      >
        {d ? <path d={d} fill="none" stroke="#111" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> : <text x="150" y="55" textAnchor="middle" fill="#888" fontSize="14">Sign here</text>}
      </svg>
      {d && <button className="link" onClick={() => { setD(''); onChange(''); }}>Clear</button>}
    </div>
  );
}

/** Spike checks to report back from real phones. */
function Diagnostics() {
  const [info, setInfo] = useState<Record<string, string>>({});
  async function run(askPersist: boolean) {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    const persistedBefore = (await navigator.storage?.persisted?.()) ?? false;
    const persisted = askPersist && !persistedBefore ? await navigator.storage?.persist?.() : persistedBefore;
    const est = await navigator.storage?.estimate?.();
    const probe = new File([new Uint8Array([1])], 'probe.cxpr', { type: 'application/zip' });
    setInfo({
      'Installed (home screen)': standalone ? 'yes' : 'no: install from the browser menu',
      'Persistent storage': persisted ? 'granted' : 'not granted',
      'Storage used / quota': est ? `${((est.usage ?? 0) / 1e6).toFixed(1)} MB / ${((est.quota ?? 0) / 1e6).toFixed(0)} MB` : 'unknown',
      'Share files': navigator.canShare?.({ files: [probe] }) ? 'yes' : 'no (download fallback)',
      'Offline ready': navigator.serviceWorker?.controller ? 'yes' : 'not yet (reload once)',
      Online: navigator.onLine ? 'yes' : 'no',
    });
  }
  useEffect(() => void run(false), []);
  return (
    <details className="card diag">
      <summary>Device checks</summary>
      <dl>{Object.entries(info).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <button className="button" onClick={() => run(true)}>Request persistent storage</button>
    </details>
  );
}
