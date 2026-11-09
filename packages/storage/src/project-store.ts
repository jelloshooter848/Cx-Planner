import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Asset, Dependency, Project, Readiness, Task } from '@cx/core';
import { backupBeforeOpen } from './backup.js';
import { FileLock } from './lock.js';
import { APPLICATION_ID, MIGRATIONS } from './schema.js';

export class NotAProjectFileError extends Error {
  constructor(path: string) {
    super(`${path} is not a Cx Planner project file`);
    this.name = 'NotAProjectFileError';
  }
}

export class ProjectFileCorruptError extends Error {
  constructor(path: string, detail: string) {
    super(`${path} failed its integrity check: ${detail}`);
    this.name = 'ProjectFileCorruptError';
  }
}

export interface OpenOptions {
  /** Create the file if it does not exist. */
  create?: boolean;
  /** Break another session's lock (only after the user confirms). */
  forceUnlock?: boolean;
  /** Copy the file to .cx-backups before opening. Default true. */
  backup?: boolean;
  backupKeep?: number;
}

export interface ChangeEvent {
  seq: number;
  at: string;
  source: string;
  entity: string;
  entityId: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
}

type TaskPatch = Partial<Omit<Task, 'id'>>;

const TASK_FIELDS: Record<keyof TaskPatch, string> = {
  assetId: 'asset_id',
  code: 'code',
  name: 'name',
  type: 'type',
  durationDays: 'duration_days',
  percentComplete: 'percent_complete',
  responsible: 'responsible',
  startNoEarlierThan: 'start_no_earlier_than',
  actualStart: 'actual_start',
  actualFinish: 'actual_finish',
  readiness: 'readiness',
  templateKey: 'template_key',
};

/**
 * One open project file. The file is a SQLite database; the store holds the
 * single-writer lock for as long as it is open.
 */
export class ProjectStore {
  private constructor(
    public readonly path: string,
    private readonly db: DatabaseSync,
    private readonly lock: FileLock,
    public readonly backupPath: string | undefined,
  ) {}

  static open(path: string, opts: OpenOptions = {}): ProjectStore {
    const exists = existsSync(path);
    if (!exists && !opts.create) throw new Error(`No project file at ${path}`);
    const lock = FileLock.acquire(`${path}.lock`, { force: opts.forceUnlock });
    let db: DatabaseSync | undefined;
    try {
      const backupPath = exists && opts.backup !== false ? backupBeforeOpen(path, opts.backupKeep) : undefined;
      db = new DatabaseSync(path);
      // Rollback journal (not WAL): WAL needs shared memory, which network shares do not provide.
      db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
      const appId = (db.prepare('PRAGMA application_id').get() as { application_id: number }).application_id;
      const version = userVersion(db);
      if (exists && !(appId === APPLICATION_ID || (appId === 0 && version === 0 && isEmpty(db)))) {
        throw new NotAProjectFileError(path);
      }
      if (exists) {
        const check = (db.prepare('PRAGMA quick_check').all() as Array<{ quick_check: string }>).map((r) => r.quick_check);
        if (check.join() !== 'ok') throw new ProjectFileCorruptError(path, check.slice(0, 3).join('; '));
      }
      if (version > MIGRATIONS.length) {
        throw new Error(`${path} was saved by a newer version of Cx Planner (schema ${version})`);
      }
      migrate(db);
      return new ProjectStore(path, db, lock, backupPath);
    } catch (e) {
      db?.close();
      lock.release();
      throw e;
    }
  }

  close(): void {
    this.db.close();
    this.lock.release();
  }

  get schemaVersion(): number {
    return userVersion(this.db);
  }

  /** Replace the whole project (new file, or import). Logged as one event. */
  replaceProject(p: Project, source = 'import'): void {
    this.tx(() => {
      const db = this.db;
      db.exec('DELETE FROM dependency; DELETE FROM task; DELETE FROM asset; DELETE FROM calendar_holiday; DELETE FROM meta;');
      const meta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
      meta.run('id', p.id);
      meta.run('name', p.name);
      meta.run('subtitle', p.subtitle ?? '');
      meta.run('start_date', p.startDate);
      meta.run('data_date', p.dataDate);
      meta.run('work_weekdays', JSON.stringify(p.calendar.workWeekdays));
      const hol = db.prepare('INSERT INTO calendar_holiday (date) VALUES (?)');
      for (const h of p.calendar.holidays) hol.run(h);
      const asset = db.prepare('INSERT INTO asset (id, tag, description, location, system, template_id, template_version, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      p.assets.forEach((a, i) =>
        asset.run(a.id, a.tag, a.description, a.location ?? null, a.system ?? null, a.templateId ?? null, a.templateVersion ?? null, i),
      );
      const task = db.prepare(
        `INSERT INTO task (id, asset_id, code, name, type, duration_days, percent_complete, responsible,
           start_no_earlier_than, actual_start, actual_finish, readiness, template_key, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      p.tasks.forEach((t, i) =>
        task.run(t.id, t.assetId, t.code, t.name, t.type, t.durationDays, t.percentComplete, t.responsible ?? null,
          t.startNoEarlierThan ?? null, t.actualStart ?? null, t.actualFinish ?? null, t.readiness ? JSON.stringify(t.readiness) : null, t.templateKey ?? null, i),
      );
      const dep = db.prepare('INSERT INTO dependency (predecessor_id, successor_id, type, lag_days) VALUES (?, ?, ?, ?)');
      for (const d of p.dependencies) dep.run(d.predecessorId, d.successorId, d.type, d.lagDays);
      this.log(source, 'project', p.id, null, null, { assets: p.assets.length, tasks: p.tasks.length });
    });
  }

  loadProject(): Project {
    const db = this.db;
    const meta = Object.fromEntries((db.prepare('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
    const assets = (db.prepare('SELECT * FROM asset ORDER BY sort').all() as Array<Record<string, string | number | null>>).map(
      (r): Asset => ({
        id: String(r.id), tag: String(r.tag), description: String(r.description ?? ''),
        ...(r.location ? { location: String(r.location) } : {}),
        ...(r.system ? { system: String(r.system) } : {}),
        ...(r.template_id ? { templateId: String(r.template_id) } : {}),
        ...(r.template_version !== null && r.template_version !== undefined ? { templateVersion: Number(r.template_version) } : {}),
      }),
    );
    const tasks = (db.prepare('SELECT * FROM task ORDER BY sort').all() as Array<Record<string, string | number | null>>).map(rowToTask);
    const dependencies = (db.prepare('SELECT * FROM dependency').all() as Array<Record<string, string | number>>).map(
      (r): Dependency => ({ predecessorId: String(r.predecessor_id), successorId: String(r.successor_id), type: r.type as Dependency['type'], lagDays: Number(r.lag_days) }),
    );
    const holidays = (db.prepare('SELECT date FROM calendar_holiday ORDER BY date').all() as Array<{ date: string }>).map((r) => r.date);
    return {
      id: meta.id ?? '',
      name: meta.name ?? '',
      ...(meta.subtitle ? { subtitle: meta.subtitle } : {}),
      startDate: meta.start_date ?? '',
      dataDate: meta.data_date ?? '',
      calendar: { workWeekdays: meta.work_weekdays ? (JSON.parse(meta.work_weekdays) as number[]) : [1, 2, 3, 4, 5], holidays },
      assets,
      tasks,
      dependencies,
    };
  }

  /** Update task fields, logging one change event per field that actually changed. */
  updateTask(id: string, patch: TaskPatch, source = 'user'): void {
    this.tx(() => {
      const row = this.db.prepare('SELECT * FROM task WHERE id = ?').get(id) as Record<string, string | number | null> | undefined;
      if (!row) throw new Error(`No task ${id}`);
      const before = rowToTask(row);
      for (const [key, value] of Object.entries(patch) as Array<[keyof TaskPatch, unknown]>) {
        const col = TASK_FIELDS[key];
        if (!col) throw new Error(`Unknown task field ${key}`);
        const oldValue = before[key];
        if (JSON.stringify(oldValue ?? null) === JSON.stringify(value ?? null)) continue;
        const stored = key === 'readiness' && value ? JSON.stringify(value) : (value ?? null);
        this.db.prepare(`UPDATE task SET ${col} = ? WHERE id = ?`).run(stored as string | number | null, id);
        this.log(source, 'task', id, key, oldValue, value);
      }
    });
  }

  changesSince(seq = 0): ChangeEvent[] {
    return (this.db.prepare('SELECT * FROM change_event WHERE seq > ? ORDER BY seq').all(seq) as Array<Record<string, string | number | null>>).map((r) => ({
      seq: Number(r.seq),
      at: String(r.at),
      source: String(r.source),
      entity: String(r.entity),
      entityId: String(r.entity_id),
      field: r.field === null ? null : String(r.field),
      oldValue: r.old_value === null ? undefined : JSON.parse(String(r.old_value)),
      newValue: r.new_value === null ? undefined : JSON.parse(String(r.new_value)),
    }));
  }

  /** Record that a print was issued; "changed since last print" reads from here. */
  recordPrint(p: { kind: string; rev: string; issued: string; paper: string; sheets: number; dataDate: string }): number {
    const last = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM change_event').get() as { s: number };
    const r = this.db
      .prepare('INSERT INTO print_record (kind, rev, issued, printed_at, paper, sheets, data_date, last_change_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(p.kind, p.rev, p.issued, new Date().toISOString(), p.paper, p.sheets, p.dataDate, last.s);
    return Number(r.lastInsertRowid);
  }

  changesSinceLastPrint(kind: string): ChangeEvent[] {
    const row = this.db.prepare('SELECT last_change_seq FROM print_record WHERE kind = ? ORDER BY id DESC LIMIT 1').get(kind) as
      | { last_change_seq: number }
      | undefined;
    return this.changesSince(row?.last_change_seq ?? 0);
  }

  /** Raw access for tests and spikes. */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  private log(source: string, entity: string, entityId: string, field: string | null, oldValue: unknown, newValue: unknown): void {
    this.db
      .prepare('INSERT INTO change_event (at, source, entity, entity_id, field, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(new Date().toISOString(), source, entity, entityId, field, oldValue === undefined ? null : JSON.stringify(oldValue), newValue === undefined ? null : JSON.stringify(newValue));
  }

  private tx(fn: () => void): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}

function userVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

function isEmpty(db: DatabaseSync): boolean {
  return (db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema").get() as { n: number }).n === 0;
}

function migrate(db: DatabaseSync): void {
  let v = userVersion(db);
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[v]!);
      v += 1;
      db.exec(`PRAGMA user_version = ${v}; PRAGMA application_id = ${APPLICATION_ID};`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

function rowToTask(r: Record<string, string | number | null>): Task {
  const t: Task = {
    id: String(r.id),
    assetId: String(r.asset_id),
    code: String(r.code),
    name: String(r.name),
    type: r.type as Task['type'],
    durationDays: Number(r.duration_days),
    percentComplete: Number(r.percent_complete),
  };
  if (r.responsible !== null) t.responsible = String(r.responsible);
  if (r.start_no_earlier_than !== null) t.startNoEarlierThan = String(r.start_no_earlier_than);
  if (r.actual_start !== null) t.actualStart = String(r.actual_start);
  if (r.actual_finish !== null) t.actualFinish = String(r.actual_finish);
  if (r.readiness !== null) t.readiness = JSON.parse(String(r.readiness)) as Readiness;
  if (r.template_key !== null && r.template_key !== undefined) t.templateKey = String(r.template_key);
  return t;
}
