import { BrowserWindow, dialog } from 'electron';
import type { Dialogs } from './files.js';

/** Dialogs shown by Electron, attached to the focused (or given) window when there is one. */
export function electronDialogs(window: () => BrowserWindow | undefined): Dialogs {
  const parent = () => BrowserWindow.getFocusedWindow() ?? window();
  return {
    async open(o) {
      const opts = { title: o.title, defaultPath: o.defaultPath, filters: o.filters, properties: o.folder ? (['openDirectory', 'createDirectory'] as const) : (['openFile'] as const) };
      const w = parent();
      const r = await (w ? dialog.showOpenDialog(w, { ...opts, properties: [...opts.properties] }) : dialog.showOpenDialog({ ...opts, properties: [...opts.properties] }));
      return r.canceled ? undefined : r.filePaths[0];
    },
    async save(o) {
      const w = parent();
      const r = await (w ? dialog.showSaveDialog(w, o) : dialog.showSaveDialog(o));
      return r.canceled ? undefined : r.filePath;
    },
    async message(o) {
      const opts = { ...o, noLink: true };
      const w = parent();
      const r = await (w ? dialog.showMessageBox(w, opts) : dialog.showMessageBox(opts));
      return r.response;
    },
  };
}
