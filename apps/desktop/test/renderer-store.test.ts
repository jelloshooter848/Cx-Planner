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
