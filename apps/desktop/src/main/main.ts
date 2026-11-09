import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { riversideProject } from '@cx/fixtures';
import type { PaperId } from '@cx/render';
import { htmlToPdf, lookAheadDocument, setFontDir } from './print.js';
import { runSpikes } from './spikes.js';

const dist = join(__dirname, '..');
setFontDir(join(dist, 'fonts'));
const args = process.argv.slice(1);
const headless = args.includes('--spike-pdf') || args.includes('--spike-sqlite');

// M0: the demo shows the sample project. Opening real project files arrives in M1.
const project = riversideProject();

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Cx Planner',
    webPreferences: { preload: join(dist, 'preload/preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.removeMenu();
  void win.loadFile(join(dist, 'renderer/index.html'));
}

ipcMain.handle('print:lookahead-html', (_e, paper: PaperId) => {
  const { html, layout } = lookAheadDocument(project, { paper, weeks: 3 });
  return { html, sheets: layout.sheets.length, widthIn: layout.paper.widthIn, heightIn: layout.paper.heightIn };
});

ipcMain.handle('print:lookahead-pdf', async (e, paper: PaperId) => {
  const { html, title } = lookAheadDocument(project, { paper, weeks: 3 });
  const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
  const target = await dialog.showSaveDialog(win!, { defaultPath: `${title.replace(/[^\w\- ]+/g, '').trim()}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (target.canceled || !target.filePath) return { saved: false };
  writeFileSync(target.filePath, await htmlToPdf(html));
  return { saved: true, path: target.filePath };
});

app.whenReady().then(async () => {
  // Renderer may load only bundled files; no remote content.
  session.defaultSession.webRequest.onHeadersReceived((details, cb) =>
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self' data:; style-src 'self' 'unsafe-inline' data:; font-src 'self' data:"] } }),
  );
  if (headless) {
    const results = await runSpikes(args);
    for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${r.detail}`);
    app.exit(results.every((r) => r.ok) ? 0 : 1);
    return;
  }
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  // Offscreen print windows come and go during headless runs; only quit for the real UI.
  if (!headless && process.platform !== 'darwin') app.quit();
});
