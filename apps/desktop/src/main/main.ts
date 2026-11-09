import { app, BrowserWindow, Menu, session as electronSession } from 'electron';
import { join, resolve } from 'node:path';
import type { AppState, MenuCommand } from '../shared/api.js';
import { CH } from '../shared/channels.js';
import { CHROME, TRAFFIC_LIGHT_POSITION } from '../shared/chrome.js';
import { electronDialogs } from './electron-dialogs.js';
import { FileController, projectArg } from './files.js';
import { registerIpc } from './ipc.js';
import { buildMenu, menuKey } from './menu.js';
import { RecentFiles, SettingsFile } from './prefs.js';
import { setFontDir } from './print.js';
import { Session, windowTitle } from './session.js';
import { runSpikes } from './spikes.js';

const dist = join(__dirname, '..');
setFontDir(join(dist, 'fonts'));
const args = process.argv.slice(1);
const headless = args.some((a) => a.startsWith('--spike-'));

// Lets tests run against a throwaway profile (settings, recent list).
if (process.env.CX_USER_DATA) app.setPath('userData', resolve(process.env.CX_USER_DATA));

let win: BrowserWindow | undefined;
/** A file the OS asked us to open before the window was ready (macOS open-file). */
let pendingOpen: string | undefined = projectArg(args);
let ready = false;

if (!headless && !app.requestSingleInstanceLock()) {
  // Another window is running; it gets our arguments through 'second-instance'.
  app.quit();
} else if (headless) {
  // Offscreen print windows come and go during headless runs; don't quit when they close.
  app.on('window-all-closed', () => {});
  app.whenReady().then(async () => {
    const results = await runSpikes(args);
    for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${r.detail}`);
    app.exit(results.every((r) => r.ok) ? 0 : 1);
  });
} else {
  startApp();
}

function startApp(): void {
  const userData = app.getPath('userData');
  const dialogs = electronDialogs(() => win);
  const recent = new RecentFiles(join(userData, 'recent.json'));
  const settings = new SettingsFile(join(userData, 'settings.json'));
  let shownMenu = '';
  const toRenderer = (cmd: MenuCommand) => win?.webContents.send(CH.menu, cmd);
  const broadcast = (state: AppState) => {
    if (!win || win.isDestroyed()) return;
    win.setTitle(windowTitle(state));
    win.webContents.send(CH.state, state);
    const key = menuKey(state);
    if (key !== shownMenu) {
      shownMenu = key;
      Menu.setApplicationMenu(buildMenu({ session, files, dialogs, toRenderer }, state));
    }
  };
  const session = new Session({ broadcast, recent: () => recent.list() });
  const files = new FileController({ session, dialogs, recent, settings, defaultWorkspace: join(app.getPath('documents'), 'Cx Planner Workspace') });
  registerIpc({ session, files, dialogs });

  const open = (path: string) => {
    if (!ready) {
      pendingOpen = path;
      return;
    }
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    void files.openPath(path);
  };

  app.on('second-instance', (_e, argv, cwd) => {
    const path = projectArg(argv.slice(1), cwd);
    if (path) open(path);
    else win?.focus();
  });
  app.on('open-file', (e, path) => {
    e.preventDefault();
    open(path);
  });

  app.whenReady().then(async () => {
    // Renderer may load only bundled files; no remote content.
    electronSession.defaultSession.webRequest.onHeadersReceived((details, cb) =>
      cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self' data:; style-src 'self' 'unsafe-inline' data:; font-src 'self' data:"] } }),
    );
    win = new BrowserWindow({
      width: 1400,
      height: 900,
      title: 'Cx Planner',
      backgroundColor: CHROME.background,
      // The page draws the dark title bar and the menu row (see renderer TitleBar/MenuBar);
      // the OS draws only the window buttons over it.
      titleBarStyle: 'hidden',
      ...(process.platform === 'darwin' ? { trafficLightPosition: TRAFFIC_LIGHT_POSITION } : { titleBarOverlay: { color: CHROME.titleBar, symbolColor: CHROME.titleBarSymbol, height: CHROME.titleBarHeight } }),
      webPreferences: { preload: join(dist, 'preload/preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    // The title is ours (it names the open file), not the page's.
    win.on('page-title-updated', (e) => e.preventDefault());
    // No navigation away from the bundled page and no new windows.
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // Windows/Linux: the in-window menu row replaces the native menu bar.
    if (process.platform !== 'darwin') win.setMenuBarVisibility(false);
    // The renderer holds an unsaved template draft: let it ask Save / Discard / Cancel. It
    // closes the window itself once the draft is saved or discarded (unsavedWork is then null).
    win.on('close', (e) => {
      if (!session.unsavedWork || win?.webContents.isCrashed()) return;
      e.preventDefault();
      toRenderer('confirm-close');
    });
    win.on('closed', () => (win = undefined));
    session.notify();
    await win.loadFile(join(dist, 'renderer/index.html'));
    await files.ensureWorkspace();
    ready = true;
    if (pendingOpen) {
      const path = pendingOpen;
      pendingOpen = undefined;
      await files.openPath(path);
    }
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => session.dispose());
}
