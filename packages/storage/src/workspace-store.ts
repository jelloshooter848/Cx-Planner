import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TemplateInvalidError, validateTemplate } from '@cx/core';
import type { Template } from '@cx/core';
import { STARTER_TEMPLATES } from '@cx/templates';
import { backupBeforeOpen } from './backup.js';
import { FileLock } from './lock.js';
import type { ChangeEvent, OpenOptions } from './project-store.js';
import { ProjectFileCorruptError } from './project-store.js';
import { templateFromFile, templateToFile } from './template-file.js';
import { WORKSPACE_APPLICATION_ID, WORKSPACE_FILE_NAME, WORKSPACE_MIGRATIONS } from './workspace-schema.js';

export class NotAWorkspaceFileError extends Error {
  constructor(path: string) {
    super(`${path} is not a Cx Planner workspace file`);
    this.name = 'NotAWorkspaceFileError';
  }
}

export class TemplateNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`No template ${id} in the workspace library`);
    this.name = 'TemplateNotFoundError';
  }
}

/** One row of the template library list. */
export interface TemplateSummary {
  id: string;
  name: string;
  kind: Template['kind'];
  version: number;
  taskCount: number;
  updatedAt: string;
}

export interface ImportedTemplate {
  template: Template;
  /** True when the file's id was already used in this workspace and a new id was given. */
  idChanged: boolean;
}

/** The parts of a template that make up its content; a change to any of them bumps the version. */
type TemplateBody = Pick<Template, 'assetDescription' | 'stages' | 'tasks' | 'requiredDocs'>;

interface TemplateRow {
  id: string;
  name: string;
  kind: Template['kind'];
  version: number;
  body: string;
  sort: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * The shared workspace database, `<folder>/workspace.cxw`: the template library now, and
 * later the roster, certifications and instruments. Opening it takes the same
 * single-writer lock and backup as a project file (decisions D1, D2); every change is
 * written to the append-only change_event log (D3).
 */
export class WorkspaceStore {
  private constructor(
    public readonly folder: string,
    public readonly path: string,
    private readonly db: DatabaseSync,
    private readonly lock: FileLock,
    public readonly backupPath: string | undefined,
  ) {}

  /** Opens the workspace in `folder`. With `create`, makes the folder and file when missing and seeds the starter templates. */
  static open(folder: string, opts: OpenOptions = {}): WorkspaceStore {
    const path = join(folder, WORKSPACE_FILE_NAME);
    const exists = existsSync(path);
    if (!exists && !opts.create) throw new Error(`No workspace file at ${path}`);
    if (!exists) mkdirSync(folder, { recursive: true });
    const lock = FileLock.acquire(`${path}.lock`, { force: opts.forceUnlock });
    let db: DatabaseSync | undefined;
    try {
      const backupPath = exists && opts.backup !== false ? backupBeforeOpen(path, opts.backupKeep) : undefined;
      db = new DatabaseSync(path);
      // Rollback journal (not WAL): WAL needs shared memory, which network shares do not provide.
      db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
      const appId = (db.prepare('PRAGMA application_id').get() as { application_id: number }).application_id;
      const version = userVersion(db);
      const blank = appId === 0 && version === 0 && isEmpty(db);
      if (exists && !(appId === WORKSPACE_APPLICATION_ID || blank)) throw new NotAWorkspaceFileError(path);
      if (exists) {
        const check = (db.prepare('PRAGMA quick_check').all() as Array<{ quick_check: string }>).map((r) => r.quick_check);
        if (check.join() !== 'ok') throw new ProjectFileCorruptError(path, check.slice(0, 3).join('; '));
      }
      if (version > WORKSPACE_MIGRATIONS.length) {
        throw new Error(`${path} was saved by a newer version of Cx Planner (schema ${version})`);
      }
      migrate(db);
      const store = new WorkspaceStore(folder, path, db, lock, backupPath);
      if (blank) store.seedStarters();
      return store;
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

  /** The library in display order (starters first, in shipped order, then the rest as added). */
  listTemplates(): TemplateSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, kind, version, json_array_length(body, '$.tasks') AS task_count, updated_at
         FROM template WHERE deleted_at IS NULL ORDER BY sort, name`,
      )
      .all() as Array<{ id: string; name: string; kind: Template['kind']; version: number; task_count: number; updated_at: string }>;
    return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, version: Number(r.version), taskCount: Number(r.task_count), updatedAt: r.updated_at }));
  }

  /** A full copy of one template, or undefined when there is none (or it was deleted). */
  getTemplate(id: string): Template | undefined {
    const row = this.row(id);
    return row && row.deleted_at === null ? rowToTemplate(row) : undefined;
  }

  /**
   * Saves a template and returns it as stored. A template whose id is not in the library is
   * added as a custom template at version 1. For an existing one the version goes up by one
   * when anything but the version changed, and stays put otherwise; the kind is kept, so an
   * edited starter is still listed as a starter. Throws TemplateInvalidError when the
   * template breaks the rules in validateTemplate, and Error when it has no id or name.
   */
  saveTemplate(t: Template, source = 'user'): Template {
    if (t.id.trim() === '') throw new Error('Template has no id');
    if (t.name.trim() === '') throw new Error('Template needs a name');
    const problems = validateTemplate({ ...t, version: 1 });
    if (problems.length > 0) throw new TemplateInvalidError(problems);
    let saved!: Template;
    this.tx(() => {
      const row = this.row(t.id);
      if (!row) {
        saved = this.insert({ ...t, kind: 'custom', version: 1 }, source);
        return;
      }
      const before = rowToTemplate(row);
      const changed = contentKey(before) !== contentKey(t);
      if (!changed && row.deleted_at === null) {
        saved = before;
        return;
      }
      saved = this.update(row, { ...t, kind: row.kind, version: changed ? row.version + 1 : row.version }, source);
    });
    return saved;
  }

  /** Copies a template under a new id and name as a custom template at version 1. */
  duplicateTemplate(id: string, newName: string, source = 'user'): Template {
    const original = this.getTemplate(id);
    if (!original) throw new TemplateNotFoundError(id);
    if (newName.trim() === '') throw new Error('Template needs a name');
    let copy!: Template;
    this.tx(() => {
      copy = this.insert({ ...structuredClone(original), id: newTemplateId(), name: newName.trim(), kind: 'custom', version: 1 }, source);
    });
    return copy;
  }

  /**
   * Removes a template from the library. Starters can be deleted too; restoreStarters()
   * brings them back. Projects keep their own snapshot, so nothing else changes.
   */
  deleteTemplate(id: string, source = 'user'): void {
    this.tx(() => {
      const row = this.row(id);
      if (!row || row.deleted_at !== null) throw new TemplateNotFoundError(id);
      const now = new Date().toISOString();
      this.db.prepare('UPDATE template SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
      this.log(source, 'template', id, 'deleted', false, true);
    });
  }

  /**
   * Adds back any shipped starter that is missing from the library, with its shipped
   * content. A restored starter whose last saved content differs gets the next version
   * number, so a version never names two different contents. Starters still in the
   * library are left as they are. Returns the ids restored, in library order.
   */
  restoreStarters(source = 'user'): string[] {
    const restored: string[] = [];
    this.tx(() => {
      for (const s of STARTER_TEMPLATES) {
        const starter = structuredClone(s) as Template;
        const row = this.row(starter.id);
        if (!row) {
          this.insert(starter, source);
        } else if (row.deleted_at !== null) {
          const changed = contentKey(rowToTemplate(row)) !== contentKey(starter);
          this.update(row, { ...starter, kind: 'starter', version: changed ? row.version + 1 : row.version }, source);
        } else {
          continue;
        }
        restored.push(starter.id);
      }
    });
    return restored;
  }

  /** The template as a JSON file: {format: 'cx-template', version: 1, template}. */
  exportTemplate(id: string): string {
    const t = this.getTemplate(id);
    if (!t) throw new TemplateNotFoundError(id);
    return templateToFile(t);
  }

  /**
   * Adds a template from an exported file as a custom template. Throws TemplateImportError
   * with every problem found when the file cannot be used. Keeps the file's id and version
   * when the id is free in this workspace (so assets made from it elsewhere still match);
   * otherwise gives it a new id at version 1.
   */
  importTemplate(json: string, source = 'import'): ImportedTemplate {
    const t = templateFromFile(json);
    let result!: ImportedTemplate;
    this.tx(() => {
      const idChanged = this.row(t.id) !== undefined;
      const template = this.insert(
        idChanged ? { ...t, id: newTemplateId(), kind: 'custom', version: 1 } : { ...t, kind: 'custom' },
        source,
      );
      result = { template, idChanged };
    });
    return result;
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

  /** Raw access for tests and spikes. */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  private seedStarters(): void {
    this.tx(() => {
      for (const s of STARTER_TEMPLATES) this.insert(structuredClone(s) as Template, 'seed');
    });
  }

  private row(id: string): TemplateRow | undefined {
    return this.db.prepare('SELECT * FROM template WHERE id = ?').get(id) as TemplateRow | undefined;
  }

  private insert(t: Template, source: string): Template {
    const now = new Date().toISOString();
    const { s } = this.db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM template').get() as { s: number };
    this.db
      .prepare('INSERT INTO template (id, name, kind, version, body, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(t.id, t.name, t.kind, t.version, JSON.stringify(bodyOf(t)), s, now, now);
    const stored = rowToTemplate(this.row(t.id)!);
    this.log(source, 'template', t.id, null, undefined, stored);
    return stored;
  }

  private update(row: TemplateRow, t: Template, source: string): Template {
    const before = rowToTemplate(row);
    this.db
      .prepare('UPDATE template SET name = ?, kind = ?, version = ?, body = ?, updated_at = ?, deleted_at = NULL WHERE id = ?')
      .run(t.name, t.kind, t.version, JSON.stringify(bodyOf(t)), new Date().toISOString(), row.id);
    if (row.deleted_at !== null) this.log(source, 'template', row.id, 'deleted', true, false);
    const after = rowToTemplate(this.row(row.id)!);
    if (contentKey(before) !== contentKey(after) || before.version !== after.version) {
      this.log(source, 'template', row.id, 'content', before, after);
    }
    return after;
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

/** A fresh library id for a custom template. */
export function newTemplateId(): string {
  return `tpl-${randomUUID()}`;
}

function bodyOf(t: Template): TemplateBody {
  return { assetDescription: t.assetDescription, stages: t.stages, tasks: t.tasks, requiredDocs: t.requiredDocs };
}

function rowToTemplate(r: TemplateRow): Template {
  const body = JSON.parse(r.body) as TemplateBody;
  return { id: r.id, name: r.name, version: Number(r.version), kind: r.kind, ...body };
}

/** Compares content regardless of key order; version, id and kind are not content. */
function contentKey(t: Template): string {
  return stableStringify({ name: t.name, ...bodyOf(t) });
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x ?? null)).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stableStringify(x)}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

function userVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

function isEmpty(db: DatabaseSync): boolean {
  return (db.prepare('SELECT COUNT(*) AS n FROM sqlite_schema').get() as { n: number }).n === 0;
}

function migrate(db: DatabaseSync): void {
  let v = userVersion(db);
  while (v < WORKSPACE_MIGRATIONS.length) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(WORKSPACE_MIGRATIONS[v]!);
      v += 1;
      db.exec(`PRAGMA user_version = ${v}; PRAGMA application_id = ${WORKSPACE_APPLICATION_ID};`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
