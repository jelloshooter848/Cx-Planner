/**
 * The contract between the renderer and the main process. Types (and the option lists the
 * Print dialog offers) only: the preload script
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

/** The prints the Print dialog makes. Each counts its own revisions (A, B, C …). */
export type PrintKind = 'lookahead' | 'full-schedule' | 'test-sheets';
export const PRINT_KINDS: readonly PrintKind[] = ['lookahead', 'full-schedule', 'test-sheets'];
export const LOOK_AHEAD_WEEKS = [2, 3, 4, 6] as const;
export type LookAheadWeeks = (typeof LOOK_AHEAD_WEEKS)[number];
export const LOOK_AHEAD_PAPERS = ['letter', 'tabloid'] as const satisfies readonly PaperId[];
export const FULL_SCHEDULE_PAPERS = ['tabloid', 'ansi-d', 'arch-d'] as const satisfies readonly PaperId[];

/** Fields every print request has. */
interface PrintRequestBase {
  /** What this revision is for, printed in the revision history (e.g. "Progress update"). */
  note: string;
}

/** A look-ahead of `weeks` weeks from the week holding `start` (normally its Monday). */
export interface LookAheadPrintRequest extends PrintRequestBase {
  kind: 'lookahead';
  paper: (typeof LOOK_AHEAD_PAPERS)[number];
  weeks: LookAheadWeeks;
  start: IsoDate;
  /** Only these assets; null prints every asset. */
  assetIds: Id[] | null;
  /** Print the T I M E S readiness columns. */
  showTimes: boolean;
}

/** The whole schedule on large-format paper. */
export interface FullSchedulePrintRequest extends PrintRequestBase {
  kind: 'full-schedule';
  paper: (typeof FULL_SCHEDULE_PAPERS)[number];
  /** Width of one working day in inches; null fits the schedule to the sheet width. */
  dayWidthIn: number | null;
  assetIds: Id[] | null;
}

/** Blank test sheets (Letter portrait), one per task, in schedule order. */
export interface TestSheetsPrintRequest extends PrintRequestBase {
  kind: 'test-sheets';
  /** Tasks from PrintSetup.checklistTasks. */
  taskIds: Id[];
}

export type PrintRequest = LookAheadPrintRequest | FullSchedulePrintRequest | TestSheetsPrintRequest;

/** One issued print, from the project's print records. */
export interface PrintRecordSummary {
  id: number;
  kind: PrintKind;
  rev: string;
  issued: IsoDate;
  /** ISO timestamp. */
  printedAt: string;
  paper: string;
  sheets: number;
  note: string;
  title: string;
}

/** A task that prints a test sheet (its template task has checklist items). */
export interface ChecklistTaskSummary {
  taskId: Id;
  assetId: Id;
  /** Task code, e.g. "1.3". */
  code: string;
  name: string;
  /** Test form name from the template, when it has one. */
  testForm: string | null;
  items: number;
}

/** What the Print dialog needs to set itself up. */
export interface PrintSetup {
  /** Printed as the Issued date. */
  dataDate: IsoDate;
  /** Every issued print, oldest first. */
  history: PrintRecordSummary[];
  /** The revision the next print of each kind gets. */
  nextRevision: Record<PrintKind, string>;
  checklistTasks: ChecklistTaskSummary[];
}

/** A print laid out but not issued: the same HTML the PDF is made from. */
export interface PrintPreview {
  html: string;
  sheets: number;
  /** Sheet size in inches as laid out (test sheets are portrait). */
  widthIn: number;
  heightIn: number;
  title: string;
  rev: string;
  issued: IsoDate;
}

/** A print that was issued and recorded. */
export interface PrintIssued {
  rev: string;
  sheets: number;
  title: string;
}

/** An exported PDF. */
export interface PdfExported extends PrintIssued {
  filePath: string;
  /**
   * Set when the PDF was written but could not be recorded in the project's print records
   * (e.g. the project was closed meanwhile), so its revision letter will be issued again.
   */
  notRecorded?: string;
}

/**
 * Commands main sends the renderer: menu items that need a form ('new-project', 'print',
 * 'project-settings'), Edit > Delete Task ('delete-task', which acts on the renderer's selected
 * task after a confirm), and 'confirm-close' when the window is closing while the renderer
 * reported unsaved work (it asks Save / Discard / Cancel, then closes the window itself or
 * stays open).
 */
export type MenuCommand = 'new-project' | 'print' | 'project-settings' | 'delete-task' | 'confirm-close';

export interface TemplateApi {
  list(): Promise<ApiResult<TemplateSummary[]>>;
  get(id: Id): Promise<ApiResult<Template>>;
  /**
   * The open project's own copy of a template (the snapshot its assets were made from,
   * decision D4), or the workspace copy when the project holds none. Fails with
   * 'no-project' when no project is open and 'unknown-template' when neither has it.
   */
  inProject(id: Id): Promise<ApiResult<Template>>;
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
    /** Issued prints, next revisions and the tasks that have test sheets. */
    setup(): Promise<ApiResult<PrintSetup>>;
    /** Lays out a print without issuing it, with the revision it would get. */
    preview(req: PrintRequest): Promise<ApiResult<PrintPreview>>;
    /** Shows a save dialog, writes the PDF and records the print (its revision is used up). */
    exportPdf(req: PrintRequest): Promise<ApiResult<PdfExported>>;
    /** Shows the system print dialog at the print's paper size and records the print. */
    toPrinter(req: PrintRequest): Promise<ApiResult<PrintIssued>>;
    /** Shows a PDF written by exportPdf in the file manager (other paths are refused). */
    showInFolder(filePath: string): Promise<ApiResult>;
  };
}

declare global {
  interface Window {
    /** Set by the preload script. */
    cx: CxApi;
  }
}
