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
import type { Command, Id, IsoDate, Project, Task } from '@cx/core';
import type { ApiResult, AppState, CxApi, EditOutcome, LookAheadWeeks, PrintKind, TaskScheduleSummary } from '../shared/api';
import { assetsInView } from './asset-filter';

/** Views shown when a project is open (the welcome screen shows when none is). */
export type ViewId = 'schedule' | 'templates' | 'lookahead';
export type DialogId = 'new-project' | 'about' | 'add-assets' | 'delete-task' | 'print' | 'project-settings';
/** Time scale of the Schedule view's Gantt. */
export type ScheduleZoom = 'day' | 'week' | 'month';

export interface Notice {
  /** Increases with every notice, so the same message shown twice is still a new notice. */
  id: number;
  message: string;
}

export interface UiState {
  view: ViewId;
  dialog: DialogId | null;
  notice: Notice | null;
  /**
   * Bumped when main asks to close the window while unsaved work was reported (MenuCommand
   * 'confirm-close'). The Templates view, which holds that work, answers it. 0 = never asked.
   */
  closeRequest: number;
  /** Status bar text a view sets for itself (e.g. the template library counts); null = the project's. */
  status: StatusLine | null;
  /**
   * The task selected in the Schedule view (row click or arrow keys), or null. May name a
   * task that no longer exists after an edit; read it through useSelectedTask().
   */
  selectedTaskId: Id | null;
  /**
   * Every selected task in the order chosen: the selected task first, then tasks added with
   * Ctrl+click (Link tasks links the first two). Empty when nothing is selected.
   */
  selectedTaskIds: Id[];
  scheduleZoom: ScheduleZoom;
  /** The kind of print the Print dialog opens on (the last one chosen or asked for). */
  printKind: PrintKind;
  /**
   * Assets the schedule shows, or null for all (the asset filter). Prints can be limited to it.
   * May name assets that no longer exist; read it through useAssetFilter().
   */
  assetFilter: Id[] | null;
  /** Text typed in the sidebar's "Filter by tag or system" box. Part of the asset filter. */
  assetQuery: string;
  /** Assets unticked in the sidebar. Part of the asset filter; assets added later show. */
  hiddenAssetIds: Id[];
  /** Weeks of the look-ahead window shaded on the Gantt (and the Print dialog's default). */
  lookAheadWeeks: LookAheadWeeks;
}

export interface StatusLine {
  left: string;
  right: string;
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
  /** Takes a file off the recent list (e.g. one that can no longer be found). */
  | { type: 'remove-recent'; path: string }
  /** Writes a copy of the sample project to Documents and opens it. */
  | { type: 'open-sample' }
  | { type: 'save-as' }
  | { type: 'close-project' }
  | { type: 'choose-workspace' }
  | { type: 'exit' }
  | { type: 'undo' }
  | { type: 'redo' }
  /** Opens the add-assets-from-template dialog (needs an open project). */
  | { type: 'add-assets' }
  /** Asks to delete the selected task (a confirm dialog); nothing happens with no task selected. */
  | { type: 'delete-task' }
  /** Opens the Print dialog (needs an open project), on `kind` or the last kind used. */
  | { type: 'print'; kind?: PrintKind }
  /** Opens the Project settings dialog (needs an open project). */
  | { type: 'project-settings' }
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
  /** Replaces the status bar text while a view shows (null puts the project's back). */
  setStatus(status: StatusLine | null): void;
  /** Selects one task (or none), dropping any Ctrl+click selection. */
  selectTask(id: Id | null): void;
  /** Ctrl+click: adds the task to the selection, or takes it out if it is already in it. */
  toggleTaskSelection(id: Id): void;
  setScheduleZoom(zoom: ScheduleZoom): void;
  setPrintKind(kind: PrintKind): void;
  /**
   * Limits the schedule (and prints that follow it) to these assets; null shows all. Clears
   * the sidebar's filter text and ticks exactly these assets.
   */
  setAssetFilter(ids: Id[] | null): void;
  /** The sidebar's filter text; assets whose tag or system do not match it are hidden. */
  setAssetQuery(query: string): void;
  /** Ticks (shown = true) or unticks assets in the sidebar. */
  setAssetsShown(ids: readonly Id[], shown: boolean): void;
  setLookAheadWeeks(weeks: LookAheadWeeks): void;
  /** Stops listening to the main process. */
  dispose(): void;
}

/** Failures that need no notice: the user cancelled, or a dialog already explained it. */
const QUIET_CODES = new Set(['canceled', 'locked', 'file-error', 'nothing-to-undo', 'nothing-to-redo']);

export function createStore(api: CxApi, options: StoreOptions = {}): Store {
  let snapshot: Snapshot = {
    app: null,
    ui: {
      view: 'schedule',
      dialog: null,
      notice: null,
      closeRequest: 0,
      status: null,
      selectedTaskId: null,
      selectedTaskIds: [],
      scheduleZoom: 'week',
      printKind: 'lookahead',
      assetFilter: null,
      assetQuery: '',
      hiddenAssetIds: [],
      lookAheadWeeks: 3,
    },
  };
  let noticeId = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of [...listeners]) l();
  };
  const setUi = (patch: Partial<UiState>) => {
    snapshot = { ...snapshot, ui: { ...snapshot.ui, ...patch } };
    emit();
  };
  /**
   * Works out ui.assetFilter from the sidebar's text and ticks for `project`, and drops
   * selected tasks whose asset is no longer in view. Changes `ui` in place.
   */
  const refilter = (ui: UiState, project: Project | null | undefined) => {
    const next = project ? assetsInView(project.assets, ui.assetQuery, ui.hiddenAssetIds) : null;
    const same = next === ui.assetFilter || (next && ui.assetFilter && next.length === ui.assetFilter.length && next.every((id, i) => id === ui.assetFilter![i]));
    if (!same) ui.assetFilter = next;
    if (next && project && ui.selectedTaskIds.length) {
      const shown = new Set(next);
      const assetOf = new Map(project.tasks.map((t) => [t.id, t.assetId]));
      const kept = ui.selectedTaskIds.filter((id) => shown.has(assetOf.get(id) ?? ''));
      if (kept.length !== ui.selectedTaskIds.length) {
        ui.selectedTaskIds = kept;
        ui.selectedTaskId = kept[0] ?? null;
      }
    }
  };
  const setFilterUi = (patch: Pick<Partial<UiState>, 'assetQuery' | 'hiddenAssetIds'>) => {
    const ui = { ...snapshot.ui, ...patch };
    refilter(ui, snapshot.app?.project);
    snapshot = { ...snapshot, ui };
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
    // Task ids belong to one project: a different project (or none) clears the selection, and
    // so does an edit that removed the selected task. Save As keeps the project and its ids.
    if (ui.selectedTaskIds.length) {
      const sameProject = prev?.project?.id === state.project?.id;
      const ids = new Set(sameProject ? state.project?.tasks.map((t) => t.id) : []);
      const kept = ui.selectedTaskIds.filter((id) => ids.has(id));
      if (kept.length !== ui.selectedTaskIds.length) {
        ui.selectedTaskIds = kept;
        ui.selectedTaskId = kept[0] ?? null;
      }
    }
    // The asset filter, like the selection, belongs to one project. Within a project it is
    // worked out again, so assets added later show unless the filter text hides them.
    if (prev?.project?.id !== state.project?.id) {
      ui.assetQuery = '';
      ui.hiddenAssetIds = [];
    }
    refilter(ui, state.project);
    snapshot = { app: state, ui };
    emit();
  };

  const offState = api.onState(receive);
  const offMenu = api.onMenu((cmd) => {
    if (cmd === 'new-project') void store.dispatch({ type: 'new-project' });
    else if (cmd === 'print') void store.dispatch({ type: 'print' });
    else if (cmd === 'project-settings') void store.dispatch({ type: 'project-settings' });
    // The selection belongs to the Schedule view; elsewhere the item does nothing (as in the in-window menu).
    else if (cmd === 'delete-task') {
      if (snapshot.ui.view === 'schedule') void store.dispatch({ type: 'delete-task' });
    }
    // Only the template editor reports unsaved work: show it so it can ask what to do.
    else if (cmd === 'confirm-close') setUi({ view: 'templates', dialog: null, closeRequest: snapshot.ui.closeRequest + 1 });
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
        case 'remove-recent':
          await store.run(() => api.removeRecent(action.path));
          return;
        case 'open-sample':
          await store.run(() => api.openSample());
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
        case 'add-assets':
          if (snapshot.app?.project) store.openDialog('add-assets');
          return;
        case 'delete-task': {
          const id = snapshot.ui.selectedTaskId;
          if (id && snapshot.app?.project?.tasks.some((t) => t.id === id)) store.openDialog('delete-task');
          return;
        }
        case 'print':
          if (snapshot.app?.project) setUi({ dialog: 'print', printKind: action.kind ?? snapshot.ui.printKind });
          return;
        case 'project-settings':
          if (snapshot.app?.project) store.openDialog('project-settings');
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
    setStatus: (status) => {
      const cur = snapshot.ui.status;
      if (cur === status || (cur && status && cur.left === status.left && cur.right === status.right)) return;
      setUi({ status });
    },
    selectTask: (selectedTaskId) => {
      const { ui } = snapshot;
      if (ui.selectedTaskId === selectedTaskId && ui.selectedTaskIds.length === (selectedTaskId ? 1 : 0)) return;
      setUi({ selectedTaskId, selectedTaskIds: selectedTaskId ? [selectedTaskId] : [] });
    },
    toggleTaskSelection: (id) => {
      const cur = snapshot.ui.selectedTaskIds;
      const selectedTaskIds = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      setUi({ selectedTaskIds, selectedTaskId: selectedTaskIds[0] ?? null });
    },
    setScheduleZoom: (scheduleZoom) => {
      if (snapshot.ui.scheduleZoom !== scheduleZoom) setUi({ scheduleZoom });
    },
    setPrintKind: (printKind) => {
      if (snapshot.ui.printKind !== printKind) setUi({ printKind });
    },
    setAssetFilter: (ids) => {
      const keep = ids ? new Set(ids) : null;
      const assets = snapshot.app?.project?.assets ?? [];
      setFilterUi({ assetQuery: '', hiddenAssetIds: keep ? assets.filter((a) => !keep.has(a.id)).map((a) => a.id) : [] });
    },
    setAssetQuery: (assetQuery) => {
      if (snapshot.ui.assetQuery !== assetQuery) setFilterUi({ assetQuery });
    },
    setAssetsShown: (ids, shown) => {
      const hidden = new Set(snapshot.ui.hiddenAssetIds);
      for (const id of ids) {
        if (shown) hidden.delete(id);
        else hidden.add(id);
      }
      setFilterUi({ hiddenAssetIds: [...hidden] });
    },
    setLookAheadWeeks: (lookAheadWeeks) => {
      if (snapshot.ui.lookAheadWeeks !== lookAheadWeeks) setUi({ lookAheadWeeks });
    },
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

/** The asset filter as ids of assets that exist in the open project, or null for all. */
export function useAssetFilter(): Id[] | null {
  const app = useAppState();
  const filter = useSelect((s) => s.ui.assetFilter);
  return useMemo(() => {
    if (!filter || !app?.project) return null;
    const known = new Set(app.project.assets.map((a) => a.id));
    return filter.filter((id) => known.has(id));
  }, [filter, app]);
}

/** The selected task of the open project, or null (none selected, or it was deleted). */
export function useSelectedTask(): Task | null {
  const app = useAppState();
  const id = useSelect((s) => s.ui.selectedTaskId);
  return useMemo(() => (id && app?.project ? (app.project.tasks.find((t) => t.id === id) ?? null) : null), [id, app]);
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
