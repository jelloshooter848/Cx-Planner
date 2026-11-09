/**
 * Renderer state. The main process owns the project; it pushes the whole AppState through
 * window.cx.onState after every change and this store keeps the newest copy. UI-only state
 * (current view, open dialog, last error notice) lives here too, so every part of the
 * shell reads one snapshot through useSyncExternalStore.
 *
 * Everything the user can do from the menu row, the native menu, the keyboard or a button
 * goes through `dispatch(action)`, so they all behave the same.
 */
import { createContext, createElement, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { Command, Id, IsoDate, Project } from '@cx/core';
import type { ApiResult, AppState, CxApi, EditOutcome, TaskScheduleSummary } from '../shared/api';

/** Views shown when a project is open (the welcome screen shows when none is). */
export type ViewId = 'schedule' | 'templates' | 'lookahead';
export type DialogId = 'new-project' | 'about';

export interface Notice {
  /** Increases with every notice, so the same message shown twice is still a new notice. */
  id: number;
  message: string;
}

export interface UiState {
  view: ViewId;
  dialog: DialogId | null;
  notice: Notice | null;
}

export interface Snapshot {
  /** Null until the first state arrives from the main process. */
  app: AppState | null;
  ui: UiState;
}

/** Things the user can do. Menus, shortcuts and buttons all produce these. */
export type Action =
  | { type: 'new-project' }
  | { type: 'open-project' }
  | { type: 'open-recent'; path: string }
  | { type: 'save-as' }
  | { type: 'close-project' }
  | { type: 'choose-workspace' }
  | { type: 'exit' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'view'; view: ViewId }
  | { type: 'about' };

export interface StoreOptions {
  /** Closes the window (File > Exit). */
  exit?(): void;
}

export interface Store {
  readonly api: CxApi;
  subscribe(listener: () => void): () => void;
  getSnapshot(): Snapshot;
  dispatch(action: Action): Promise<void>;
  /**
   * Runs an API call and shows its failure as a notice, except failures the user already
   * saw (a cancelled dialog, a lock or file error the main process showed in a dialog).
   */
  run<T>(call: () => Promise<ApiResult<T>>): Promise<ApiResult<T>>;
  setView(view: ViewId): void;
  openDialog(dialog: DialogId): void;
  closeDialog(): void;
  notify(message: string): void;
  dismissNotice(): void;
  /** Stops listening to the main process. */
  dispose(): void;
}

/** Failures that need no notice: the user cancelled, or a dialog already explained it. */
const QUIET_CODES = new Set(['canceled', 'locked', 'file-error', 'nothing-to-undo', 'nothing-to-redo']);

export function createStore(api: CxApi, options: StoreOptions = {}): Store {
  let snapshot: Snapshot = { app: null, ui: { view: 'schedule', dialog: null, notice: null } };
  let noticeId = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of [...listeners]) l();
  };
  const setUi = (patch: Partial<UiState>) => {
    snapshot = { ...snapshot, ui: { ...snapshot.ui, ...patch } };
    emit();
  };
  const receive = (state: AppState) => {
    const prev = snapshot.app;
    // A getState() answer can arrive after a newer push; keep the newer one.
    if (prev && prev.seq > state.seq) return;
    const ui = { ...snapshot.ui };
    // A file change leaves no dialog over the new file. Closing a project always lands on the
    // welcome screen (view 'schedule' with no project, see effectiveView). Opening one from the
    // welcome screen starts on the schedule, or stays on Templates if that was showing. Going
    // straight from one open file to another (Save As, a second project) keeps the view.
    if (prev && prev.filePath !== state.filePath) {
      if (prev.project && !state.project) ui.view = 'schedule';
      else if (!prev.project && state.project) ui.view = ui.view === 'templates' ? 'templates' : 'schedule';
      if (state.filePath) ui.dialog = null;
    }
    snapshot = { app: state, ui };
    emit();
  };

  const offState = api.onState(receive);
  const offMenu = api.onMenu((cmd) => {
    if (cmd === 'new-project') void store.dispatch({ type: 'new-project' });
  });
  void api.getState().then(receive, () => {});

  const store: Store = {
    api,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    async run(call) {
      let r: Awaited<ReturnType<typeof call>>;
      try {
        r = await call();
      } catch (e) {
        r = { ok: false, code: 'error', message: e instanceof Error ? e.message : String(e) };
      }
      if (!r.ok && !QUIET_CODES.has(r.code)) store.notify(r.message);
      return r;
    },
    async dispatch(action) {
      switch (action.type) {
        case 'new-project':
          return store.openDialog('new-project');
        case 'about':
          return store.openDialog('about');
        case 'open-project':
          await store.run(() => api.openProject());
          return;
        case 'open-recent':
          await store.run(() => api.openRecent(action.path));
          return;
        case 'save-as':
          if (snapshot.app?.project) await store.run(() => api.saveAs());
          return;
        case 'close-project':
          if (snapshot.app?.project) await store.run(() => api.closeProject());
          return;
        case 'choose-workspace':
          await store.run(() => api.chooseWorkspace());
          return;
        case 'exit':
          options.exit?.();
          return;
        case 'undo':
          if (snapshot.app?.canUndo) await store.run(() => api.undo());
          return;
        case 'redo':
          if (snapshot.app?.canRedo) await store.run(() => api.redo());
          return;
        case 'view':
          return store.setView(action.view);
      }
    },
    setView: (view) => setUi({ view }),
    openDialog: (dialog) => setUi({ dialog }),
    closeDialog: () => setUi({ dialog: null }),
    notify: (message) => setUi({ notice: { id: ++noticeId, message } }),
    dismissNotice: () => setUi({ notice: null }),
    dispose() {
      offState();
      offMenu();
      listeners.clear();
    },
  };
  return store;
}

// ---- React bindings -------------------------------------------------------------------

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ store, children }: { store: Store; children: ReactNode }) {
  return createElement(StoreContext.Provider, { value: store }, children);
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside <StoreProvider>');
  return store;
}

/** The whole snapshot; re-renders on every change. Prefer the narrower hooks below. */
export function useSnapshot(): Snapshot {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** One slice of the snapshot. `select` must return a value already in the snapshot (no new objects). */
export function useSelect<T>(select: (s: Snapshot) => T): T {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => select(store.getSnapshot()));
}

export const useAppState = (): AppState | null => useSelect((s) => s.app);
export const useUi = (): UiState => useSelect((s) => s.ui);

export interface ProjectInfo {
  project: Project;
  filePath: string;
  fileName: string;
  /** +1 per saved edit. */
  revision: number;
  /** ISO timestamp of the last saved edit, or null when nothing has been edited this session. */
  lastSavedAt: string | null;
}

/** The open project, or null on the welcome screen. */
export function useProject(): ProjectInfo | null {
  const app = useAppState();
  return useMemo(() => {
    if (!app?.project || !app.filePath || !app.fileName) return null;
    return { project: app.project, filePath: app.filePath, fileName: app.fileName, revision: app.revision, lastSavedAt: app.lastSavedAt };
  }, [app]);
}

export interface ScheduleInfo {
  /** Computed dates per task id (empty when the schedule cannot be computed). */
  tasks: Record<Id, TaskScheduleSummary>;
  projectFinish: IsoDate | null;
  error: string | null;
}

const EMPTY_SCHEDULE: ScheduleInfo = { tasks: {}, projectFinish: null, error: null };

/** The computed schedule of the open project. */
export function useSchedule(): ScheduleInfo {
  const app = useAppState();
  return useMemo(() => (app ? { tasks: app.schedule, projectFinish: app.projectFinish, error: app.scheduleError } : EMPTY_SCHEDULE), [app]);
}

export interface CommandApi {
  /** Applies and saves one edit; a refusal is shown as a notice and returned. */
  apply(cmd: Command): Promise<ApiResult<EditOutcome>>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
  /** Summary of the edit Undo would reverse, e.g. "Renamed 1.3". */
  undoLabel: string | null;
  redoLabel: string | null;
}

/** Edits and undo/redo for views. */
export function useCommand(): CommandApi {
  const store = useStore();
  const app = useAppState();
  const canUndo = app?.canUndo ?? false;
  const canRedo = app?.canRedo ?? false;
  const undoLabel = app?.undoLabel ?? null;
  const redoLabel = app?.redoLabel ?? null;
  return useMemo(
    () => ({
      apply: (cmd: Command) => store.run(() => store.api.apply(cmd)),
      undo: () => store.dispatch({ type: 'undo' }),
      redo: () => store.dispatch({ type: 'redo' }),
      canUndo,
      canRedo,
      undoLabel,
      redoLabel,
    }),
    [store, canUndo, canRedo, undoLabel, redoLabel],
  );
}

/**
 * The view to draw: the welcome screen when no project is open (templates work without one).
 * With no project, setView('schedule') is how the user gets back to the welcome screen.
 */
export function effectiveView(s: Snapshot): ViewId | 'welcome' {
  if (s.app?.project) return s.ui.view;
  return s.ui.view === 'templates' && s.app?.workspacePath ? 'templates' : 'welcome';
}
