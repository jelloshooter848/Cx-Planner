import { existsSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { TIMES_KEYS, type Asset, type Dependency, type Project, type Readiness, type Task, type Template } from '@cx/core';
import { backupBeforeOpen } from './backup.js';
import { FileLock } from './lock.js';
import { APPLICATION_ID, MIGRATIONS, PROJECT_META_KEYS, REVISION_META_KEYS } from './schema.js';

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

/**
 * The project already holds a snapshot of this template id and version with different
 * content (e.g. a starter edited separately in two workspaces up to the same version).
 * The stored snapshot is kept, since assets on that version read their checklist from it.
 */
export class TemplateSnapshotConflictError extends Error {
  constructor(
    readonly templateId: string,
    readonly version: number,
    name: string,
  ) {
    super(
      `This project already holds a different version ${version} of the template "${name}" (likely from another workspace). ` +
        'Change and save the template so it gets a new version, then try again.',
    );
    this.name = 'TemplateSnapshotConflictError';
  }
}

/** JSON with object keys sorted, so equal content compares equal whatever the key order. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
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
  /** Revision of the save that wrote this event (absent for events from schema 1 and 2). */
  revision?: number;
  /** Summary given to that save, e.g. "Move SWGR-1A tests a week later". */
  summary?: string;
}

/** Where the file stands: bumped by every write that changes the project. */
export interface RevisionState {
  /** 0 for a new file; +1 per write that changed anything. */
  revision: number;
  /** When that write happened (ISO timestamp). */
  savedAt?: string;
  /** Highest change_event seq, 0 if none. */
  lastChangeSeq: number;
}

/** What one saveProject call wrote. */
export interface SaveResult {
  /** Number of change events written; 0 means the stored project already matched. */
  changes: number;
  /** Revision after the save (unchanged when nothing was written). */
  revision: number;
}

type TaskPatch = Partial<Omit<Task, 'id'>>;
type Sql = string | number | null;
type Row = Record<string, Sql>;

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
  notes: 'notes',
};

const ASSET_FIELDS: Record<keyof Omit<Asset, 'id'>, string> = {
  tag: 'tag',
  description: 'description',
  location: 'location',
  system: 'system',
  templateId: 'template_id',
  templateVersion: 'template_version',
};

const DEPENDENCY_FIELDS: Record<'type' | 'lagDays', string> = { type: 'type', lagDays: 'lag_days' };

/** Project fields stored in meta, by meta key. */
const PROJECT_FIELDS: Record<(typeof PROJECT_META_KEYS)[number], { field: string; get: (p: Project) => string }> = {
  id: { field: 'id', get: (p) => p.id },
  name: { field: 'name', get: (p) => p.name },
  // An empty subtitle and no subtitle are the same: stored as '', loaded as absent.
  subtitle: { field: 'subtitle', get: (p) => p.subtitle ?? '' },
  start_date: { field: 'startDate', get: (p) => p.startDate },
  data_date: { field: 'dataDate', get: (p) => p.dataDate },
  work_weekdays: { field: 'workWeekdays', get: (p) => JSON.stringify(p.calendar.workWeekdays) },
};

/** Model value -> column value. Objects (readiness) are stored as JSON. */
function enc(v: unknown): Sql {
  if (v === undefined || v === null) return null;
  if (typeof v === 'object') return JSON.stringify(v);
  return v as string | number;
}

/**
 * Readiness as JSON with a fixed key order (T, I, M, E, S, then any others sorted), so
 * the same readiness always encodes to the same string whatever order its keys came in.
 */
function encReadiness(r: Readiness | undefined): Sql {
  if (r === undefined || r === null) return null;
  const rec = r as Record<string, unknown>;
  const known: readonly string[] = TIMES_KEYS;
  const keys = [...known.filter((k) => k in rec), ...Object.keys(rec).filter((k) => !known.includes(k)).sort()];
  return JSON.stringify(Object.fromEntries(keys.map((k) => [k, rec[k]])));
}

/** Model value -> value of column `col`. */
function encColumn(col: string, v: unknown): Sql {
  return col === 'readiness' ? encReadiness(v as Readiness | undefined) : enc(v);
}

/**
 * Keys that moved, given the stored rows' ranks (their position in the stored order) and
 * the next order. The longest run of kept rows whose stored order is unchanged counts as
 * staying put (rows that only shifted because something was added, removed or moved
 * before them); every other kept row was moved.
 */
function movedKeys(nextKeys: string[], oldRank: Map<string, number>): Set<string> {
  const kept = nextKeys.filter((k) => oldRank.has(k));
  const ranks = kept.map((k) => oldRank.get(k)!);
  // Longest increasing subsequence in O(n log n), keeping links to rebuild it.
  const tails: number[] = [];
  const prev = new Array<number>(ranks.length).fill(-1);
  for (let i = 0; i < ranks.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ranks[tails[mid]!]! < ranks[i]!) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const stay = new Set<string>();
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = prev[i]!) stay.add(kept[i]!);
  return new Set(kept.filter((k) => !stay.has(k)));
}

/** Stored rows in their stored order (ties, from older files, by insertion order). */
function rankOf(rows: Row[], key: (r: Row) => string): Map<string, number> {
  return new Map(rows.map((r, i) => [key(r), i]));
}

function dependencyKey(d: { predecessorId: string; successorId: string }): string {
  return `${d.predecessorId}->${d.successorId}`;
}

/**
 * One open project file. The file is a SQLite database; the store holds the
 * single-writer lock for as long as it is open.
 */
export class ProjectStore {
  private readonly stmts = new Map<string, StatementSync>();
  /** Events written by the open transaction, and the revision/summary they carry. */
  private txEvents = 0;
  private txRevision = 0;
  private txSummary: string | null = null;
  /** Events written by the last committed transaction. */
  private lastTxEvents = 0;

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

  /**
   * Writes a consistent copy of the whole file (project, change log, print records) to
   * `target` with SQLite's VACUUM INTO, for "Save As". The copy is not opened or locked.
   * Refuses a target that already exists; the caller deletes it first after checking that
   * no other session holds it.
   */
  copyTo(target: string): void {
    if (existsSync(target)) throw new Error(`${target} already exists`);
    this.db.prepare('VACUUM INTO ?').run(target);
  }

  /** Replace the whole project (new file, or import). Logged as one event. */
  replaceProject(p: Project, source = 'import', summary?: string): void {
    this.tx(summary, () => {
      const db = this.db;
      db.exec('DELETE FROM dependency; DELETE FROM task; DELETE FROM asset; DELETE FROM calendar_holiday;');
      for (const key of PROJECT_META_KEYS) this.writeMeta(key, PROJECT_FIELDS[key].get(p));
      [...new Set(p.calendar.holidays)].forEach((h, i) => this.stmt('INSERT INTO calendar_holiday (date, sort) VALUES (?, ?)').run(h, i));
      p.assets.forEach((a, i) => this.insertAsset(a, i));
      p.tasks.forEach((t, i) => this.insertTask(t, i));
      p.dependencies.forEach((d, i) => this.insertDependency(d, i));
      this.log(source, 'project', p.id, null, null, { assets: p.assets.length, tasks: p.tasks.length });
    });
  }

  /**
   * Save `next` by writing only the rows that differ from the stored project, in one
   * transaction. Logs one change event per changed field, per added or removed row
   * (field null, with the whole row as new or old value) and per row the caller moved
   * (field "sort", old and new position). Rows that only shifted because another row was
   * added, removed or moved get their position rewritten without an event.
   * Dependencies are logged as entity "dependency" with id "pred->succ"; holidays as
   * entity "holiday" with the date as id; project fields as entity "project".
   * A save that finds nothing to change writes nothing.
   *
   * `options.templates` are template snapshots to store in the same transaction (see
   * saveTemplateSnapshot), e.g. the template an add-assets edit used, so the edit and its
   * snapshot land under one revision.
   */
  saveProject(next: Project, source: string, summary?: string, options: { templates?: readonly Template[] } = {}): SaveResult {
    this.tx(summary, () => {
      // Snapshots of templates this save applies (decision D4), in the same transaction.
      for (const t of options.templates ?? []) this.writeTemplateSnapshot(t, source);

      const db = this.db;
      const log = (entity: string, id: string, field: string | null, oldValue: unknown, newValue: unknown) =>
        this.log(source, entity, id, field, oldValue, newValue);

      // Project fields (meta).
      const meta = this.readMeta();
      for (const key of PROJECT_META_KEYS) {
        const { field, get } = PROJECT_FIELDS[key];
        const value = get(next);
        const old = meta.get(key);
        if (old === value) continue;
        this.writeMeta(key, value);
        const decode = (v: string | undefined) => (v === undefined ? undefined : key === 'work_weekdays' ? (JSON.parse(v) as unknown) : v);
        log('project', next.id, field, decode(old), decode(value));
      }

      // Holidays.
      const holidayRows = db.prepare('SELECT date, sort FROM calendar_holiday ORDER BY sort, rowid').all() as Row[];
      const oldHolidays = byKey(holidayRows, (r) => String(r.date));
      const nextHolidays = [...new Set(next.calendar.holidays)];
      const newHolidays = new Set(nextHolidays);
      const movedHolidays = movedKeys(nextHolidays, rankOf(holidayRows, (r) => String(r.date)));
      for (const h of oldHolidays.keys()) {
        if (newHolidays.has(h)) continue;
        this.stmt('DELETE FROM calendar_holiday WHERE date = ?').run(h);
        log('holiday', h, null, h, undefined);
      }
      nextHolidays.forEach((h, i) => {
        const row = oldHolidays.get(h);
        if (!row) {
          this.stmt('INSERT INTO calendar_holiday (date, sort) VALUES (?, ?)').run(h, i);
          log('holiday', h, null, undefined, h);
          return;
        }
        if (row.sort === i) return;
        this.stmt('UPDATE calendar_holiday SET sort = ? WHERE date = ?').run(i, h);
        if (movedHolidays.has(h)) log('holiday', h, 'sort', row.sort, i);
      });

      const assetRows = db.prepare('SELECT * FROM asset ORDER BY sort, rowid').all() as Row[];
      const taskRows = db.prepare('SELECT * FROM task ORDER BY sort, rowid').all() as Row[];
      const depRows = db.prepare('SELECT * FROM dependency ORDER BY sort, rowid').all() as Row[];
      const depRowKey = (r: Row) => dependencyKey({ predecessorId: String(r.predecessor_id), successorId: String(r.successor_id) });
      const oldAssets = byKey(assetRows, (r) => String(r.id));
      const oldTasks = byKey(taskRows, (r) => String(r.id));
      const oldDeps = byKey(depRows, depRowKey);
      const nextAssetIds = new Set(next.assets.map((a) => a.id));
      const nextTaskIds = new Set(next.tasks.map((t) => t.id));
      const nextDepKeys = new Set(next.dependencies.map(dependencyKey));
      const movedAssets = movedKeys(next.assets.map((a) => a.id), rankOf(assetRows, (r) => String(r.id)));
      const movedTasks = movedKeys(next.tasks.map((t) => t.id), rankOf(taskRows, (r) => String(r.id)));
      const movedDeps = movedKeys(next.dependencies.map(dependencyKey), rankOf(depRows, depRowKey));

      // Order matters for foreign keys: remove links and tasks before their assets,
      // add assets before the tasks that point at them, and links last.
      for (const [key, row] of oldDeps) {
        if (nextDepKeys.has(key)) continue;
        this.stmt('DELETE FROM dependency WHERE predecessor_id = ? AND successor_id = ?').run(row.predecessor_id ?? null, row.successor_id ?? null);
        log('dependency', key, null, rowToDependency(row), undefined);
      }
      for (const [id, row] of oldTasks) {
        if (nextTaskIds.has(id)) continue;
        this.stmt('DELETE FROM task WHERE id = ?').run(id);
        log('task', id, null, rowToTask(row), undefined);
      }
      next.assets.forEach((a, i) => {
        const row = oldAssets.get(a.id);
        if (!row) {
          this.insertAsset(a, i);
          log('asset', a.id, null, undefined, a);
          return;
        }
        this.updateRow('asset', 'id = ?', [a.id], row, ASSET_FIELDS, a, i, movedAssets.has(a.id), (field, o, n) => log('asset', a.id, field, o, n));
      });
      next.tasks.forEach((t, i) => {
        const row = oldTasks.get(t.id);
        if (!row) {
          this.insertTask(t, i);
          log('task', t.id, null, undefined, t);
          return;
        }
        this.updateRow('task', 'id = ?', [t.id], row, TASK_FIELDS, t, i, movedTasks.has(t.id), (field, o, n) => log('task', t.id, field, o, n));
      });
      for (const [id, row] of oldAssets) {
        if (nextAssetIds.has(id)) continue;
        this.stmt('DELETE FROM asset WHERE id = ?').run(id);
        log('asset', id, null, rowToAsset(row), undefined);
      }
      next.dependencies.forEach((d, i) => {
        const key = dependencyKey(d);
        const row = oldDeps.get(key);
        if (!row) {
          this.insertDependency(d, i);
          log('dependency', key, null, undefined, d);
          return;
        }
        this.updateRow('dependency', 'predecessor_id = ? AND successor_id = ?', [d.predecessorId, d.successorId], row, DEPENDENCY_FIELDS, d, i, movedDeps.has(key), (field, o, n) =>
          log('dependency', key, field, o, n),
        );
      });
    });
    return { changes: this.lastTxEvents, revision: this.getRevisionState().revision };
  }

  loadProject(): Project {
    const db = this.db;
    const meta = this.readMeta();
    const assets = (db.prepare('SELECT * FROM asset ORDER BY sort, rowid').all() as Row[]).map(rowToAsset);
    const tasks = (db.prepare('SELECT * FROM task ORDER BY sort, rowid').all() as Row[]).map(rowToTask);
    const dependencies = (db.prepare('SELECT * FROM dependency ORDER BY sort, rowid').all() as Row[]).map(rowToDependency);
    const holidays = (db.prepare('SELECT date FROM calendar_holiday ORDER BY sort, rowid').all() as Array<{ date: string }>).map((r) => r.date);
    const subtitle = meta.get('subtitle');
    const weekdays = meta.get('work_weekdays');
    return {
      id: meta.get('id') ?? '',
      name: meta.get('name') ?? '',
      ...(subtitle ? { subtitle } : {}),
      startDate: meta.get('start_date') ?? '',
      dataDate: meta.get('data_date') ?? '',
      calendar: { workWeekdays: weekdays ? (JSON.parse(weekdays) as number[]) : [1, 2, 3, 4, 5], holidays },
      assets,
      tasks,
      dependencies,
    };
  }

  /** Update task fields, logging one change event per field that actually changed. */
  updateTask(id: string, patch: TaskPatch, source = 'user', summary?: string): void {
    this.tx(summary, () => {
      const row = this.db.prepare('SELECT * FROM task WHERE id = ?').get(id) as Row | undefined;
      if (!row) throw new Error(`No task ${id}`);
      const before = rowToTask(row);
      for (const [key, value] of Object.entries(patch) as Array<[keyof TaskPatch, unknown]>) {
        const col = TASK_FIELDS[key];
        if (!col) throw new Error(`Unknown task field ${key}`);
        const oldValue = before[key];
        const encoded = encColumn(col, value);
        if ((row[col] ?? null) === encoded) continue;
        this.db.prepare(`UPDATE task SET ${col} = ? WHERE id = ?`).run(encoded, id);
        this.log(source, 'task', id, key, oldValue, value);
      }
    });
  }

  /**
   * Store the snapshot of a template used by this project (decision D4). Every version is
   * kept, keyed by (id, version). Saving the same id and version again with the same
   * content does nothing. A snapshot is never replaced: assets on that version read their
   * checklist from it, and the workspace gives every content change a new version, so
   * different content under a stored (id, version) means a clash between workspaces; that
   * throws TemplateSnapshotConflictError and rolls the transaction back.
   * Logged as entity "template", field "version".
   */
  saveTemplateSnapshot(template: Template, source = 'user', summary?: string): void {
    this.tx(summary, () => this.writeTemplateSnapshot(template, source));
  }

  private writeTemplateSnapshot(template: Template, source: string): void {
    const json = JSON.stringify(template);
    const row = this.stmt('SELECT json FROM project_template WHERE id = ? AND version = ?').get(template.id, template.version) as { json: string } | undefined;
    if (row) {
      if (canonicalJson(JSON.parse(row.json)) === canonicalJson(template)) return;
      throw new TemplateSnapshotConflictError(template.id, template.version, template.name);
    }
    this.stmt('INSERT INTO project_template (id, version, json) VALUES (?, ?, ?)').run(template.id, template.version, json);
    this.log(source, 'template', template.id, 'version', undefined, template.version);
  }

  /** Every template snapshot stored in this project, by id then version. */
  getTemplateSnapshots(): Template[] {
    return (this.db.prepare('SELECT json FROM project_template ORDER BY id, version').all() as Array<{ json: string }>).map((r) => JSON.parse(r.json) as Template);
  }

  /** The snapshot of one template version, as assets with that templateVersion use it. */
  getTemplateSnapshot(id: string, version: number): Template | undefined {
    const row = this.stmt('SELECT json FROM project_template WHERE id = ? AND version = ?').get(id, version) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as Template) : undefined;
  }

  getRevisionState(): RevisionState {
    const meta = this.readMeta();
    const savedAt = meta.get(REVISION_META_KEYS.savedAt);
    const last = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM change_event').get() as { s: number };
    return { revision: Number(meta.get(REVISION_META_KEYS.revision) ?? 0), ...(savedAt ? { savedAt } : {}), lastChangeSeq: last.s };
  }

  changesSince(seq = 0): ChangeEvent[] {
    return (this.db.prepare('SELECT * FROM change_event WHERE seq > ? ORDER BY seq').all(seq) as Row[]).map((r) => ({
      seq: Number(r.seq),
      at: String(r.at),
      source: String(r.source),
      entity: String(r.entity),
      entityId: String(r.entity_id),
      field: r.field === null ? null : String(r.field),
      oldValue: r.old_value === null ? undefined : JSON.parse(String(r.old_value)),
      newValue: r.new_value === null ? undefined : JSON.parse(String(r.new_value)),
      ...(r.revision !== null && r.revision !== undefined ? { revision: Number(r.revision) } : {}),
      ...(r.summary !== null && r.summary !== undefined ? { summary: String(r.summary) } : {}),
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

  private stmt(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  private readMeta(): Map<string, string> {
    return new Map((this.stmt('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
  }

  private writeMeta(key: string, value: string): void {
    this.stmt('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  private insertAsset(a: Asset, sort: number): void {
    this.stmt('INSERT INTO asset (id, tag, description, location, system, template_id, template_version, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      a.id, a.tag, a.description, enc(a.location), enc(a.system), enc(a.templateId), enc(a.templateVersion), sort,
    );
  }

  private insertTask(t: Task, sort: number): void {
    this.stmt(
      `INSERT INTO task (id, asset_id, code, name, type, duration_days, percent_complete, responsible,
         start_no_earlier_than, actual_start, actual_finish, readiness, template_key, notes, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      t.id, t.assetId, t.code, t.name, t.type, t.durationDays, t.percentComplete, enc(t.responsible), enc(t.startNoEarlierThan),
      enc(t.actualStart), enc(t.actualFinish), encReadiness(t.readiness), enc(t.templateKey), enc(t.notes), sort,
    );
  }

  private insertDependency(d: Dependency, sort: number): void {
    this.stmt('INSERT INTO dependency (predecessor_id, successor_id, type, lag_days, sort) VALUES (?, ?, ?, ?, ?)').run(d.predecessorId, d.successorId, d.type, d.lagDays, sort);
  }

  /**
   * Compare a stored row with the next model value column by column and write only the
   * columns that differ (plus `sort` when its position changed), reporting each changed
   * field, and the position only when `moved` (the caller moved this row itself).
   */
  private updateRow<T extends object>(
    table: string,
    where: string,
    whereArgs: Sql[],
    row: Row,
    fields: Partial<Record<keyof T, string>>,
    next: T,
    sort: number,
    moved: boolean,
    report: (field: string, oldValue: unknown, newValue: unknown) => void,
  ): void {
    const sets: string[] = [];
    const args: Sql[] = [];
    for (const [field, col] of Object.entries(fields) as Array<[string, string]>) {
      const value = encColumn(col, (next as Record<string, unknown>)[field]);
      const old = row[col] ?? null;
      if (old === value) continue;
      sets.push(`${col} = ?`);
      args.push(value);
      report(field, decodeColumn(col, old), (next as Record<string, unknown>)[field]);
    }
    if (row.sort !== sort) {
      sets.push('sort = ?');
      args.push(sort);
      if (moved) report('sort', row.sort, sort);
    }
    if (sets.length) this.stmt(`UPDATE ${table} SET ${sets.join(', ')} WHERE ${where}`).run(...args, ...whereArgs);
  }

  private log(source: string, entity: string, entityId: string, field: string | null, oldValue: unknown, newValue: unknown): void {
    this.txEvents += 1;
    this.stmt('INSERT INTO change_event (at, source, entity, entity_id, field, old_value, new_value, revision, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      new Date().toISOString(),
      source,
      entity,
      entityId,
      field,
      oldValue === undefined ? null : JSON.stringify(oldValue),
      newValue === undefined ? null : JSON.stringify(newValue),
      this.txRevision,
      this.txSummary,
    );
  }

  /**
   * Run `fn` in one write transaction. When it logged any change, the file's revision is
   * bumped and every event it wrote carries that revision and `summary`.
   */
  private tx(summary: string | undefined, fn: () => void): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.txEvents = 0;
      this.txRevision = Number(this.readMeta().get(REVISION_META_KEYS.revision) ?? 0) + 1;
      this.txSummary = summary ?? null;
      fn();
      if (this.txEvents > 0) {
        this.writeMeta(REVISION_META_KEYS.revision, String(this.txRevision));
        this.writeMeta(REVISION_META_KEYS.savedAt, new Date().toISOString());
      }
      this.db.exec('COMMIT');
      this.lastTxEvents = this.txEvents;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}

function byKey(rows: Row[], key: (r: Row) => string): Map<string, Row> {
  return new Map(rows.map((r) => [key(r), r]));
}

/** Column value -> model value, for change event old values. */
function decodeColumn(col: string, v: Sql): unknown {
  if (v === null) return undefined;
  if (col === 'readiness') return JSON.parse(String(v)) as unknown;
  return v;
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

function rowToTask(r: Row): Task {
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
  if (r.notes !== null && r.notes !== undefined) t.notes = String(r.notes);
  return t;
}

function rowToAsset(r: Row): Asset {
  return {
    id: String(r.id),
    tag: String(r.tag),
    description: String(r.description ?? ''),
    ...(r.location !== null && r.location !== undefined ? { location: String(r.location) } : {}),
    ...(r.system !== null && r.system !== undefined ? { system: String(r.system) } : {}),
    ...(r.template_id !== null && r.template_id !== undefined ? { templateId: String(r.template_id) } : {}),
    ...(r.template_version !== null && r.template_version !== undefined ? { templateVersion: Number(r.template_version) } : {}),
  };
}

function rowToDependency(r: Row): Dependency {
  return { predecessorId: String(r.predecessor_id), successorId: String(r.successor_id), type: r.type as Dependency['type'], lagDays: Number(r.lag_days) };
}
