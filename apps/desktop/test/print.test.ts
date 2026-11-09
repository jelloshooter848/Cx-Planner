import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { riversideProject } from '@cx/fixtures';
import { ProjectStore } from '@cx/storage';
import { starterTemplate } from '@cx/templates';
import { FileController } from '../src/main/files.js';
import { RecentFiles, SettingsFile } from '../src/main/prefs.js';
import { PrintController } from '../src/main/print-controller.js';
import { buildPrint, revisionHistory, sheetRevision } from '../src/main/print-jobs.js';
import { ScriptedDialogs } from '../src/main/scripted-dialogs.js';
import { Session } from '../src/main/session.js';
import { checkPrintRequest } from '../src/main/validate.js';
import type { LookAheadPrintRequest } from '../src/shared/api.js';

let dir: string;
let dialogs: ScriptedDialogs;
let session: Session;
let print: PrintController;
const toPdf = vi.fn(async (html: string) => new TextEncoder().encode(`%PDF ${html.length}`));
const toPrinter = vi.fn(async () => true);
const showInFolder = vi.fn();

const lookAhead = (over: Partial<LookAheadPrintRequest> = {}): LookAheadPrintRequest => ({
  kind: 'lookahead', paper: 'tabloid', weeks: 3, start: '2026-11-02', assetIds: null, showTimes: true, note: '', ...over,
});

/** Opens the made-up Riverside project, plus one switchgear lineup added from a starter template. */
function openRiverside(withTemplate = false): void {
  const store = ProjectStore.open(join(dir, 'Riverside.cxp'), { create: true });
  store.replaceProject(riversideProject(), 'test');
  session.openStore(store);
  if (withTemplate) {
    const template = starterTemplate('starter-lv-switchgear')!;
    const r = session.apply({ kind: 'addAssetsFromTemplate', template, assets: [{ tag: 'SWGR-2B', description: 'Switchgear' }] });
    if (!r.ok) throw new Error(r.message);
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cx-print-'));
  dialogs = new ScriptedDialogs();
  session = new Session({ broadcast: () => {} });
  const files = new FileController({
    session, dialogs, recent: new RecentFiles(join(dir, 'user', 'recent.json')), settings: new SettingsFile(join(dir, 'user', 'settings.json')), defaultWorkspace: join(dir, 'ws'),
  });
  toPdf.mockClear();
  toPrinter.mockClear();
  showInFolder.mockClear();
  print = new PrintController({ session, files, toPdf, toPrinter, showInFolder });
});
afterEach(() => {
  session.dispose();
  expect(dialogs.remaining).toBe(0);
});

describe('print jobs', () => {
  it('needs an open project', () => {
    expect(print.setup()).toMatchObject({ ok: false, code: 'no-project' });
    expect(print.preview(lookAhead())).toMatchObject({ ok: false, code: 'no-project' });
  });

  it('previews a look-ahead as revision A, issued on the data date', () => {
    openRiverside();
    const r = print.preview(lookAhead({ note: 'Issued for coordination' }));
    if (!r.ok) throw new Error(r.message);
    expect(r.value).toMatchObject({ rev: 'A', issued: '2026-11-06', sheets: 1, widthIn: 17, heightIn: 11, title: '3-Week Look-Ahead: Nov 2 – Nov 20, 2026' });
    expect(r.value.html).toContain('Issued for coordination');
    expect(print.setup()).toMatchObject({ ok: true, value: { nextRevision: { lookahead: 'A', 'full-schedule': 'A', 'test-sheets': 'A' }, history: [] } });
  });

  it('exports a PDF, records it and moves that kind on to the next revision', async () => {
    openRiverside();
    dialogs.push({ save: join(dir, 'la') });
    const r = await print.exportPdf(lookAhead({ paper: 'letter', note: '  First issue  ' }));
    expect(r).toEqual({ ok: true, value: { filePath: join(dir, 'la.pdf'), rev: 'A', sheets: expect.any(Number), title: expect.stringContaining('Look-Ahead') } });
    expect(readFileSync(join(dir, 'la.pdf'), 'latin1')).toMatch(/^%PDF/);
    expect(dialogs.shown[0]!.defaultPath).toBe(join(dir, 'Riverside 3-Week Look-Ahead Nov 2 – Nov 20, 2026 Rev A.pdf'));

    const setup = print.setup();
    if (!setup.ok) throw new Error(setup.message);
    expect(setup.value.nextRevision).toEqual({ lookahead: 'B', 'full-schedule': 'A', 'test-sheets': 'A' });
    expect(setup.value.history).toEqual([expect.objectContaining({ kind: 'lookahead', rev: 'A', issued: '2026-11-06', paper: 'letter', note: 'First issue' })]);

    // The next preview is B and lists A in its revision history.
    const next = print.preview(lookAhead({ note: 'Progress update' }));
    if (!next.ok) throw new Error(next.message);
    expect(next.value.rev).toBe('B');
    expect(next.value.html).toContain('First issue');
    expect(next.value.html).toContain('Progress update');
  });

  it('records nothing when the save dialog is cancelled', async () => {
    openRiverside();
    dialogs.push({ save: undefined });
    expect(await print.exportPdf(lookAhead())).toMatchObject({ ok: false, code: 'canceled' });
    expect(toPdf).not.toHaveBeenCalled();
    expect(session.printHistory()).toEqual([]);
  });

  it('still reports a written PDF when it cannot be recorded', async () => {
    openRiverside();
    dialogs.push({ save: join(dir, 'la.pdf') });
    vi.spyOn(session, 'recordPrint').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const r = await print.exportPdf(lookAhead());
    expect(r).toMatchObject({ ok: true, value: { filePath: join(dir, 'la.pdf'), rev: 'A', notRecorded: expect.stringContaining('disk full') } });
    expect(readFileSync(join(dir, 'la.pdf'), 'latin1')).toMatch(/^%PDF/);
    expect(session.printHistory()).toEqual([]);
    expect(print.showInFolder(join(dir, 'la.pdf'))).toEqual({ ok: true, value: undefined });
  });

  it('records a print sent to the printer, but not a cancelled one', async () => {
    openRiverside();
    toPrinter.mockResolvedValueOnce(false);
    expect(await print.toPrinter(lookAhead())).toMatchObject({ ok: false, code: 'canceled' });
    expect(await print.toPrinter({ kind: 'full-schedule', paper: 'arch-d', dayWidthIn: null, assetIds: null, note: '' })).toMatchObject({ ok: true, value: { rev: 'A' } });
    const paper = toPrinter.mock.calls[1] as unknown as [string, { widthIn: number; heightIn: number }];
    expect(paper[1]).toMatchObject({ widthIn: 36, heightIn: 24 });
    expect(session.printHistory().map((p) => [p.kind, p.rev, p.paper])).toEqual([['full-schedule', 'A', 'arch-d']]);
  });

  it('shows only PDFs it wrote in the file manager', async () => {
    openRiverside();
    expect(print.showInFolder(join(dir, 'Riverside.cxp'))).toMatchObject({ ok: false, code: 'invalid-input' });
    dialogs.push({ save: join(dir, 'la.pdf') });
    await print.exportPdf(lookAhead());
    expect(print.showInFolder(join(dir, 'la.pdf'))).toEqual({ ok: true, value: undefined });
    expect(showInFolder).toHaveBeenCalledWith(join(dir, 'la.pdf'));
  });

  it('limits schedule prints to chosen assets', () => {
    openRiverside();
    const all = print.preview(lookAhead());
    const one = print.preview(lookAhead({ assetIds: ['gen-1', 'no-such-asset'] }));
    if (!all.ok || !one.ok) throw new Error('preview failed');
    expect(all.value.html).toContain('SWGR-1A');
    expect(one.value.html).not.toContain('SWGR-1A');
    expect(print.preview(lookAhead({ assetIds: ['no-such-asset'] }))).toMatchObject({ ok: false, code: 'invalid-input' });
  });

  it('prints the full schedule on large-format paper', () => {
    openRiverside();
    const r = print.preview({ kind: 'full-schedule', paper: 'ansi-d', dayWidthIn: 0.42, assetIds: null, note: '' });
    expect(r).toMatchObject({ ok: true, value: { widthIn: 34, heightIn: 22, title: 'Full Commissioning Schedule', rev: 'A' } });
  });

  it('lists tasks with checklists and prints one Letter sheet per chosen task', () => {
    openRiverside(true);
    const setup = print.setup();
    if (!setup.ok) throw new Error(setup.message);
    const tasks = setup.value.checklistTasks;
    expect(tasks.length).toBeGreaterThan(1);
    expect(tasks.every((t) => t.items > 0)).toBe(true);
    const r = print.preview({ kind: 'test-sheets', taskIds: tasks.slice(0, 2).map((t) => t.taskId), note: '' });
    if (!r.ok) throw new Error(r.message);
    expect(r.value).toMatchObject({ widthIn: 8.5, heightIn: 11, rev: 'A', title: 'Test Sheets (2)' });
    expect(r.value.sheets).toBeGreaterThanOrEqual(2);
    // Sheets are numbered through the whole document, so the preview can page through them.
    const numbers = [...r.value.html.matchAll(/data-sheet="(\d+)"/g)].map((m) => Number(m[1]));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    expect(print.preview({ kind: 'test-sheets', taskIds: ['t1.1'], note: '' })).toMatchObject({ ok: false, code: 'invalid-input' });
  });

  it('gives each test sheet its own revision, counted from the prints that covered its task', async () => {
    openRiverside(true);
    const setup = print.setup();
    if (!setup.ok) throw new Error(setup.message);
    const [a, b, c] = setup.value.checklistTasks;
    if (!a || !b || !c) throw new Error('needs three checklist tasks');
    const tag = (t: typeof a) => session.project!.assets.find((x) => x.id === t.assetId)!.tag;
    const ref = (t: typeof a, rev: string) => `Sheet ${tag(t)}-${t.code} · Rev ${rev}<`;

    expect(await print.toPrinter({ kind: 'test-sheets', taskIds: [a.taskId, b.taskId], note: '' })).toMatchObject({ ok: true, value: { rev: 'A' } });
    expect(session.printHistory().map((r) => r.taskIds)).toEqual([[a.taskId, b.taskId]]);

    const r = print.preview({ kind: 'test-sheets', taskIds: [b.taskId, c.taskId], note: '' });
    if (!r.ok) throw new Error(r.message);
    // The print as a whole is the second test-sheet issue; c's sheet is its first issue.
    expect(r.value.rev).toBe('B');
    expect(r.value.html).toContain(ref(b, 'B'));
    expect(r.value.html).toContain(ref(c, 'A'));
    expect(r.value.html).not.toContain(ref(c, 'B'));

    expect(await print.toPrinter({ kind: 'test-sheets', taskIds: [b.taskId, c.taskId], note: '' })).toMatchObject({ ok: true, value: { rev: 'B' } });
    const history = session.printHistory();
    expect([a, b, c].map((t) => sheetRevision(history, t.taskId))).toEqual(['B', 'C', 'B']);
    // Other kinds record no task list.
    await print.toPrinter(lookAhead());
    expect(session.printHistory().at(-1)!.taskIds).toBeNull();
  });

  it('does not count test-sheet prints recorded without a task list', () => {
    const old = { id: 1, kind: 'test-sheets', rev: 'A', issued: '2026-10-30', printedAt: '', paper: 'letter', sheets: 1, dataDate: '2026-10-30', lastChangeSeq: 0, note: '', title: '', taskIds: null };
    const listed = { ...old, id: 2, rev: 'B', taskIds: ['t1'] };
    expect(sheetRevision([old, listed], 't1')).toBe('B');
    expect(sheetRevision([old, listed], 't2')).toBe('A');
    expect(sheetRevision([{ ...listed, kind: 'lookahead' }], 't1')).toBe('A');
  });

  it('prints the template\'s acceptance criteria on the test sheet', () => {
    openRiverside(true);
    const setup = print.setup();
    if (!setup.ok) throw new Error(setup.message);
    const torque = setup.value.checklistTasks.find((t) => t.testForm === 'Torque record')!;
    const r = print.preview({ kind: 'test-sheets', taskIds: [torque.taskId], note: '' });
    if (!r.ok) throw new Error(r.message);
    expect(r.value.html).toContain('>Acceptance<');
    expect(r.value.html).toContain('Per mfr. torque table');
  });

  it('builds without Electron, from the project and its print history', () => {
    const history = [{ id: 1, kind: 'lookahead', rev: 'C', issued: '2026-10-30', printedAt: '', paper: 'tabloid', sheets: 1, dataDate: '2026-10-30', lastChangeSeq: 0, note: '', title: '', taskIds: null }];
    const p = buildPrint({ project: riversideProject(), templates: [], history, request: lookAhead() });
    expect(p).toMatchObject({ rev: 'D', kind: 'lookahead', paperId: 'tabloid' });
    // A blank note reads "Issued" in the revision history.
    expect(p.html).toMatch(/>C<\/tspan> · Oct 30 · Issued/);
  });
});

describe('revisionHistory', () => {
  const rec = (id: number, rev: string, issued: string, kind = 'lookahead') =>
    ({ id, kind, rev, issued, printedAt: '', paper: 'tabloid', sheets: 1, dataDate: issued, lastChangeSeq: 0, note: '', title: '', taskIds: null });

  it('keeps the revision being issued, even when the data date moved back', () => {
    const history = [rec(1, 'A', '2026-10-02'), rec(2, 'B', '2026-10-09'), rec(4, 'D', '2026-10-23'), rec(3, 'C', '2026-10-16'), rec(5, 'A', '2026-10-30', 'test-sheets')];
    const revs = revisionHistory(history, 'lookahead', { rev: 'E', date: '2026-10-01', note: 'Re-issue' });
    expect(revs.map((r) => r.rev)).toEqual(['C', 'D', 'E']);
    expect(revs.map((r) => r.note)).toEqual(['Issued', 'Issued', 'Re-issue']);
  });
});

describe('checkPrintRequest', () => {
  it('accepts each kind and trims the note', () => {
    expect(checkPrintRequest({ ...lookAhead(), note: ' x ', extra: 1 })).toEqual({ ...lookAhead(), note: 'x' });
    expect(checkPrintRequest({ kind: 'full-schedule', paper: 'arch-d', dayWidthIn: null, assetIds: ['a'], note: '' })).toEqual({ kind: 'full-schedule', paper: 'arch-d', dayWidthIn: null, assetIds: ['a'], note: '' });
    expect(checkPrintRequest({ kind: 'test-sheets', taskIds: ['t'], note: '' })).toEqual({ kind: 'test-sheets', taskIds: ['t'], note: '' });
  });

  it('refuses the wrong paper, weeks, dates and shapes', () => {
    const bad = [
      null,
      { ...lookAhead(), paper: 'ansi-d' },
      { ...lookAhead(), weeks: 5 },
      { ...lookAhead(), start: '2026-02-31' },
      { ...lookAhead(), assetIds: [1] },
      { ...lookAhead(), showTimes: 'yes' },
      { ...lookAhead(), note: 'x'.repeat(201) },
      { kind: 'full-schedule', paper: 'letter', dayWidthIn: null, assetIds: null, note: '' },
      { kind: 'full-schedule', paper: 'arch-d', dayWidthIn: 50, assetIds: null, note: '' },
      { kind: 'test-sheets', taskIds: 'all', note: '' },
      { kind: 'poster', note: '' },
    ];
    for (const v of bad) expect(() => checkPrintRequest(v), JSON.stringify(v)).toThrow();
  });
});
