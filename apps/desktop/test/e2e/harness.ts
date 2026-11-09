/**
 * Launches the built desktop app under Playwright for UI tests. Each launch gets a throwaway
 * profile (settings, recent list) and workspace in a temp folder, and optionally a project
 * file made from the made-up fixtures, opened on start.
 *
 * Native dialogs cannot be clicked by Playwright, so tests answer them in advance by
 * patching Electron's dialog module in the main process (answerSave / answerOpen).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { largeProject, riversideProject } from '@cx/fixtures';
import { ProjectStore } from '@cx/storage';
import type { AppState } from '../../src/shared/api.js';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const shotDir = resolve(process.env.CX_E2E_SHOTS ?? join(desktop, '../../spike-output/desktop-e2e'));

export interface LaunchOptions {
  /** Project file to create from fixtures and open on start; null starts on the welcome screen. */
  project?: 'riverside' | 'large' | null;
  /** Window content size. Default 1440×900, like the mockups. */
  size?: { width: number; height: number };
}

export interface AppHarness {
  app: ElectronApplication;
  page: Page;
  /** Temp folder holding everything below; removed by close(). */
  dir: string;
  workspace: string;
  /** The fixture project file, when one was created. */
  projectFile: string | null;
  /** The main process's current AppState. */
  state(): Promise<AppState>;
  /** Polls the state until `pred` holds (or fails after `timeoutMs`). */
  waitState(pred: (s: AppState) => boolean, what: string, timeoutMs?: number): Promise<AppState>;
  /** The native window title. */
  windowTitle(): Promise<string>;
  /** The next save dialog answers with `path` (null = cancel). */
  answerSave(path: string | null): Promise<void>;
  /** The next open dialog answers with `path` (null = cancel). */
  answerOpen(path: string | null): Promise<void>;
  /** Saves a screenshot of the window to spike-output/desktop-e2e/<name>.png (or $CX_E2E_SHOTS). */
  screenshot(name: string): Promise<string>;
  close(): Promise<void>;
}

export async function launchApp(options: LaunchOptions = {}): Promise<AppHarness> {
  const dir = mkdtempSync(join(tmpdir(), 'cx-e2e-'));
  let app: ElectronApplication | undefined;
  try {
    return await start(dir, options, (a) => (app = a));
  } catch (err) {
    // Nothing returned a harness, so afterEach cannot close() it: clean up here.
    await app?.close().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

async function start(dir: string, options: LaunchOptions, launched: (app: ElectronApplication) => void): Promise<AppHarness> {
  const userData = join(dir, 'user');
  const workspace = join(dir, 'Workspace');
  mkdirSync(userData);
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ workspacePath: workspace }));

  let projectFile: string | null = null;
  if (options.project) {
    const project = options.project === 'large' ? largeProject() : riversideProject();
    projectFile = join(dir, options.project === 'large' ? 'Large.cxp' : 'Riverside.cxp');
    const store = ProjectStore.open(projectFile, { create: true });
    store.replaceProject(project, 'e2e');
    store.close();
  }

  const app = await electron.launch({
    executablePath: createRequire(join(desktop, 'package.json'))('electron') as unknown as string,
    args: ['--no-sandbox', '--disable-gpu', '.', ...(projectFile ? [projectFile] : [])],
    cwd: desktop,
    env: { ...process.env, NODE_OPTIONS: '', CX_USER_DATA: userData },
  });
  launched(app);
  const page = await app.firstWindow();
  const size = options.size ?? { width: 1440, height: 900 };
  const win = await app.browserWindow(page);
  await win.evaluate((w, s) => w.setContentSize(s.width, s.height), size);
  await page.setViewportSize(size);

  const state = () => page.evaluate(() => window.cx.getState());
  const waitState = async (pred: (s: AppState) => boolean, what: string, timeoutMs = 15_000) => {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const s = await state();
      if (pred(s)) return s;
      if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  const h: AppHarness = {
    app,
    page,
    dir,
    workspace,
    projectFile,
    state,
    waitState,
    windowTitle: () => win.evaluate((w) => w.getTitle()),
    async answerSave(path) {
      await app.evaluate(({ dialog }, target) => {
        dialog.showSaveDialog = (async () => (target ? { canceled: false, filePath: target } : { canceled: true, filePath: '' })) as typeof dialog.showSaveDialog;
      }, path);
    },
    async answerOpen(path) {
      await app.evaluate(({ dialog }, target) => {
        dialog.showOpenDialog = (async () => ({ canceled: !target, filePaths: target ? [target] : [] })) as typeof dialog.showOpenDialog;
      }, path);
    },
    async screenshot(name) {
      mkdirSync(shotDir, { recursive: true });
      const path = join(shotDir, `${name}.png`);
      await page.screenshot({ path });
      return path;
    },
    async close() {
      // A window left with unsaved work would wait for an answer; don't let that hang the run.
      const timer = setTimeout(() => app.process().kill(), 10_000);
      await app.close().catch(() => {});
      clearTimeout(timer);
      rmSync(dir, { recursive: true, force: true });
    },
  };
  if (projectFile) await waitState((s) => s.project !== null, 'the fixture project to open');
  return h;
}
