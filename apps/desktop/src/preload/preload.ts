import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AppState, CxApi, MenuCommand } from '../shared/api.js';
import { CH } from '../shared/channels.js';

/** The only surface the renderer can reach: window.cx, typed by CxApi in shared/api.ts. */
const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: CxApi = {
  getState: () => invoke(CH.getState),
  onState: (cb) => subscribe<AppState>(CH.state, cb),
  onMenu: (cb) => subscribe<MenuCommand>(CH.menu, cb),
  apply: (cmd) => invoke(CH.apply, cmd),
  undo: () => invoke(CH.undo),
  redo: () => invoke(CH.redo),
  newProject: (input) => invoke(CH.newProject, input),
  openProject: () => invoke(CH.openProject),
  openRecent: (path) => invoke(CH.openRecent, path),
  saveAs: () => invoke(CH.saveAs),
  closeProject: () => invoke(CH.closeProject),
  chooseWorkspace: () => invoke(CH.chooseWorkspace),
  templates: {
    list: () => invoke(CH.templateList),
    get: (id) => invoke(CH.templateGet, id),
    inProject: (id) => invoke(CH.templateInProject, id),
    save: (t) => invoke(CH.templateSave, t),
    duplicate: (id, newName) => invoke(CH.templateDuplicate, id, newName),
    delete: (id) => invoke(CH.templateDelete, id),
    export: (id) => invoke(CH.templateExport, id),
    import: () => invoke(CH.templateImport),
    restoreStarters: () => invoke(CH.templateRestoreStarters),
  },
  print: {
    lookAheadHtml: (paper) => invoke(CH.lookAheadHtml, paper),
    lookAheadPdf: (paper) => invoke(CH.lookAheadPdf, paper),
  },
};

contextBridge.exposeInMainWorld('cx', api);
