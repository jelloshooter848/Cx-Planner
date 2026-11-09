import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, AppState, CxApi, MenuCommand } from '../src/shared/api.js';
import { createStore, effectiveView } from '../src/renderer/store.js';
import { riversideProject } from '@cx/fixtures';

function appState(over: Partial<AppState> = {}): AppState {
  return {
    seq: 1,
    project: null,
    schedule: {},
    projectFinish: null,
    scheduleError: null,
    filePath: null,
    fileName: null,
    revision: 0,
    lastSavedAt: null,
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
    workspacePath: '/ws',
    recent: [],
    ...over,
  };
}

/** A CxApi double: push() sends a state as the main process would. */
function fakeApi(initial: AppState) {
  let stateCb: ((s: AppState) => void) | undefined;
  let menuCb: ((c: MenuCommand) => void) | undefined;
  const okVoid = async (): Promise<ApiResult<{ filePath: string }>> => ({ ok: true, value: { filePath: '/x.cxp' } });
  const api = {
    getState: vi.fn(async () => initial),
    onState: (cb: (s: AppState) => void) => ((stateCb = cb), () => (stateCb = undefined)),
    onMenu: (cb: (c: MenuCommand) => void) => ((menuCb = cb), () => (menuCb = undefined)),
    apply: vi.fn(async (): Promise<ApiResult<{ changed: boolean; summary: string | null }>> => ({ ok: false, code: 'invalid-input', message: 'Bad edit' })),
    undo: vi.fn(async () => ({ ok: true as const, value: { changed: true, summary: 'x' } })),
    redo: vi.fn(async () => ({ ok: true as const, value: { changed: true, summary: 'x' } })),
    newProject: vi.fn(okVoid),
    openProject: vi.fn(async (): Promise<ApiResult<{ filePath: string }>> => ({ ok: false, code: 'canceled', message: 'Cancelled' })),
    openRecent: vi.fn(async (): Promise<ApiResult<{ filePath: string }>> => ({ ok: false, code: 'invalid-input', message: 'Not in the recent list' })),
    saveAs: vi.fn(okVoid),
    closeProject: vi.fn(async () => ({ ok: true as const, value: undefined })),
    chooseWorkspace: vi.fn(),
    setUnsavedWork: vi.fn(async () => ({ ok: true as const, value: undefined })),
    templates: {},
    print: {},
  } as unknown as CxApi;
  return { api, push: (s: AppState) => stateCb?.(s), menu: (c: MenuCommand) => menuCb?.(c), get subscribed() { return !!stateCb; } };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('renderer store', () => {
  it('loads the state and keeps the newest when answers arrive out of order', async () => {
    const f = fakeApi(appState({ seq: 1 }));
    const store = createStore(f.api);
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.getSnapshot().app?.seq ?? -1));
    f.push(appState({ seq: 5 }));
    await tick(); // getState() answers with seq 1 after the push of seq 5
    expect(store.getSnapshot().app?.seq).toBe(5);
    expect(seen).toEqual([5]);
    store.dispose();
    expect(f.subscribed).toBe(false);
  });

  it('shows failures as notices, but not cancels', async () => {
    const f = fakeApi(appState());
    const store = createStore(f.api);
    await store.dispatch({ type: 'open-project' });
    expect(store.getSnapshot().ui.notice).toBeNull();
    await store.dispatch({ type: 'open-recent', path: '/gone.cxp' });
    expect(store.getSnapshot().ui.notice?.message).toBe('Not in the recent list');
    store.dismissNotice();
    expect(store.getSnapshot().ui.notice).toBeNull();
    const r = await store.run(() => f.api.apply({ kind: 'updateTask', id: 't', patch: {} }));
    expect(r.ok).toBe(false);
    expect(store.getSnapshot().ui.notice?.message).toBe('Bad edit');
  });

  it('turns thrown errors into a failure and a notice', async () => {
    const store = createStore(fakeApi(appState()).api);
    const r = await store.run(async () => {
      throw new Error('IPC gone');
    });
    expect(r).toEqual({ ok: false, code: 'error', message: 'IPC gone' });
    expect(store.getSnapshot().ui.notice?.message).toBe('IPC gone');
  });

  it('only undoes, redoes, saves or closes when that is possible', async () => {
    const f = fakeApi(appState());
    const store = createStore(f.api);
    await tick();
    await store.dispatch({ type: 'undo' });
    await store.dispatch({ type: 'redo' });
    await store.dispatch({ type: 'save-as' });
    await store.dispatch({ type: 'close-project' });
    expect(f.api.undo).not.toHaveBeenCalled();
    expect(f.api.redo).not.toHaveBeenCalled();
    expect(f.api.saveAs).not.toHaveBeenCalled();
    expect(f.api.closeProject).not.toHaveBeenCalled();
    f.push(appState({ seq: 2, project: riversideProject(), filePath: '/r.cxp', fileName: 'r.cxp', canUndo: true, canRedo: true }));
    await store.dispatch({ type: 'undo' });
    await store.dispatch({ type: 'redo' });
    await store.dispatch({ type: 'save-as' });
    await store.dispatch({ type: 'close-project' });
    expect(f.api.undo).toHaveBeenCalledOnce();
    expect(f.api.redo).toHaveBeenCalledOnce();
    expect(f.api.saveAs).toHaveBeenCalledOnce();
    expect(f.api.closeProject).toHaveBeenCalledOnce();
  });

  it('opens the new-project dialog from the native menu and closes it when a file opens', async () => {
    const f = fakeApi(appState());
    const store = createStore(f.api);
    await tick();
    f.menu('new-project');
    expect(store.getSnapshot().ui.dialog).toBe('new-project');
    f.push(appState({ seq: 2, project: riversideProject(), filePath: '/r.cxp', fileName: 'r.cxp' }));
    expect(store.getSnapshot().ui.dialog).toBeNull();
  });

  it('shows the Templates view and bumps closeRequest when main asks to confirm a close', async () => {
    const f = fakeApi(appState());
    const store = createStore(f.api);
    await tick();
    store.openDialog('about');
    f.menu('confirm-close');
    expect(store.getSnapshot().ui).toMatchObject({ view: 'templates', dialog: null, closeRequest: 1 });
    f.menu('confirm-close');
    expect(store.getSnapshot().ui.closeRequest).toBe(2);
  });

  it('opens the add-assets dialog only with a project open', async () => {
    const f = fakeApi(appState());
    const store = createStore(f.api);
    await tick();
    await store.dispatch({ type: 'add-assets' });
    expect(store.getSnapshot().ui.dialog).toBeNull();
    f.push(appState({ seq: 2, project: riversideProject(), filePath: '/r.cxp', fileName: 'r.cxp' }));
    await store.dispatch({ type: 'add-assets' });
    expect(store.getSnapshot().ui.dialog).toBe('add-assets');
  });

  it('asks to delete a task only when one is selected', async () => {
    const f = fakeApi(appState({ project: riversideProject(), filePath: '/r.cxp', fileName: 'r.cxp' }));
    const store = createStore(f.api);
    await tick();
    await store.dispatch({ type: 'delete-task' });
    expect(store.getSnapshot().ui.dialog).toBeNull();
    store.selectTask('t1.4');
    await store.dispatch({ type: 'delete-task' });
    expect(store.getSnapshot().ui.dialog).toBe('delete-task');
  });

  it('asks to delete the selected task from the native Edit menu, in the Schedule view only', async () => {
    const f = fakeApi(appState({ project: riversideProject(), filePath: '/r.cxp', fileName: 'r.cxp' }));
    const store = createStore(f.api);
    await tick();
    store.selectTask('t1.4');
    store.setView('templates');
    f.menu('delete-task');
    await tick();
    expect(store.getSnapshot().ui.dialog).toBeNull();
    store.setView('schedule');
    f.menu('delete-task');
    await tick();
    expect(store.getSnapshot().ui.dialog).toBe('delete-task');
  });

  it('opens the Print dialog from the menu, on the kind asked for or the last one', async () => {
    const f = fakeApi(appState());
    const store = createStore(f.api);
    await tick();
    await store.dispatch({ type: 'print' });
    expect(store.getSnapshot().ui.dialog).toBeNull();
    f.push(appState({ seq: 2, project: riversideProject(), filePath: '/r.cxp', fileName: 'r.cxp' }));
    f.menu('print');
    expect(store.getSnapshot().ui).toMatchObject({ dialog: 'print', printKind: 'lookahead' });
    store.closeDialog();
    await store.dispatch({ type: 'print', kind: 'test-sheets' });
    expect(store.getSnapshot().ui).toMatchObject({ dialog: 'print', printKind: 'test-sheets' });
    store.closeDialog();
    await store.dispatch({ type: 'print' });
    expect(store.getSnapshot().ui.printKind).toBe('test-sheets');
  });

  it('keeps the asset filter for one project only', async () => {
    const f = fakeApi(appState({ seq: 1, project: riversideProject(), filePath: '/r.cxp', fileName: 'r.cxp' }));
    const store = createStore(f.api);
    await tick();
    store.setAssetFilter(['swgr-1a']);
    f.push(appState({ seq: 2, project: riversideProject(), filePath: '/r.cxp', fileName: 'r.cxp', revision: 3 }));
    expect(store.getSnapshot().ui.assetFilter).toEqual(['swgr-1a']);
    f.push(appState({ seq: 3, project: { ...riversideProject(), id: 'other' }, filePath: '/o.cxp', fileName: 'o.cxp' }));
    expect(store.getSnapshot().ui.assetFilter).toBeNull();
  });

  it('builds the asset filter from the sidebar text and ticks, and keeps new assets in view', async () => {
    const f = fakeApi(appState({ seq: 1, project: riversideProject(), filePath: '/r.cxp', fileName: 'r.cxp' }));
    const store = createStore(f.api);
    await tick();
    const ui = () => store.getSnapshot().ui;
    expect(ui().assetFilter).toBeNull();
    store.setAssetQuery('critical');
    expect(ui().assetFilter).toEqual(['ups-1a', 'gen-1']);
    store.setAssetsShown(['gen-1'], false);
    expect(ui().assetFilter).toEqual(['ups-1a']);
    store.setAssetQuery('');
    expect(ui().assetFilter).toEqual(['swgr-1a', 'xfmr-1a', 'ups-1a']);
    // An asset added later shows.
    const more = riversideProject();
    more.assets = [...more.assets, { id: 'ats-1', tag: 'ATS-1', description: 'Transfer switch', system: 'Critical power' }];
    f.push(appState({ seq: 2, project: more, filePath: '/r.cxp', fileName: 'r.cxp', revision: 1 }));
    expect(ui().assetFilter).toEqual(['swgr-1a', 'xfmr-1a', 'ups-1a', 'ats-1']);
    store.setAssetsShown(['gen-1'], true);
    expect(ui().assetFilter).toBeNull();
    // setAssetFilter ticks exactly the listed assets and clears the text.
    store.setAssetQuery('swgr');
    store.setAssetFilter(['gen-1', 'ups-1a']);
    expect(ui()).toMatchObject({ assetQuery: '', assetFilter: ['ups-1a', 'gen-1'] });
    store.setAssetFilter(null);
    expect(ui()).toMatchObject({ assetFilter: null, hiddenAssetIds: [] });
  });

  it('drops selected tasks whose asset leaves the view', async () => {
    const f = fakeApi(appState({ seq: 1, project: riversideProject(), filePath: '/r.cxp', fileName: 'r.cxp' }));
    const store = createStore(f.api);
    await tick();
    store.selectTask('t1.3');
    store.toggleTaskSelection('t3.1');
    store.setAssetsShown(['swgr-1a'], false);
    expect(store.getSnapshot().ui).toMatchObject({ selectedTaskId: 't3.1', selectedTaskIds: ['t3.1'] });
  });

  it('adds and removes tasks with Ctrl+click, keeping the order chosen', async () => {
    const f = fakeApi(appState({ seq: 1, project: riversideProject(), filePath: '/r.cxp', fileName: 'r.cxp' }));
    const store = createStore(f.api);
    await tick();
    const ui = () => store.getSnapshot().ui;
    store.toggleTaskSelection('t1.3');
    expect(ui()).toMatchObject({ selectedTaskId: 't1.3', selectedTaskIds: ['t1.3'] });
    store.toggleTaskSelection('t2.1');
    expect(ui()).toMatchObject({ selectedTaskId: 't1.3', selectedTaskIds: ['t1.3', 't2.1'] });
    store.toggleTaskSelection('t1.3');
    expect(ui()).toMatchObject({ selectedTaskId: 't2.1', selectedTaskIds: ['t2.1'] });
    store.toggleTaskSelection('t1.4');
    // A plain click selects one task again.
    store.selectTask('t1.1');
    expect(ui()).toMatchObject({ selectedTaskId: 't1.1', selectedTaskIds: ['t1.1'] });
    store.toggleTaskSelection('t1.2');
    // An edit that removes one keeps the other.
    const without = riversideProject();
    without.tasks = without.tasks.filter((t) => t.id !== 't1.1');
    f.push(appState({ seq: 2, project: without, filePath: '/r.cxp', fileName: 'r.cxp', revision: 1 }));
    expect(ui()).toMatchObject({ selectedTaskId: 't1.2', selectedTaskIds: ['t1.2'] });
    store.selectTask(null);
    expect(ui()).toMatchObject({ selectedTaskId: null, selectedTaskIds: [] });
  });

  it('remembers the look-ahead weeks', async () => {
    const store = createStore(fakeApi(appState()).api);
    expect(store.getSnapshot().ui.lookAheadWeeks).toBe(3);
    store.setLookAheadWeeks(6);
    expect(store.getSnapshot().ui.lookAheadWeeks).toBe(6);
  });

  it('calls exit for File > Exit', async () => {
    const exit = vi.fn();
    const store = createStore(fakeApi(appState()).api, { exit });
    await store.dispatch({ type: 'exit' });
    expect(exit).toHaveBeenCalledOnce();
  });

  it('picks the welcome screen when no project is open', async () => {
    const f = fakeApi(appState());
    const store = createStore(f.api);
    expect(effectiveView(store.getSnapshot())).toBe('welcome');
    await tick();
    expect(effectiveView(store.getSnapshot())).toBe('welcome');
    store.setView('templates');
    expect(effectiveView(store.getSnapshot())).toBe('templates');
    store.setView('lookahead');
    expect(effectiveView(store.getSnapshot())).toBe('welcome');
    f.push(appState({ seq: 2, project: riversideProject(), filePath: '/r.cxp', fileName: 'r.cxp' }));
    // A newly opened file starts on the schedule.
    expect(effectiveView(store.getSnapshot())).toBe('schedule');
  });

  it('keeps the view across Save As and resets it after a close', async () => {
    const f = fakeApi(appState());
    const store = createStore(f.api);
    await tick();
    f.push(appState({ seq: 2, project: riversideProject(), filePath: '/r.cxp', fileName: 'r.cxp' }));
    store.setView('lookahead');
    f.push(appState({ seq: 3, project: { ...riversideProject(), id: 'copy' }, filePath: '/r copy.cxp', fileName: 'r copy.cxp' }));
    expect(effectiveView(store.getSnapshot())).toBe('lookahead');
    f.push(appState({ seq: 4 }));
    f.push(appState({ seq: 5, project: riversideProject(), filePath: '/r.cxp', fileName: 'r.cxp' }));
    expect(effectiveView(store.getSnapshot())).toBe('schedule');
  });

  it('shows the welcome screen after a close from Templates, and Schedule leads back to it', async () => {
    const f = fakeApi(appState());
    const store = createStore(f.api);
    await tick();
    store.setView('templates');
    expect(effectiveView(store.getSnapshot())).toBe('templates');
    store.setView('schedule');
    expect(effectiveView(store.getSnapshot())).toBe('welcome');
    store.setView('templates');
    // Opening from Templates stays on Templates.
    f.push(appState({ seq: 2, project: riversideProject(), filePath: '/r.cxp', fileName: 'r.cxp' }));
    expect(effectiveView(store.getSnapshot())).toBe('templates');
    f.push(appState({ seq: 3 }));
    expect(effectiveView(store.getSnapshot())).toBe('welcome');
  });

  it('keeps the selected task and zoom, and clears the selection when the file changes', async () => {
    const f = fakeApi(appState());
    const store = createStore(f.api);
    await tick();
    expect(store.getSnapshot().ui.scheduleZoom).toBe('week');
    f.push(appState({ seq: 2, project: riversideProject(), filePath: '/r.cxp', fileName: 'r.cxp' }));
    let changes = 0;
    store.subscribe(() => changes++);
    store.selectTask('t1.4');
    store.selectTask('t1.4');
    store.setScheduleZoom('day');
    store.setScheduleZoom('day');
    expect(changes).toBe(2);
    expect(store.getSnapshot().ui).toMatchObject({ selectedTaskId: 't1.4', scheduleZoom: 'day' });
    // An edit to the same file keeps it.
    f.push(appState({ seq: 3, project: riversideProject(), filePath: '/r.cxp', fileName: 'r.cxp', revision: 1 }));
    expect(store.getSnapshot().ui.selectedTaskId).toBe('t1.4');
    // Save As keeps the project and its task ids, so it keeps the selection.
    f.push(appState({ seq: 4, project: riversideProject(), filePath: '/copy.cxp', fileName: 'copy.cxp' }));
    expect(store.getSnapshot().ui.selectedTaskId).toBe('t1.4');
    // An edit that removes the selected task clears it.
    const without = riversideProject();
    without.tasks = without.tasks.filter((t) => t.id !== 't1.4');
    f.push(appState({ seq: 5, project: without, filePath: '/copy.cxp', fileName: 'copy.cxp', revision: 2 }));
    expect(store.getSnapshot().ui.selectedTaskId).toBeNull();
    // A different project clears it.
    store.selectTask('t1.3');
    f.push(appState({ seq: 6, project: { ...riversideProject(), id: 'other-project' }, filePath: '/other.cxp', fileName: 'other.cxp' }));
    expect(store.getSnapshot().ui).toMatchObject({ selectedTaskId: null, scheduleZoom: 'day' });
    // Closing the project clears it.
    f.push(appState({ seq: 7, project: riversideProject(), filePath: '/r.cxp', fileName: 'r.cxp' }));
    store.selectTask('t1.3');
    f.push(appState({ seq: 8, project: null, filePath: null, fileName: null }));
    expect(store.getSnapshot().ui.selectedTaskId).toBeNull();
  });
});
