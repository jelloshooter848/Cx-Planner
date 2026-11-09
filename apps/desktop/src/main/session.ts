/**
 * The open project and workspace of one desktop window. No Electron here, so it can be
 * unit-tested: the main process passes `broadcast` (send to the renderer) and wires the
 * file dialogs in ./files.ts.
 *
 * Every edit goes applyCommand -> ProjectStore.saveProject (one transaction, logged in
 * change_event) -> undo stack -> broadcast. Saving is immediate, so there is no dirty
 * state; AppState.lastSavedAt says when the last edit landed.
 */
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { applyCommand, CommandError, computeSchedule, renumberTasks, TemplateInvalidError, type Command, type Id, type Project, type Template } from '@cx/core';
import { TemplateImportError, TemplateNotFoundError, type NewPrintRecord, type PrintRecord, type ProjectStore, type TemplateSummary, type WorkspaceStore } from '@cx/storage';
import type { ApiErrorCode, ApiResult, AppState, EditOutcome, TaskScheduleSummary } from '../shared/api.js';

/** How many edits Undo can go back. */
export const UNDO_LIMIT = 200;

export interface SessionOptions {
  /** Sends the new state to the renderer. Called after every change. */
  broadcast(state: AppState): void;
  /** Recent project paths, most recent first. */
  recent?(): string[];
  undoLimit?: number;
}

interface UndoEntry {
  /** Applying this reverses (or, on the redo stack, repeats) the step. */
  command: Command;
  /** Summary of the original edit, shown as "Undo <label>" / "Redo <label>". */
  label: string;
}

interface OpenProject {
  store: ProjectStore;
  project: Project;
  view: ScheduleView;
  undo: UndoEntry[];
  redo: UndoEntry[];
  revision: number;
  lastSavedAt: string | null;
}

export interface ScheduleView {
  schedule: Record<Id, TaskScheduleSummary>;
  projectFinish: string | null;
  scheduleError: string | null;
}

/** The per-task schedule the renderer shows. Never throws: a project that cannot be scheduled gets scheduleError. */
export function scheduleView(project: Project): ScheduleView {
  try {
    const r = computeSchedule(project);
    const schedule: Record<Id, TaskScheduleSummary> = {};
    for (const [id, t] of r.tasks) {
      schedule[id] = { start: t.start, finish: t.finish, es: t.es, ef: t.ef, totalFloat: t.totalFloat, critical: t.critical };
    }
    return { schedule, projectFinish: project.tasks.length > 0 ? r.projectFinish : null, scheduleError: null };
  } catch (e) {
    return { schedule: {}, projectFinish: null, scheduleError: (e as Error).message };
  }
}

/** "Cx Planner — Riverside.cxp", or "Cx Planner" with no project open. */
export function windowTitle(state: Pick<AppState, 'fileName'>): string {
  return state.fileName ? `Cx Planner — ${state.fileName}` : 'Cx Planner';
}

export type Failure = Extract<ApiResult<never>, { ok: false }>;

/** Turns any error into an ApiResult failure with a stable code. */
export function failure(e: unknown, fallback: ApiErrorCode = 'error'): Failure {
  if (e instanceof CommandError) return { ok: false, code: e.code, message: e.message };
  if (e instanceof TemplateNotFoundError) return { ok: false, code: 'unknown-template', message: e.message };
  if (e instanceof TemplateInvalidError) return { ok: false, code: 'invalid-template', message: e.message };
  if (e instanceof TemplateImportError) return { ok: false, code: 'invalid-template-file', message: e.problems.join('\n') };
  if (e instanceof InputError) return { ok: false, code: e.code, message: e.message };
  return { ok: false, code: fallback, message: e instanceof Error ? e.message : String(e) };
}

/** Bad input from the renderer. */
export class InputError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-input' | 'invalid-template' = 'invalid-input',
  ) {
    super(message);
    this.name = 'InputError';
  }
}

/** Templates a command copies into the project: the ones it adds assets from or re-applies. */
export function templatesUsed(cmd: Command): Template[] {
  switch (cmd.kind) {
    case 'addAssetsFromTemplate':
    case 'reapplyTemplate':
      return [cmd.template];
    case 'batch':
      return cmd.commands.flatMap(templatesUsed);
    default:
      return [];
  }
}

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export class Session {
  private doc: OpenProject | null = null;
  private ws: WorkspaceStore | null = null;
  private seq = 0;
  private readonly undoLimit: number;
  /**
   * What the renderer holds unsaved (e.g. 'Template "LV switchgear"'), or null. Project edits
   * are saved at once; only the template editor keeps a draft. Main asks before dropping it.
   */
  unsavedWork: string | null = null;

  constructor(private readonly opts: SessionOptions) {
    this.undoLimit = opts.undoLimit ?? UNDO_LIMIT;
  }

  get project(): Project | null {
    return this.doc?.project ?? null;
  }

  get filePath(): string | null {
    return this.doc?.store.path ?? null;
  }

  get workspace(): WorkspaceStore | null {
    return this.ws;
  }

  // -------------------------------------------------------------------------------------
  // Project file

  /**
   * Takes ownership of an opened store and shows its project, closing the project that was
   * open before. Task codes are renumbered first (so undo of add/remove/move is exact); if
   * that changed anything it is saved as its own logged step.
   */
  openStore(store: ProjectStore): void {
    let project: Project;
    try {
      const loaded = store.loadProject();
      project = renumberTasks(loaded);
      if (project !== loaded) store.saveProject(project, 'open', 'Renumbered task codes');
    } catch (e) {
      store.close();
      throw e;
    }
    this.closeDoc();
    const rev = store.getRevisionState();
    this.doc = { store, project, view: scheduleView(project), undo: [], redo: [], revision: rev.revision, lastSavedAt: rev.savedAt ?? null };
    this.notify();
  }

  /** Writes a copy of the open file to `target` (which must not exist), for Save As. */
  copyFileTo(target: string): void {
    if (!this.doc) throw new Error('No project is open');
    this.doc.store.copyTo(target);
  }

  /**
   * Save As: continue in `store`, a copy of the open file. Keeps the undo history.
   * `project` is the copy's project when it differs from the open one (a new id).
   */
  replaceStore(store: ProjectStore, project?: Project): void {
    if (!this.doc) throw new Error('No project is open');
    const old = this.doc.store;
    const rev = store.getRevisionState();
    this.doc = { ...this.doc, store, project: project ?? this.doc.project, revision: rev.revision, lastSavedAt: rev.savedAt ?? this.doc.lastSavedAt };
    old.close();
    this.notify();
  }

  closeProject(): void {
    if (!this.doc) return;
    this.closeDoc();
    this.notify();
  }

  // -------------------------------------------------------------------------------------
  // Prints

  /** Template snapshots stored in the open project (empty with none open). */
  templateSnapshots(): Template[] {
    return this.doc?.store.getTemplateSnapshots() ?? [];
  }

  /** Prints issued from the open project, oldest first (empty with none open). */
  printHistory(): PrintRecord[] {
    return this.doc?.store.listPrints() ?? [];
  }

  /** Records an issued print in the open project. */
  recordPrint(p: NewPrintRecord): void {
    if (!this.doc) throw new Error('No project is open');
    this.doc.store.recordPrint(p);
  }

  // -------------------------------------------------------------------------------------
  // Edits

  /** Applies a renderer edit. Callers must have refused undo-only commands (see validate.ts). */
  apply(cmd: Command): ApiResult<EditOutcome> {
    const doc = this.doc;
    if (!doc) return { ok: false, code: 'no-project', message: 'No project is open' };
    let result;
    try {
      result = applyCommand(doc.project, cmd);
    } catch (e) {
      if (e instanceof CommandError && e.code === 'no-change') return ok({ changed: false, summary: null });
      return failure(e);
    }
    // Decision D4: the project keeps a snapshot of every template version it applies, so
    // checklists and the like can be read back by (id, version) without the workspace.
    // Older versions are kept, so undo and partial re-apply need no snapshot bookkeeping.
    const saved = this.save(doc, result.project, result.summary, templatesUsed(cmd));
    if (!saved.ok) return saved;
    doc.undo.push({ command: result.inverse, label: result.summary });
    if (doc.undo.length > this.undoLimit) doc.undo.shift();
    doc.redo = [];
    this.notify();
    return ok({ changed: true, summary: result.summary });
  }

  undo(): ApiResult<EditOutcome> {
    return this.step('undo');
  }

  redo(): ApiResult<EditOutcome> {
    return this.step('redo');
  }

  private step(dir: 'undo' | 'redo'): ApiResult<EditOutcome> {
    const doc = this.doc;
    if (!doc) return { ok: false, code: 'no-project', message: 'No project is open' };
    const from = dir === 'undo' ? doc.undo : doc.redo;
    const to = dir === 'undo' ? doc.redo : doc.undo;
    const entry = from[from.length - 1];
    if (!entry) return { ok: false, code: dir === 'undo' ? 'nothing-to-undo' : 'nothing-to-redo', message: `Nothing to ${dir}` };
    let result;
    try {
      result = applyCommand(doc.project, entry.command);
    } catch (e) {
      // The stacks no longer fit the project (should not happen): drop them rather than loop on the error.
      doc.undo = [];
      doc.redo = [];
      this.notify();
      return failure(e);
    }
    const summary = `${dir === 'undo' ? 'Undo' : 'Redo'}: ${entry.label}`;
    const saved = this.save(doc, result.project, summary);
    if (!saved.ok) return saved;
    from.pop();
    to.push({ command: result.inverse, label: entry.label });
    this.notify();
    return ok({ changed: true, summary });
  }

  private save(doc: OpenProject, next: Project, summary: string, templates: readonly Template[] = []): ApiResult<void> {
    try {
      const r = doc.store.saveProject(next, 'user', summary, { templates });
      doc.revision = r.revision;
      doc.lastSavedAt = doc.store.getRevisionState().savedAt ?? new Date().toISOString();
    } catch (e) {
      return failure(e, 'file-error');
    }
    doc.project = next;
    doc.view = scheduleView(next);
    return ok(undefined);
  }

  // -------------------------------------------------------------------------------------
  // Workspace and templates

  /** Uses `ws` as the workspace (closing the previous one). */
  setWorkspace(ws: WorkspaceStore | null): void {
    if (this.ws && this.ws !== ws) this.ws.close();
    this.ws = ws;
    this.notify();
  }

  listTemplates(): ApiResult<TemplateSummary[]> {
    return this.withWorkspace((ws) => ws.listTemplates());
  }

  getTemplate(id: Id): ApiResult<Template> {
    return this.withWorkspace((ws) => {
      const t = ws.getTemplate(id);
      if (!t) throw new TemplateNotFoundError(id);
      return t;
    });
  }

  saveTemplate(t: Template): ApiResult<Template> {
    return this.withWorkspace((ws) => ws.saveTemplate(t, 'user'));
  }

  duplicateTemplate(id: Id, newName: string): ApiResult<Template> {
    return this.withWorkspace((ws) => ws.duplicateTemplate(id, newName, 'user'));
  }

  deleteTemplate(id: Id): ApiResult {
    return this.withWorkspace((ws) => ws.deleteTemplate(id, 'user'));
  }

  restoreStarters(): ApiResult<string[]> {
    return this.withWorkspace((ws) => ws.restoreStarters('user'));
  }

  private withWorkspace<T>(fn: (ws: WorkspaceStore) => T): ApiResult<T> {
    if (!this.ws) return { ok: false, code: 'no-workspace', message: 'No workspace is open' };
    try {
      return ok(fn(this.ws));
    } catch (e) {
      return failure(e);
    }
  }

  // -------------------------------------------------------------------------------------
  // State

  getState(): AppState {
    const d = this.doc;
    const recent = (this.opts.recent?.() ?? []).map((path) => ({ path, name: basename(path), exists: existsSync(path) }));
    return {
      seq: ++this.seq,
      project: d?.project ?? null,
      schedule: d?.view.schedule ?? {},
      projectFinish: d?.view.projectFinish ?? null,
      scheduleError: d?.view.scheduleError ?? null,
      filePath: d?.store.path ?? null,
      fileName: d ? basename(d.store.path) : null,
      revision: d?.revision ?? 0,
      lastSavedAt: d?.lastSavedAt ?? null,
      canUndo: (d?.undo.length ?? 0) > 0,
      canRedo: (d?.redo.length ?? 0) > 0,
      undoLabel: d?.undo[d.undo.length - 1]?.label ?? null,
      redoLabel: d?.redo[d.redo.length - 1]?.label ?? null,
      workspacePath: this.ws?.folder ?? null,
      recent,
    };
  }

  /** Sends the current state to the renderer. */
  notify(): void {
    this.opts.broadcast(this.getState());
  }

  /** Closes the project and workspace, releasing their locks. */
  dispose(): void {
    this.closeDoc();
    this.ws?.close();
    this.ws = null;
  }

  private closeDoc(): void {
    this.doc?.store.close();
    this.doc = null;
  }
}
