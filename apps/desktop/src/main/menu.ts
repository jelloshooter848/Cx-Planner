import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import type { ApiResult, AppState, MenuCommand } from '../shared/api.js';
import type { Dialogs, FileController } from './files.js';
import type { Session } from './session.js';

export interface MenuContext {
  session: Session;
  files: FileController;
  dialogs: Dialogs;
  /** Forwards a command the renderer handles (it needs a form). */
  toRenderer(cmd: MenuCommand): void;
}

/** Menu labels treat & as a mnemonic marker; show user text literally. */
const amp = (t: string) => t.replace(/&/g, '&&');

/**
 * Undo/redo from the menu: the renderer never sees this result, so a failed save (disk
 * full, share offline) is shown here. Nothing to undo/redo is not worth a dialog.
 */
export async function reportStep(dialogs: Dialogs, dir: 'undo' | 'redo', r: ApiResult<unknown>): Promise<void> {
  if (r.ok || r.code === 'nothing-to-undo' || r.code === 'nothing-to-redo') return;
  await dialogs.message({ type: 'error', message: dir === 'undo' ? 'Could not undo.' : 'Could not redo.', detail: r.message, buttons: ['OK'] });
}

/** What the menu shows; the menu is rebuilt only when this changes. */
export function menuKey(s: AppState): string {
  return JSON.stringify([s.filePath, s.undoLabel, s.redoLabel, s.workspacePath, s.recent.map((r) => r.path)]);
}

/**
 * The application menu. On macOS it is the system menu bar. On Windows and Linux the window
 * shows its own menu row (renderer components/MenuBar.tsx) and this menu is hidden, so its
 * shortcuts are hints only: the renderer binds Ctrl+N / Ctrl+O / Ctrl+Shift+S / Ctrl+P, and Ctrl+Z /
 * Ctrl+Y when focus is not in a text field (text fields keep their own undo).
 *
 * One owner per key and platform: on macOS this menu registers Cmd+N / Cmd+O / Cmd+Shift+S / Cmd+P
 * and the renderer leaves those keys alone (shortcutAction's `mac` flag), so they never run
 * twice. Cmd+Z / Cmd+Shift+Z stay with the renderer outside text fields (it prevents default),
 * and with the Undo Typing / Redo Typing roles inside them.
 */
export function buildMenu(ctx: MenuContext, s: AppState): Menu {
  const { session, files } = ctx;
  const isMac = process.platform === 'darwin';
  const open = s.project !== null;
  // Shortcut shown as a hint only; the renderer handles the key (see above).
  const hint = (accelerator: string) => (isMac ? { accelerator } : { accelerator, registerAccelerator: false });
  const recent: MenuItemConstructorOptions[] = s.recent.length
    ? s.recent.map((r) => ({ label: amp(r.name), sublabel: r.exists ? r.path : `${r.path} (not found)`, click: () => void files.openRecent(r.path) }))
    : [{ label: 'No recent projects', enabled: false }];
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: '&File',
      submenu: [
        { label: 'New Project…', ...hint('CmdOrCtrl+N'), click: () => ctx.toRenderer('new-project') },
        { label: 'Open…', ...hint('CmdOrCtrl+O'), click: () => void files.openWithDialog() },
        { label: 'Open Recent', submenu: recent },
        { label: 'Open Sample Project', click: () => void files.openSample() },
        { type: 'separator' },
        { label: 'Save As…', ...hint('CmdOrCtrl+Shift+S'), enabled: open, click: () => void files.saveAs() },
        { label: 'Close Project', enabled: open, click: () => files.close() },
        { type: 'separator' },
        { label: 'Project Settings…', enabled: open, click: () => ctx.toRenderer('project-settings') },
        { label: 'Print / Export PDF…', ...hint('CmdOrCtrl+P'), enabled: open, click: () => ctx.toRenderer('print') },
        { type: 'separator' },
        { label: 'Workspace Folder…', click: () => void files.chooseWorkspace() },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const, label: 'E&xit' }]),
      ],
    },
    {
      label: '&Edit',
      submenu: [
        // Shortcut shown as a hint only (the renderer handles the key); on macOS the roles below own Cmd+Z.
        { label: s.undoLabel ? `Undo ${amp(s.undoLabel)}` : 'Undo', enabled: s.canUndo, click: () => void reportStep(ctx.dialogs, 'undo', session.undo()), ...(isMac ? {} : { accelerator: 'Ctrl+Z', registerAccelerator: false }) },
        { label: s.redoLabel ? `Redo ${amp(s.redoLabel)}` : 'Redo', enabled: s.canRedo, click: () => void reportStep(ctx.dialogs, 'redo', session.redo()), ...(isMac ? {} : { accelerator: 'Ctrl+Y', registerAccelerator: false }) },
        // On macOS, Cmd+Z in text fields only works through these roles. Outside text fields
        // the renderer handles the key first (and prevents default), so these do not fire.
        ...(isMac ? [{ type: 'separator' as const }, { role: 'undo' as const, label: 'Undo Typing' }, { role: 'redo' as const, label: 'Redo Typing' }] : []),
        { type: 'separator' },
        // No accelerator: the Delete key belongs to text fields; the Schedule grid handles it itself.
        // The renderer knows the selected task, so it checks there is one and asks to confirm.
        { label: 'Delete Task…', enabled: open, click: () => ctx.toRenderer('delete-task') },
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
