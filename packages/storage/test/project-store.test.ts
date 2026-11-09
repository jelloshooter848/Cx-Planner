import { mkdtempSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { riversideProject } from '@cx/fixtures';
import { BACKUP_DIR, FileLock, NotAProjectFileError, ProjectLockedError, ProjectStore } from '../src/index.js';

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
    expect(again.schemaVersion).toBe(1);
    again.close();
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

  it('keeps the change log append-only', () => {
    const s = ProjectStore.open(file, { create: true });
    s.replaceProject(riversideProject());
    expect(() => s.exec('DELETE FROM change_event')).toThrow(/append-only/);
    expect(() => s.exec("UPDATE change_event SET source = 'x'")).toThrow(/append-only/);
    s.close();
  });
});
