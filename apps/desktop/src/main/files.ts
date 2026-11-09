/**
 * File menu actions: new, open, open recent, save as, close, workspace folder, template
 * import and export. Talks to the user through an injected Dialogs object (Electron's
 * dialog module in the app, a scripted fake in tests), so none of this imports Electron.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { DEFAULT_CALENDAR, type Id, type Project, type Template } from '@cx/core';
import {
  BACKUP_DIR,
  FileLock,
  NotAProjectFileError,
  NotAWorkspaceFileError,
  ProjectFileCorruptError,
  ProjectLockedError,
  ProjectStore,
  WorkspaceStore,
  type LockInfo,
} from '@cx/storage';
import type { ApiResult, NewProjectInput } from '../shared/api.js';
import { RecentFiles, samePath, SettingsFile } from './prefs.js';
import { failure, ok, type Failure, type Session } from './session.js';

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface MessageOptions {
  type: 'info' | 'warning' | 'error' | 'question';
  message: string;
  detail?: string;
  buttons: string[];
  defaultId?: number;
  cancelId?: number;
}

/** What the file actions need from the UI. Each returns undefined / the cancel button when dismissed. */
export interface Dialogs {
  open(o: { title: string; defaultPath?: string; filters?: FileFilter[]; folder?: boolean }): Promise<string | undefined>;
  save(o: { title: string; defaultPath: string; filters: FileFilter[] }): Promise<string | undefined>;
  /** Shows a message box and returns the index of the button pressed. */
  message(o: MessageOptions): Promise<number>;
}

export const PROJECT_EXT = '.cxp';
export const PROJECT_FILTERS: FileFilter[] = [{ name: 'Cx Planner project', extensions: ['cxp'] }];
export const TEMPLATE_FILTERS: FileFilter[] = [{ name: 'Cx Planner template', extensions: ['json'] }];
/** Template files bigger than this are refused before reading. */
const MAX_TEMPLATE_FILE_BYTES = 5 * 1024 * 1024;

export interface FileControllerOptions {
  session: Session;
  dialogs: Dialogs;
  recent: RecentFiles;
  settings: SettingsFile;
  /** Proposed on first run, e.g. ~/Documents/Cx Planner Workspace. */
  defaultWorkspace: string;
}

const canceled: Failure = { ok: false, code: 'canceled', message: 'Cancelled' };

/** A name that is safe as a file name on Windows, macOS and Linux. */
export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what must go
  const s = name.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return s === '' ? 'Untitled' : s.slice(0, 120);
}

/** The first .cxp file named on a command line (not a --switch), resolved against `cwd`. */
export function projectArg(argv: string[], cwd = process.cwd()): string | undefined {
  const a = argv.find((x) => !x.startsWith('-') && x.toLowerCase().endsWith(PROJECT_EXT));
  return a ? resolve(cwd, a) : undefined;
}

function withExt(path: string, ext: string): string {
  return extname(path).toLowerCase() === ext ? path : `${path}${ext}`;
}

/** An empty project. */
export function emptyProject(input: NewProjectInput): Project {
  return {
    id: randomUUID(),
    name: input.name.trim(),
    startDate: input.startDate,
    dataDate: input.startDate,
    calendar: structuredClone(DEFAULT_CALENDAR),
    assets: [],
    tasks: [],
    dependencies: [],
  };
}

function holderText(h: LockInfo | undefined): string {
  if (!h) return 'another session (its lock file cannot be read)';
  const when = new Date(h.openedAt);
  const since = Number.isNaN(when.getTime()) ? h.openedAt : when.toLocaleString();
  return `${h.user} on ${h.host} since ${since}`;
}

export class FileController {
  private readonly session: Session;
  private readonly dialogs: Dialogs;
  private readonly recent: RecentFiles;
  private readonly settings: SettingsFile;
  private readonly defaultWorkspace: string;

  constructor(o: FileControllerOptions) {
    this.session = o.session;
    this.dialogs = o.dialogs;
    this.recent = o.recent;
    this.settings = o.settings;
    this.defaultWorkspace = o.defaultWorkspace;
  }

  /** Where new projects and exported templates go by default. */
  private get baseFolder(): string {
    return this.session.workspace?.folder ?? this.settings.get().workspacePath ?? this.defaultWorkspace;
  }

  // -------------------------------------------------------------------------------------
  // Projects

  async newProject(input: NewProjectInput): Promise<ApiResult<{ filePath: string }>> {
    const chosen = await this.dialogs.save({
      title: 'New project',
      defaultPath: join(this.baseFolder, `${safeFileName(input.name)}${PROJECT_EXT}`),
      filters: PROJECT_FILTERS,
    });
    if (!chosen) return canceled;
    const target = withExt(chosen, PROJECT_EXT);
    if (!(await this.confirmReplace(chosen, target))) return canceled;
    // Replacing the open file: it must be closed first (we hold its lock). If anything
    // below fails while the old file is still there, reopen it so the user is not left on
    // the start screen.
    const previous = this.session.filePath && samePath(this.session.filePath, target) ? this.session.filePath : null;
    if (previous) this.session.closeProject();
    const restore = async <T extends Failure>(failed: T): Promise<T> => {
      if (previous && existsSync(previous)) await this.openPath(previous);
      return failed;
    };
    const cleared = await this.clearTarget(target);
    if (!cleared.ok) return restore(cleared);
    let store: ProjectStore;
    try {
      store = ProjectStore.open(target, { create: true });
    } catch (e) {
      return restore(await this.openFailed(target, e));
    }
    try {
      store.replaceProject(emptyProject(input), 'user', 'Created project');
    } catch (e) {
      store.close();
      return restore(await this.openFailed(target, e));
    }
    return this.adopt(store);
  }

  async openWithDialog(): Promise<ApiResult<{ filePath: string }>> {
    const current = this.session.filePath;
    const path = await this.dialogs.open({ title: 'Open project', defaultPath: current ? dirname(current) : this.baseFolder, filters: PROJECT_FILTERS });
    if (!path) return canceled;
    return this.openPath(path);
  }

  /** Opens a project from the recent list; any other path is refused (the renderer is not trusted with paths). */
  async openRecent(path: string): Promise<ApiResult<{ filePath: string }>> {
    const known = this.recent.list().find((p) => samePath(p, path));
    if (!known) return { ok: false, code: 'invalid-input', message: 'That file is not in the recent list' };
    if (!existsSync(known)) {
      await this.dialogs.message({
        type: 'error',
        message: `${basename(known)} could not be found.`,
        detail: `It is no longer at ${known}. It may have been moved, renamed or deleted, or its network drive may be offline. It has been removed from the recent list.`,
        buttons: ['OK'],
      });
      this.recent.remove(known);
      this.session.notify();
      return { ok: false, code: 'file-error', message: `${known} not found` };
    }
    return this.openPath(known);
  }

  /** Opens a project file (from a dialog, the command line or the OS). */
  async openPath(path: string): Promise<ApiResult<{ filePath: string }>> {
    if (this.session.filePath && samePath(this.session.filePath, path)) return ok({ filePath: this.session.filePath });
    const store = await this.openStore(path);
    if (!(store instanceof ProjectStore)) return store;
    return this.adopt(store);
  }

  async saveAs(): Promise<ApiResult<{ filePath: string }>> {
    const current = this.session.filePath;
    if (!current) return { ok: false, code: 'no-project', message: 'No project is open' };
    const stem = basename(current, extname(current));
    const chosen = await this.dialogs.save({ title: 'Save project as', defaultPath: join(dirname(current), `${stem} copy${PROJECT_EXT}`), filters: PROJECT_FILTERS });
    if (!chosen) return canceled;
    const target = withExt(chosen, PROJECT_EXT);
    if (samePath(target, current)) return ok({ filePath: current });
    if (!(await this.confirmReplace(chosen, target))) return canceled;
    const cleared = await this.clearTarget(target);
    if (!cleared.ok) return cleared;
    const project = this.session.project;
    if (!project) return { ok: false, code: 'no-project', message: 'No project is open' };
    let copied = false;
    let store: ProjectStore | undefined;
    // The copy is a separate project from here on (see DECISIONS D13), so it gets its own id,
    // saved as a logged step in the copy only.
    const copy: Project = { ...project, id: randomUUID() };
    try {
      this.session.copyFileTo(target);
      copied = true;
      store = ProjectStore.open(target, { backup: false });
      store.saveProject(copy, 'user', 'Saved as a new copy');
    } catch (e) {
      store?.close();
      if (copied) {
        try {
          for (const p of [target, `${target}-journal`]) if (existsSync(p)) unlinkSync(p);
        } catch {
          // Best effort: the error below is what the user needs to see.
        }
      }
      return this.openFailed(target, e);
    }
    this.recent.add(target);
    this.session.replaceStore(store, copy);
    return ok({ filePath: store.path });
  }

  close(): ApiResult {
    this.session.closeProject();
    return ok(undefined);
  }

  private async adopt(store: ProjectStore): Promise<ApiResult<{ filePath: string }>> {
    const path = store.path;
    try {
      this.session.openStore(store);
    } catch (e) {
      return this.openFailed(path, e);
    }
    this.recent.add(path);
    return ok({ filePath: path });
  }

  /**
   * The save dialog asks before replacing the name the user typed, but not the name we
   * make by adding the extension afterwards. Asks then; true means go ahead.
   */
  private async confirmReplace(chosen: string, target: string): Promise<boolean> {
    if (chosen === target || !existsSync(target)) return true;
    const answer = await this.dialogs.message({
      type: 'warning',
      message: `${basename(target)} already exists. Replace it?`,
      detail: `Replacing it deletes what is in it now:\n${target}`,
      buttons: ['Cancel', 'Replace'],
      defaultId: 0,
      cancelId: 0,
    });
    return answer === 1;
  }

  /**
   * Makes room for a new file at `target`, which the user agreed to replace (in the save
   * dialog or confirmReplace). Refuses when another session has it open. Also removes any
   * journal left by a crashed session, so SQLite cannot roll it back onto the new file.
   */
  private async clearTarget(target: string): Promise<ApiResult> {
    if (![target, `${target}-journal`, `${target}-wal`, `${target}-shm`].some((p) => existsSync(p))) return ok(undefined);
    let lock: FileLock;
    try {
      lock = FileLock.acquire(`${target}.lock`);
    } catch (e) {
      if (!(e instanceof ProjectLockedError)) return this.openFailed(target, e);
      await this.dialogs.message({
        type: 'error',
        message: `${basename(target)} can't be replaced because it is open.`,
        detail: `It is open by ${holderText(e.holder)}. Choose another name, or ask them to close it.`,
        buttons: ['OK'],
      });
      return { ok: false, code: 'locked', message: e.message };
    }
    try {
      for (const p of [target, `${target}-journal`, `${target}-wal`, `${target}-shm`]) {
        if (existsSync(p)) unlinkSync(p);
      }
    } catch (e) {
      return this.openFailed(target, e);
    } finally {
      lock.release();
    }
    return ok(undefined);
  }

  /** Opens a project store, handling a held lock and unreadable files with dialogs. */
  private async openStore(path: string): Promise<ProjectStore | Failure> {
    try {
      return ProjectStore.open(path);
    } catch (e) {
      if (!(e instanceof ProjectLockedError)) return this.openFailed(path, e);
      const force = await this.confirmBreakLock(basename(path), e.holder, 'project');
      if (!force) return { ok: false, code: 'locked', message: e.message };
      try {
        return ProjectStore.open(path, { forceUnlock: true });
      } catch (e2) {
        return this.openFailed(path, e2);
      }
    }
  }

  /**
   * Shows who holds the lock. Returns true only when the user chose "Open anyway" and then
   * confirmed breaking the lock.
   */
  private async confirmBreakLock(name: string, holder: LockInfo | undefined, what: 'project' | 'workspace'): Promise<boolean> {
    const first = await this.dialogs.message({
      type: 'warning',
      message: `${name} is open by ${holder ? `${holder.user} on ${holder.host}` : 'another session'}.`,
      detail:
        `It has been open by ${holderText(holder)}. Only one person can edit a ${what} at a time.\n\n` +
        'Choose Open Anyway only if you are sure nobody is working in it, for example after their computer crashed.',
      buttons: ['Cancel', 'Open Read-Only (coming soon)', 'Open Anyway…'],
      defaultId: 0,
      cancelId: 0,
    });
    if (first === 1) {
      // Kept in the dialog so the button order is stable for when read-only opening exists.
      await this.dialogs.message({
        type: 'info',
        message: 'Opening read-only is coming in a later version.',
        detail: `For now, ask ${holder?.user ?? 'the other person'} to close the ${what}, or choose Open Anyway if nobody is working in it.`,
        buttons: ['OK'],
      });
      return false;
    }
    if (first !== 2) return false;
    const second = await this.dialogs.message({
      type: 'warning',
      message: `Break the lock on ${name}?`,
      detail: `If ${holder?.user ?? 'the other person'} is still working in it, one of you will lose changes.`,
      buttons: ['Cancel', 'Break Lock and Open'],
      defaultId: 0,
      cancelId: 0,
    });
    return second === 1;
  }

  /** Explains why a file could not be opened or written, and returns the failure. */
  private async openFailed(path: string, e: unknown): Promise<Failure> {
    const name = basename(path);
    const backups = join(dirname(path), BACKUP_DIR);
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof NotAProjectFileError || /not a database/i.test(msg)) {
      await this.dialogs.message({
        type: 'error',
        message: `${name} is not a Cx Planner project file.`,
        detail: `Choose a .cxp file made by Cx Planner. If this file used to open, it may have been overwritten; earlier copies are kept in the backups folder next to it:\n${backups}`,
        buttons: ['OK'],
      });
      return { ok: false, code: 'file-error', message: msg };
    }
    if (e instanceof ProjectFileCorruptError || /malformed|corrupt/i.test(msg)) {
      await this.dialogs.message({
        type: 'error',
        message: `${name} is damaged and can't be opened.`,
        detail:
          `${msg}\n\nA copy is saved each time a project is opened, in the backups folder next to it:\n${backups}\n\n` +
          'Copy the newest backup out of that folder, rename it to end in .cxp, and open the copy.',
        buttons: ['OK'],
      });
      return { ok: false, code: 'file-error', message: msg };
    }
    await this.dialogs.message({ type: 'error', message: `${name} couldn't be opened.`, detail: msg, buttons: ['OK'] });
    return { ok: false, code: 'file-error', message: msg };
  }

  // -------------------------------------------------------------------------------------
  // Workspace

  /** Opens the remembered workspace, asking for a folder on first run. */
  async ensureWorkspace(): Promise<void> {
    let folder = this.settings.get().workspacePath;
    if (!folder) {
      const choice = await this.dialogs.message({
        type: 'question',
        message: 'Where should Cx Planner keep your workspace?',
        detail:
          `The workspace folder holds your template library, and later your roster and instruments. New projects are saved there by default.\n\n` +
          `Suggested: ${this.defaultWorkspace}`,
        buttons: ['Use Suggested Folder', 'Choose Folder…'],
        defaultId: 0,
        cancelId: 0,
      });
      if (choice === 1) {
        folder = await this.dialogs.open({ title: 'Choose workspace folder', defaultPath: dirname(this.defaultWorkspace), folder: true });
        // Cancelled: the user turned down the suggestion too, so remember nothing and ask again next run.
        if (!folder) return;
      } else {
        folder = this.defaultWorkspace;
      }
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await this.openWorkspace(folder);
      if (r.ok || r.code === 'canceled' || r.code === 'locked') return;
      const choice = await this.dialogs.message({
        type: 'warning',
        message: 'Choose another workspace folder?',
        detail: 'Without a workspace, the template library is not available. You can choose a folder later from the File menu.',
        buttons: ['Continue Without Workspace', 'Choose Folder…'],
        defaultId: 1,
        cancelId: 0,
      });
      if (choice !== 1) return;
      const next = await this.dialogs.open({ title: 'Choose workspace folder', defaultPath: folder, folder: true });
      if (!next) return;
      folder = next;
    }
  }

  async chooseWorkspace(): Promise<ApiResult<{ workspacePath: string }>> {
    const folder = await this.dialogs.open({ title: 'Choose workspace folder', defaultPath: this.baseFolder, folder: true });
    if (!folder) return canceled;
    return this.openWorkspace(folder);
  }

  /** Opens (creating when missing) the workspace in `folder`, remembers it and gives it to the session. */
  async openWorkspace(folder: string): Promise<ApiResult<{ workspacePath: string }>> {
    if (this.session.workspace && samePath(this.session.workspace.folder, folder)) return ok({ workspacePath: this.session.workspace.folder });
    let ws: WorkspaceStore;
    try {
      ws = WorkspaceStore.open(folder, { create: true });
    } catch (e) {
      if (e instanceof ProjectLockedError) {
        const force = await this.confirmBreakLock(`The workspace in ${basename(folder)}`, e.holder, 'workspace');
        if (!force) return { ok: false, code: 'locked', message: e.message };
        try {
          ws = WorkspaceStore.open(folder, { create: true, forceUnlock: true });
        } catch (e2) {
          return this.workspaceFailed(folder, e2);
        }
      } else {
        return this.workspaceFailed(folder, e);
      }
    }
    this.settings.update({ workspacePath: ws.folder });
    this.session.setWorkspace(ws);
    return ok({ workspacePath: ws.folder });
  }

  private async workspaceFailed(folder: string, e: unknown): Promise<Failure> {
    const msg = e instanceof Error ? e.message : String(e);
    const backups = join(folder, BACKUP_DIR);
    const detail =
      e instanceof NotAWorkspaceFileError
        ? `The workspace file in ${folder} was not made by Cx Planner.`
        : e instanceof ProjectFileCorruptError
          ? `${msg}\n\nA copy is saved each time the workspace is opened, in the backups folder:\n${backups}\n\nCopy the newest backup out of that folder and rename it to workspace.cxw.`
          : msg;
    await this.dialogs.message({ type: 'error', message: `The workspace in ${folder} couldn't be opened.`, detail, buttons: ['OK'] });
    return { ok: false, code: 'file-error', message: msg };
  }

  // -------------------------------------------------------------------------------------
  // Template files

  async exportTemplate(id: Id): Promise<ApiResult<{ filePath: string }>> {
    const ws = this.session.workspace;
    if (!ws) return { ok: false, code: 'no-workspace', message: 'No workspace is open' };
    let json: string;
    let template: Template | undefined;
    try {
      template = ws.getTemplate(id);
      json = ws.exportTemplate(id);
    } catch (e) {
      return failure(e);
    }
    return this.writeWithDialog({
      title: 'Export template',
      defaultPath: join(this.baseFolder, `${safeFileName(template?.name ?? id)}.json`),
      filters: TEMPLATE_FILTERS,
      ext: '.json',
      data: () => json,
    });
  }

  /**
   * Asks where to save a file, adds `ext` when the typed name lacks it (asking before
   * replacing that name), then writes `data()`. A write error is shown in a dialog and
   * returned as 'file-error'.
   */
  async writeWithDialog(o: {
    title: string;
    defaultPath: string;
    filters: FileFilter[];
    ext: string;
    data: () => string | Uint8Array | Promise<string | Uint8Array>;
  }): Promise<ApiResult<{ filePath: string }>> {
    const chosen = await this.dialogs.save({ title: o.title, defaultPath: o.defaultPath, filters: o.filters });
    if (!chosen) return canceled;
    const target = withExt(chosen, o.ext);
    if (!(await this.confirmReplace(chosen, target))) return canceled;
    const data = await o.data();
    try {
      writeFileSync(target, data);
    } catch (e) {
      await this.dialogs.message({ type: 'error', message: `${basename(target)} couldn't be written.`, detail: (e as Error).message, buttons: ['OK'] });
      return failure(e, 'file-error');
    }
    return ok({ filePath: target });
  }

  async importTemplate(): Promise<ApiResult<{ template: Template; idChanged: boolean }>> {
    const ws = this.session.workspace;
    if (!ws) return { ok: false, code: 'no-workspace', message: 'No workspace is open' };
    const path = await this.dialogs.open({ title: 'Import template', defaultPath: this.baseFolder, filters: TEMPLATE_FILTERS });
    if (!path) return canceled;
    let json: string;
    try {
      if (statSync(path).size > MAX_TEMPLATE_FILE_BYTES) throw new Error('The file is too large to be a template');
      json = readFileSync(path, 'utf8');
    } catch (e) {
      await this.dialogs.message({ type: 'error', message: `${basename(path)} couldn't be read.`, detail: (e as Error).message, buttons: ['OK'] });
      return failure(e, 'file-error');
    }
    try {
      return ok(ws.importTemplate(json, 'import'));
    } catch (e) {
      const f = failure(e);
      await this.dialogs.message({ type: 'error', message: `${basename(path)} can't be imported.`, detail: f.message, buttons: ['OK'] });
      return f;
    }
  }
}
