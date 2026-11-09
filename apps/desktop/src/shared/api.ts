/**
 * The contract between the renderer and the main process. Types only: the preload script
 * implements `CxApi` on `window.cx`, and the main process answers each call on the channel
 * named in ./channels.ts. Every call returns an ApiResult rather than throwing, so the
 * renderer always gets a plain-language message and a stable code.
 */
import type { Command, CommandErrorCode, Id, IsoDate, Project, Template } from '@cx/core';
import type { PaperId } from '@cx/render';
import type { TemplateSummary } from '@cx/storage';

export type { TemplateSummary };

/** Codes of failures that are not edit refusals (those use CommandErrorCode). */
export type ApiErrorCode =
  /** The user cancelled a dialog. Not an error to show. */
  | 'canceled'
  /** The call needs an open project and none is open. */
  | 'no-project'
  /** The call needs the workspace and none is open. */
  | 'no-workspace'
  /** The renderer sent something the main process refuses (wrong shape, undo-only command, unknown path). */
  | 'invalid-input'
  | 'nothing-to-undo'
  | 'nothing-to-redo'
  | 'unknown-template'
  | 'invalid-template'
  | 'invalid-template-file'
  /** The file is held by another session (the dialog has already been shown). */
  | 'locked'
  /** The file could not be opened or written (the dialog has already been shown). */
  | 'file-error'
  | 'error';

export type ApiResult<T = void> = { ok: true; value: T } | { ok: false; code: ApiErrorCode | CommandErrorCode; message: string };

/** One task's computed schedule, as shown in the Gantt and grid. */
export interface TaskScheduleSummary {
  start: IsoDate;
  /** Last working day (inclusive). */
  finish: IsoDate;
  /** Working-day indexes from the project start; the task occupies [es, ef). */
  es: number;
  ef: number;
  totalFloat: number;
  critical: boolean;
}

export interface RecentFile {
  path: string;
  /** File name without folder, e.g. "Riverside.cxp". */
  name: string;
  /** False when the file is no longer there (moved, deleted, share offline). */
  exists: boolean;
}

/** Everything the renderer draws from. Sent whole on every change (see CxApi.onState). */
export interface AppState {
  /** Increases with every state sent, so a late getState() answer can be told from a newer push. */
  seq: number;
  /** The open project, or null on the start screen. */
  project: Project | null;
  /** Computed schedule per task id. Empty when no project is open or the schedule cannot be computed. */
  schedule: Record<Id, TaskScheduleSummary>;
  projectFinish: IsoDate | null;
  /** Set when the schedule cannot be computed (e.g. a dependency loop in an old file). */
  scheduleError: string | null;
  filePath: string | null;
  /** File name of the open project, e.g. "Riverside.cxp". */
  fileName: string | null;
  /** File revision: +1 per saved edit. */
  revision: number;
  /** When the last edit was saved (ISO timestamp). Every edit is saved at once, so there is no dirty state. */
  lastSavedAt: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Summary of the edit Undo would reverse, e.g. "Renamed 1.3". */
  undoLabel: string | null;
  redoLabel: string | null;
  workspacePath: string | null;
  /** Most recent first, at most 10. */
  recent: RecentFile[];
}

export interface NewProjectInput {
  name: string;
  startDate: IsoDate;
}

export interface EditOutcome {
  /** False when the edit changed nothing (nothing saved, no undo step). */
  changed: boolean;
  summary: string | null;
}

export interface LookAheadPreview {
  html: string;
  sheets: number;
  widthIn: number;
  heightIn: number;
}

/**
 * Commands main sends the renderer: menu items that need a form, and 'confirm-close' when
 * the window is closing while the renderer reported unsaved work (it asks Save / Discard /
 * Cancel, then closes the window itself or stays open).
 */
export type MenuCommand = 'new-project' | 'confirm-close';

export interface TemplateApi {
  list(): Promise<ApiResult<TemplateSummary[]>>;
  get(id: Id): Promise<ApiResult<Template>>;
  /** Adds (new id) or updates a template; returns it as stored (version bumped when content changed). */
  save(template: Template): Promise<ApiResult<Template>>;
  duplicate(id: Id, newName: string): Promise<ApiResult<Template>>;
  delete(id: Id): Promise<ApiResult>;
  /** Shows a save dialog and writes the template file. */
  export(id: Id): Promise<ApiResult<{ filePath: string }>>;
  /** Shows an open dialog and adds the template from the chosen file. */
  import(): Promise<ApiResult<{ template: Template; idChanged: boolean }>>;
  /** Puts back any deleted starter templates; returns their ids. */
  restoreStarters(): Promise<ApiResult<string[]>>;
}

export interface CxApi {
  getState(): Promise<AppState>;
  /** Called with the full state after every change. Returns a function that unsubscribes. */
  onState(callback: (state: AppState) => void): () => void;
  /** Called when a menu item needs the renderer (e.g. File > New Project shows the new-project form). */
  onMenu(callback: (command: MenuCommand) => void): () => void;

  /** Applies one edit and saves it. Undo-only commands (restore*, restore flags) are refused. */
  apply(cmd: Command): Promise<ApiResult<EditOutcome>>;
  undo(): Promise<ApiResult<EditOutcome>>;
  redo(): Promise<ApiResult<EditOutcome>>;

  /** Shows a save dialog (in the workspace folder), creates the file and opens it. */
  newProject(input: NewProjectInput): Promise<ApiResult<{ filePath: string }>>;
  /** Shows an open dialog. */
  openProject(): Promise<ApiResult<{ filePath: string }>>;
  /** Opens a file from AppState.recent (other paths are refused). */
  openRecent(path: string): Promise<ApiResult<{ filePath: string }>>;
  /** Shows a save dialog, copies the open file there and continues working in the copy. */
  saveAs(): Promise<ApiResult<{ filePath: string }>>;
  closeProject(): Promise<ApiResult>;
  /** Shows a folder dialog and switches to (or creates) a workspace there. */
  chooseWorkspace(): Promise<ApiResult<{ workspacePath: string }>>;
  /**
   * Tells main what is unsaved (e.g. 'Template "LV switchgear"'), or null when nothing is.
   * While set, closing the window sends 'confirm-close' instead and a workspace switch asks first.
   */
  setUnsavedWork(what: string | null): Promise<ApiResult>;

  templates: TemplateApi;

  print: {
    lookAheadHtml(paper: PaperId): Promise<ApiResult<LookAheadPreview>>;
    /** Shows a save dialog and writes the look-ahead PDF. */
    lookAheadPdf(paper: PaperId): Promise<ApiResult<{ filePath: string }>>;
  };
}

declare global {
  interface Window {
    /** Set by the preload script. */
    cx: CxApi;
  }
}
