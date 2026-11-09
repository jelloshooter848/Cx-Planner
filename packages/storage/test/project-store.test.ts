import { mkdtempSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { riversideProject } from '@cx/fixtures';
import { APPLICATION_ID, BACKUP_DIR, FileLock, MIGRATIONS, NotAProjectFileError, ProjectLockedError, ProjectStore } from '../src/index.js';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cx-store-'));
  file = join(dir, 'Riverside.cxp');
});
afterEach(() => {
  // Leave temp dirs; the OS cleans them.
});

describe('ProjectStore', () => {
  it('round-trips a project', () => {
    const s = ProjectStore.open(file, { create: true });
    const p = riversideProject();
    s.replaceProject(p, 'test');
    expect(s.loadProject()).toEqual(p);
    s.close();
    const again = ProjectStore.open(file);
    expect(again.loadProject()).toEqual(p);
    expect(again.schemaVersion).toBe(MIGRATIONS.length);
    again.close();
  });

  it('copies the whole file for Save As', () => {
    const s = ProjectStore.open(file, { create: true });
    const p = riversideProject();
    s.replaceProject(p, 'test', 'Imported');
    const copy = join(dir, 'Copy.cxp');
    s.copyTo(copy);
    expect(() => s.copyTo(copy)).toThrow(/already exists/);
    s.close();
    expect(existsSync(`${copy}.lock`)).toBe(false);
    const c = ProjectStore.open(copy);
    expect(c.loadProject()).toEqual(p);
    expect(c.schemaVersion).toBe(MIGRATIONS.length);
    expect(c.changesSince().map((e) => e.summary)).toEqual(['Imported']);
    expect(c.getRevisionState().revision).toBe(1);
    c.close();
  });

  it('refuses a second writer while the project is open', () => {
    const s = ProjectStore.open(file, { create: true });
    expect(() => ProjectStore.open(file)).toThrow(ProjectLockedError);
    s.close();
    expect(existsSync(`${file}.lock`)).toBe(false);
    ProjectStore.open(file).close();
  });

  it('clears a stale lock left by a crashed process on this machine', () => {
    ProjectStore.open(file, { create: true }).close();
    const stale = { app: 'cx-planner', host: hostname(), user: 'x', pid: 2 ** 22 + 12345, openedAt: '2026-01-01T00:00:00Z' };
    writeFileSync(`${file}.lock`, JSON.stringify(stale));
    ProjectStore.open(file).close();
  });

  it('keeps a lock from another machine unless forced', () => {
    ProjectStore.open(file, { create: true }).close();
    writeFileSync(`${file}.lock`, JSON.stringify({ app: 'cx-planner', host: 'OFFICE-PC-2', user: 'pat', pid: 1, openedAt: '2026-11-06T08:00:00Z' }));
    try {
      ProjectStore.open(file);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ProjectLockedError);
      expect((e as Error).message).toContain('pat on OFFICE-PC-2');
    }
    ProjectStore.open(file, { forceUnlock: true }).close();
    expect(FileLock.read(`${file}.lock`)).toBeUndefined();
  });

  it('backs up on open and keeps the newest copies', () => {
    ProjectStore.open(file, { create: true }).close();
    for (let i = 0; i < 4; i++) ProjectStore.open(file, { backupKeep: 2 }).close();
    const backups = readdirSync(join(dir, BACKUP_DIR));
    expect(backups.length).toBeGreaterThanOrEqual(1);
    expect(backups.length).toBeLessThanOrEqual(2);
  });

  it('rejects files that are not projects', () => {
    const other = join(dir, 'notes.cxp');
    writeFileSync(other, 'hello, this is not sqlite');
    expect(() => ProjectStore.open(other)).toThrow();
    expect(existsSync(`${other}.lock`)).toBe(false);
  });

  it('rejects a SQLite file from another application', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const other = join(dir, 'other.cxp');
    const db = new DatabaseSync(other);
    db.exec('CREATE TABLE x (a); PRAGMA application_id = 42;');
    db.close();
    expect(() => ProjectStore.open(other)).toThrow(NotAProjectFileError);
  });

  it('logs field-level changes and reports changes since the last print', () => {
    const s = ProjectStore.open(file, { create: true });
    s.replaceProject(riversideProject());
    s.recordPrint({ kind: 'lookahead', rev: 'B', issued: '2026-11-06', paper: 'tabloid', sheets: 1, dataDate: '2026-11-06' });
    s.updateTask('t1.3', { percentComplete: 100, actualFinish: '2026-11-09', name: 'Insulation resistance test' }, 'weekly-update');
    const changes = s.changesSinceLastPrint('lookahead');
    expect(changes.map((c) => c.field)).toEqual(['percentComplete', 'actualFinish']);
    expect(changes[0]).toMatchObject({ entity: 'task', entityId: 't1.3', oldValue: 50, newValue: 100, source: 'weekly-update' });
    expect(s.loadProject().tasks.find((t) => t.id === 't1.3')!.percentComplete).toBe(100);
    s.close();
  });

  it('lists issued prints per kind with their notes', () => {
    const s = ProjectStore.open(file, { create: true });
    s.replaceProject(riversideProject());
    s.recordPrint({ kind: 'lookahead', rev: 'A', issued: '2026-11-02', paper: 'tabloid', sheets: 1, dataDate: '2026-11-02', note: 'Issued for coordination', title: '3-Week Look-Ahead' });
    s.recordPrint({ kind: 'test-sheets', rev: 'A', issued: '2026-11-02', paper: 'letter', sheets: 4, dataDate: '2026-11-02' });
    s.recordPrint({ kind: 'lookahead', rev: 'B', issued: '2026-11-06', paper: 'letter', sheets: 2, dataDate: '2026-11-06', note: 'Progress update' });
    expect(s.listPrints('lookahead').map((p) => [p.rev, p.note, p.paper])).toEqual([
      ['A', 'Issued for coordination', 'tabloid'],
      ['B', 'Progress update', 'letter'],
    ]);
    expect(s.listPrints('lookahead')[0]).toMatchObject({ title: '3-Week Look-Ahead', sheets: 1, dataDate: '2026-11-02' });
    expect(s.listPrints('test-sheets')[0]).toMatchObject({ note: '', title: '' });
    expect(s.listPrints()).toHaveLength(3);
    s.close();
  });

  it('reads back the tasks a test-sheet print covered', () => {
    const s = ProjectStore.open(file, { create: true });
    s.recordPrint({ kind: 'test-sheets', rev: 'A', issued: '2026-11-02', paper: 'letter', sheets: 2, dataDate: '2026-11-02', taskIds: ['t1.3', 't2.1'] });
    s.recordPrint({ kind: 'test-sheets', rev: 'B', issued: '2026-11-06', paper: 'letter', sheets: 0, dataDate: '2026-11-06', taskIds: [] });
    s.recordPrint({ kind: 'lookahead', rev: 'A', issued: '2026-11-06', paper: 'tabloid', sheets: 1, dataDate: '2026-11-06' });
    expect(s.listPrints().map((p) => p.taskIds)).toEqual([['t1.3', 't2.1'], [], null]);
    s.close();
    const again = ProjectStore.open(file, { backup: false });
    expect(again.listPrints('test-sheets')[0]!.taskIds).toEqual(['t1.3', 't2.1']);
    again.close();
  });

  it('opens a version 5 file whose prints have no task list', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file);
    for (const m of MIGRATIONS.slice(0, 5)) db.exec(m);
    db.exec(`PRAGMA user_version = 5; PRAGMA application_id = ${APPLICATION_ID};`);
    db.exec(
      "INSERT INTO print_record (kind, rev, issued, printed_at, paper, sheets, data_date, last_change_seq, note, title) VALUES ('test-sheets', 'A', '2026-11-02', '2026-11-02T08:00:00Z', 'letter', 3, '2026-11-02', 0, 'First issue', 'Test Sheets (3)')",
    );
    db.close();
    const s = ProjectStore.open(file, { backup: false });
    expect(s.schemaVersion).toBe(MIGRATIONS.length);
    expect(s.listPrints()).toEqual([expect.objectContaining({ kind: 'test-sheets', rev: 'A', note: 'First issue', taskIds: null })]);
    s.recordPrint({ kind: 'test-sheets', rev: 'B', issued: '2026-11-06', paper: 'letter', sheets: 1, dataDate: '2026-11-06', taskIds: ['t1.3'] });
    expect(s.listPrints().map((p) => p.taskIds)).toEqual([null, ['t1.3']]);
    s.close();
  });

  it('keeps the change log append-only', () => {
    const s = ProjectStore.open(file, { create: true });
    s.replaceProject(riversideProject());
    expect(() => s.exec('DELETE FROM change_event')).toThrow(/append-only/);
    expect(() => s.exec("UPDATE change_event SET source = 'x'")).toThrow(/append-only/);
    s.close();
  });

  it('round-trips template version and template task keys', () => {
    const s = ProjectStore.open(file, { create: true });
    const p = riversideProject();
    p.assets[0] = { ...p.assets[0]!, templateId: 'tpl-lv-swgr', templateVersion: 3 };
    p.tasks[0] = { ...p.tasks[0]!, templateKey: 'vmi' };
    s.replaceProject(p, 'test');
    expect(s.loadProject()).toEqual(p);
    s.updateTask(p.tasks[0]!.id, { templateKey: 'inspect' });
    expect(s.loadProject().tasks[0]!.templateKey).toBe('inspect');
    s.close();
  });

  it('migrates a version 1 file', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file);
    db.exec(MIGRATIONS[0]!);
    db.exec(`PRAGMA user_version = 1; PRAGMA application_id = ${APPLICATION_ID};`);
    db.exec("INSERT INTO asset (id, tag, description, template_id, sort) VALUES ('A', 'SWGR-1A', '', 'tpl', 0)");
    db.close();
    const s = ProjectStore.open(file, { backup: false });
    expect(s.schemaVersion).toBe(MIGRATIONS.length);
    expect(s.loadProject().assets).toEqual([{ id: 'A', tag: 'SWGR-1A', description: '', templateId: 'tpl' }]);
    s.close();
  });
});
