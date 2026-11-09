import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import type { AppState, MenuCommand } from '../shared/api.js';
import type { FileController } from './files.js';
import type { Session } from './session.js';

export interface MenuContext {
  session: Session;
  files: FileController;
  /** Forwards a command the renderer handles (it needs a form). */
  toRenderer(cmd: MenuCommand): void;
}

/** Menu labels treat & as a mnemonic marker; show user text literally. */
const amp = (t: string) => t.replace(/&/g, '&&');

/** What the menu shows; the menu is rebuilt only when this changes. */
export function menuKey(s: AppState): string {
  return JSON.stringify([s.filePath, s.undoLabel, s.redoLabel, s.workspacePath, s.recent.map((r) => r.path)]);
}

/**
 * The application menu. Project undo/redo shortcuts are not registered here: the renderer
 * binds Ctrl+Z / Ctrl+Y itself when focus is not in a text field, so text fields keep
 * their own undo.
 */
export function buildMenu(ctx: MenuContext, s: AppState): Menu {
  const { session, files } = ctx;
  const isMac = process.platform === 'darwin';
  const open = s.project !== null;
  const recent: MenuItemConstructorOptions[] = s.recent.length
    ? s.recent.map((r) => ({ label: amp(r.name), sublabel: r.path, enabled: r.exists, click: () => void files.openRecent(r.path) }))
    : [{ label: 'No recent projects', enabled: false }];
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: '&File',
      submenu: [
        { label: 'New Project…', accelerator: 'CmdOrCtrl+N', click: () => ctx.toRenderer('new-project') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => void files.openWithDialog() },
        { label: 'Open Recent', submenu: recent },
        { type: 'separator' },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', enabled: open, click: () => void files.saveAs() },
        { label: 'Close Project', enabled: open, click: () => files.close() },
        { type: 'separator' },
        { label: 'Workspace Folder…', click: () => void files.chooseWorkspace() },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const, label: 'E&xit' }]),
      ],
    },
    {
      label: '&Edit',
      submenu: [
        // Shortcut shown as a hint only (the renderer handles the key); on macOS the roles below own Cmd+Z.
        { label: s.undoLabel ? `Undo ${amp(s.undoLabel)}` : 'Undo', enabled: s.canUndo, click: () => session.undo(), ...(isMac ? {} : { accelerator: 'Ctrl+Z', registerAccelerator: false }) },
        { label: s.redoLabel ? `Redo ${amp(s.redoLabel)}` : 'Redo', enabled: s.canRedo, click: () => session.redo(), ...(isMac ? {} : { accelerator: 'Ctrl+Y', registerAccelerator: false }) },
        // On macOS, Cmd+Z in text fields only works through these roles. Outside text fields
        // the renderer handles the key first (and prevents default), so these do not fire.
        ...(isMac ? [{ type: 'separator' as const }, { role: 'undo' as const, label: 'Undo Typing' }, { role: 'redo' as const, label: 'Redo Typing' }] : []),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    ...(app.isPackaged ? [] : [{ label: '&Developer', submenu: [{ role: 'reload' as const }, { role: 'toggleDevTools' as const }] }]),
  ];
  return Menu.buildFromTemplate(template);
}
