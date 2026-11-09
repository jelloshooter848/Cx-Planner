import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { riversideProject } from '@cx/fixtures';
import { BACKUP_DIR, ProjectStore, WorkspaceStore } from '@cx/storage';
import { emptyProject, FileController, projectArg, safeFileName } from '../src/main/files.js';
import { RecentFiles, SettingsFile } from '../src/main/prefs.js';
import { ScriptedDialogs } from '../src/main/scripted-dialogs.js';
import { Session } from '../src/main/session.js';

let dir: string;
let dialogs: ScriptedDialogs;
let session: Session;
let recent: RecentFiles;
let settings: SettingsFile;
let files: FileController;

/** A lock file as left by a session on another computer. */
function lockFromElsewhere(path: string): void {
  writeFileSync(`${path}.lock`, JSON.stringify({ app: 'cx-planner', host: 'OTHER-PC', user: 'pat', pid: 1, openedAt: '2026-11-09T08:00:00.000Z' }));
}

function sampleFile(name = 'Riverside.cxp'): string {
  const path = join(dir, name);
  const s = ProjectStore.open(path, { create: true });
  s.replaceProject(riversideProject(), 'test');
  s.close();
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cx-files-'));
  dialogs = new ScriptedDialogs();
  session = new Session({ broadcast: () => {}, recent: () => recent.list() });
  recent = new RecentFiles(join(dir, 'user', 'recent.json'));
  settings = new SettingsFile(join(dir, 'user', 'settings.json'));
  files = new FileController({ session, dialogs, recent, settings, defaultWorkspace: join(dir, 'Cx Planner Workspace') });
});
afterEach(() => {
  session.dispose();
  expect(dialogs.remaining).toBe(0);
});

describe('new project', () => {
  it('asks where to save (in the workspace) and creates an empty project', async () => {
    const target = join(dir, 'Job 42');
    dialogs.push({ save: target });
    const r = await files.newProject({ name: '  Job 42  ', startDate: '2026-11-02' });
    expect(r).toEqual({ ok: true, value: { filePath: `${target}.cxp` } });
    expect(dialogs.shown[0]!.defaultPath).toBe(join(dir, 'Cx Planner Workspace', 'Job 42.cxp'));
    const s = session.getState();
    expect(s.project).toMatchObject({ name: 'Job 42', startDate: '2026-11-02', dataDate: '2026-11-02', tasks: [] });
    expect(s.fileName).toBe('Job 42.cxp');
    expect(s.recent.map((x) => x.path)).toEqual([`${target}.cxp`]);
    expect(s.revision).toBe(1);
  });

  it('does nothing when the save dialog is cancelled', async () => {
    dialogs.push({ save: undefined });
    expect(await files.newProject({ name: 'X', startDate: '2026-11-02' })).toMatchObject({ ok: false, code: 'canceled' });
    expect(session.project).toBeNull();
  });

  it('replaces an existing file the user chose to overwrite', async () => {
    const path = sampleFile();
    dialogs.push({ save: path });
    expect((await files.newProject({ name: 'Fresh', startDate: '2026-11-02' })).ok).toBe(true);
    expect(session.project!.tasks).toEqual([]);
  });

  it('asks before replacing a file whose name only matches once .cxp is added', async () => {
    const path = sampleFile('Existing.cxp');
    dialogs.push({ save: join(dir, 'Existing') }, { message: 0, expect: 'Existing\\.cxp already exists' });
    expect(await files.newProject({ name: 'Fresh', startDate: '2026-11-02' })).toMatchObject({ ok: false, code: 'canceled' });
    const kept = ProjectStore.open(path);
    expect(kept.loadProject().tasks.length).toBeGreaterThan(0);
    kept.close();
    dialogs.push({ save: join(dir, 'Existing') }, { message: 1, expect: 'Replace it' });
    expect((await files.newProject({ name: 'Fresh', startDate: '2026-11-02' })).ok).toBe(true);
    expect(session.project!.tasks).toEqual([]);
  });

  it('removes a stale journal so it cannot be rolled back onto the new file', async () => {
    const path = sampleFile();
    writeFileSync(`${path}-journal`, 'left by a crash');
    dialogs.push({ save: path });
    expect((await files.newProject({ name: 'Fresh', startDate: '2026-11-02' })).ok).toBe(true);
    expect(existsSync(`${path}-journal`)).toBe(false);
    expect(session.project!.name).toBe('Fresh');
  });

  it('refuses to replace a file someone else has open', async () => {
    const path = sampleFile();
    lockFromElsewhere(path);
    dialogs.push({ save: path }, { message: 0, expect: "can't be replaced[\\s\\S]*pat on OTHER-PC" });
    expect(await files.newProject({ name: 'Fresh', startDate: '2026-11-02' })).toMatchObject({ ok: false, code: 'locked' });
    expect(existsSync(path)).toBe(true);
  });

  it('reopens the open file when replacing it with a new project fails', async () => {
    const path = sampleFile();
    dialogs.push({ open: path });
    expect((await files.openWithDialog()).ok).toBe(true);
    // Someone grabs the file between our close and the replace; their lock goes away later.
    const close = session.closeProject.bind(session);
    vi.spyOn(session, 'closeProject').mockImplementationOnce(() => {
      close();
      lockFromElsewhere(path);
    });
    const message = dialogs.message.bind(dialogs);
    vi.spyOn(dialogs, 'message').mockImplementationOnce(async (o) => {
      const button = await message(o);
      rmSync(`${path}.lock`);
      return button;
    });
    dialogs.push({ save: path }, { message: 0, expect: "can't be replaced" });
    expect(await files.newProject({ name: 'Fresh', startDate: '2026-11-02' })).toMatchObject({ ok: false, code: 'locked' });
    expect(session.filePath).toBe(path);
    expect(session.project!.tasks.length).toBeGreaterThan(0);
  });

  it('makes empty projects with their own id and default calendar', () => {
    const a = emptyProject({ name: 'A', startDate: '2026-01-05' });
    const b = emptyProject({ name: 'A', startDate: '2026-01-05' });
    expect(a.id).not.toBe(b.id);
    expect(a.calendar.workWeekdays).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('open', () => {
  it('opens from the dialog and adds to the recent list', async () => {
    const path = sampleFile();
    dialogs.push({ open: path });
    expect(await files.openWithDialog()).toEqual({ ok: true, value: { filePath: path } });
    expect(session.getState().fileName).toBe('Riverside.cxp');
    expect(recent.list()).toEqual([path]);
  });

  it('keeps the current project when opening another fails', async () => {
    const good = sampleFile();
    await files.openPath(good);
    const bad = join(dir, 'notes.cxp');
    writeFileSync(bad, 'just some text, not a database at all. '.repeat(200));
    dialogs.push({ message: 0, expect: 'not a Cx Planner project file' });
    expect(await files.openPath(bad)).toMatchObject({ ok: false, code: 'file-error' });
    expect(session.filePath).toBe(good);
  });

  it('explains a damaged file and points at the backups folder', async () => {
    const path = sampleFile();
    const bytes = readFileSync(path);
    // Scribble over the pages after the header (keeps the SQLite header, breaks the b-trees).
    for (let i = 4096; i < bytes.length; i += 7) bytes[i] = 0xa5;
    writeFileSync(path, bytes);
    dialogs.push({ message: 0, expect: `damaged[\\s\\S]*${BACKUP_DIR.replace('.', '\\.')}` });
    expect(await files.openPath(path)).toMatchObject({ ok: false, code: 'file-error' });
  });

  it('names who holds the lock and opens anyway only after confirmation', async () => {
    const path = sampleFile();
    lockFromElsewhere(path);
    dialogs.push({ message: 0, expect: 'open by pat on OTHER-PC' });
    expect(await files.openPath(path)).toMatchObject({ ok: false, code: 'locked' });
    dialogs.push({ message: 1 }, { message: 0, expect: 'read-only is coming' });
    expect(await files.openPath(path)).toMatchObject({ ok: false, code: 'locked' });
    dialogs.push({ message: 2 }, { message: 0, expect: 'Break the lock' });
    expect(await files.openPath(path)).toMatchObject({ ok: false, code: 'locked' });
    expect(session.project).toBeNull();
    dialogs.push({ message: 2 }, { message: 1 });
    expect((await files.openPath(path)).ok).toBe(true);
    expect(JSON.parse(readFileSync(`${path}.lock`, 'utf8')).host).toBe(hostname());
  });

  it('opens recent files only from the list, and drops missing ones', async () => {
    const path = sampleFile();
    expect(await files.openRecent(path)).toMatchObject({ ok: false, code: 'invalid-input' });
    recent.add(path);
    recent.add(join(dir, 'gone.cxp'));
    dialogs.push({ message: 0, expect: 'could not be found' });
    expect(await files.openRecent(join(dir, 'gone.cxp'))).toMatchObject({ ok: false, code: 'file-error' });
    expect(recent.list()).toEqual([path]);
    expect((await files.openRecent(path)).ok).toBe(true);
  });

  it('shows a dialog and keeps the recent list clean when a file cannot be adopted', async () => {
    const path = sampleFile();
    const spy = vi.spyOn(session, 'openStore').mockImplementation((store) => {
      store.close();
      throw new Error('attempt to write a readonly database');
    });
    dialogs.push({ message: 0, expect: "couldn't be opened[\\s\\S]*readonly" });
    expect(await files.openPath(path)).toMatchObject({ ok: false, code: 'file-error' });
    spy.mockRestore();
    expect(recent.list()).toEqual([]);
  });

  it('opening the file already open is a no-op', async () => {
    const path = sampleFile();
    await files.openPath(path);
    expect(await files.openPath(path)).toEqual({ ok: true, value: { filePath: path } });
  });
});

describe('save as and close', () => {
  it('copies to a new file and keeps working there', async () => {
    const path = sampleFile();
    await files.openPath(path);
    const target = join(dir, 'Elsewhere', 'Riverside v2');
    mkdirSync(join(dir, 'Elsewhere'));
    dialogs.push({ save: target });
    expect(await files.saveAs()).toEqual({ ok: true, value: { filePath: `${target}.cxp` } });
    expect(dialogs.shown[0]!.defaultPath).toBe(join(dir, 'Riverside copy.cxp'));
    expect(session.getState().fileName).toBe('Riverside v2.cxp');
    // The original is free again; the copy is locked by us.
    ProjectStore.open(path).close();
    expect(existsSync(`${target}.cxp.lock`)).toBe(true);
    const t = session.project!.tasks[0]!;
    session.apply({ kind: 'updateTask', id: t.id, patch: { name: 'Only in the copy' } });
    files.close();
    const orig = ProjectStore.open(path);
    expect(orig.loadProject().tasks[0]!.name).toBe(t.name);
    orig.close();
    const copy = ProjectStore.open(`${target}.cxp`);
    expect(copy.loadProject().tasks[0]!.name).toBe('Only in the copy');
    copy.close();
    expect(recent.list()[0]).toBe(`${target}.cxp`);
  });

  it('needs an open project', async () => {
    expect(await files.saveAs()).toMatchObject({ ok: false, code: 'no-project' });
  });
});

describe('workspace', () => {
  it('asks on first run, creates the suggested folder and remembers it', async () => {
    dialogs.push({ message: 0, expect: 'Where should Cx Planner keep your workspace' });
    await files.ensureWorkspace();
    const ws = join(dir, 'Cx Planner Workspace');
    expect(existsSync(join(ws, 'workspace.cxw'))).toBe(true);
    expect(settings.get()).toEqual({ workspacePath: ws });
    expect(session.getState().workspacePath).toBe(ws);
    // Second run: no question.
    session.setWorkspace(null);
    await files.ensureWorkspace();
    expect(session.getState().workspacePath).toBe(ws);
  });

  it('lets the user pick another folder on first run', async () => {
    const chosen = join(dir, 'Shared', 'WS');
    dialogs.push({ message: 1 }, { open: chosen });
    await files.ensureWorkspace();
    expect(settings.get().workspacePath).toBe(chosen);
  });

  it('offers another folder when the workspace cannot be opened', async () => {
    const bad = join(dir, 'Bad');
    mkdirSync(bad);
    writeFileSync(join(bad, 'workspace.cxw'), 'not a database '.repeat(500));
    settings.update({ workspacePath: bad });
    const good = join(dir, 'Good');
    dialogs.push({ message: 0, expect: "couldn't be opened" }, { message: 1, expect: 'another workspace' }, { open: good });
    await files.ensureWorkspace();
    expect(session.getState().workspacePath).toBe(good);
  });

  it('switches workspace from the menu', async () => {
    const other = join(dir, 'Other');
    dialogs.push({ open: other });
    expect(await files.chooseWorkspace()).toEqual({ ok: true, value: { workspacePath: other } });
    expect(settings.get().workspacePath).toBe(other);
  });
});

describe('template files', () => {
  beforeEach(() => session.setWorkspace(WorkspaceStore.open(join(dir, 'ws'), { create: true })));

  it('exports and imports a template', async () => {
    const id = session.workspace!.listTemplates()[0]!.id;
    const target = join(dir, 'tpl');
    dialogs.push({ save: target });
    expect(await files.exportTemplate(id)).toEqual({ ok: true, value: { filePath: `${target}.json` } });
    dialogs.push({ open: `${target}.json` });
    const r = await files.importTemplate();
    expect(r).toMatchObject({ ok: true, value: { idChanged: true, template: { kind: 'custom' } } });
  });

  it('asks before overwriting an existing export once .json is added', async () => {
    const id = session.workspace!.listTemplates()[0]!.id;
    writeFileSync(join(dir, 'tpl.json'), 'keep me');
    dialogs.push({ save: join(dir, 'tpl') }, { message: 0, expect: 'tpl\\.json already exists' });
    expect(await files.exportTemplate(id)).toMatchObject({ ok: false, code: 'canceled' });
    expect(readFileSync(join(dir, 'tpl.json'), 'utf8')).toBe('keep me');
  });

  it('explains a file that is not a template', async () => {
    const path = join(dir, 'nope.json');
    writeFileSync(path, '{"hello": 1}');
    dialogs.push({ open: path }, { message: 0, expect: "can't be imported[\\s\\S]*cx-template" });
    expect(await files.importTemplate()).toMatchObject({ ok: false, code: 'invalid-template-file' });
  });

  it('reports an unknown template on export', async () => {
    expect(await files.exportTemplate('nope')).toMatchObject({ ok: false, code: 'unknown-template' });
  });
});

describe('helpers', () => {
  it('finds a project file on the command line', () => {
    expect(projectArg(['--no-sandbox', '.', 'Job.CXP'], '/work')).toBe(resolve('/work', 'Job.CXP'));
    expect(projectArg(['.', '--spike-pdf'])).toBeUndefined();
  });

  it('makes safe file names', () => {
    expect(safeFileName('Riverside: Bldg A / Phase 2?')).toBe('Riverside Bldg A Phase 2');
    expect(safeFileName(' ... ')).toBe('Untitled');
  });
});
