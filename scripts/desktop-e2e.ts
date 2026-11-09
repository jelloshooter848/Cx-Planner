/**
 * End-to-end check of the desktop app: opens a project passed on the command line, edits
 * through the preload API, undoes with Ctrl+Z, closes, and creates a new project from the
 * start screen. Native dialogs are answered by patching Electron's dialog module.
 * Usage (Linux without a display: wrap in xvfb-run -a):
 *   pnpm --filter @cx/desktop build && pnpm desktop:e2e [screenshot-dir]
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { riversideProject } from '@cx/fixtures';
import { ProjectStore } from '@cx/storage';
import type { AppState } from '../apps/desktop/src/shared/api.js';

const shots = resolve(process.argv[2] ?? 'spike-output/desktop-e2e');
mkdirSync(shots, { recursive: true });
const check = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(`FAIL: ${msg}`);
  console.log(`ok   ${msg}`);
};

const dir = mkdtempSync(join(tmpdir(), 'cx-e2e-'));
const userData = join(dir, 'user');
const workspace = join(dir, 'Workspace');
mkdirSync(userData);
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ workspacePath: workspace }));
const file = join(dir, 'Riverside.cxp');
const store = ProjectStore.open(file, { create: true });
store.replaceProject(riversideProject(), 'test');
store.close();

const desktop = resolve('apps/desktop');
const app = await electron.launch({
  executablePath: createRequire(join(desktop, 'package.json'))('electron') as unknown as string,
  args: ['--no-sandbox', '--disable-gpu', '.', file],
  cwd: desktop,
  env: { ...process.env, NODE_OPTIONS: '', CX_USER_DATA: userData },
});
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1400, height: 900 });
  const state = () => page.evaluate(() => window.cx.getState()) as Promise<AppState>;
  /** Polls the main-process state until `pred` holds. */
  const waitState = async (pred: (s: AppState) => boolean, what: string) => {
    for (let i = 0; i < 150; i++) {
      if (pred(await state())) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`FAIL: timed out waiting for ${what}`);
  };
  await waitState((x) => x.project !== null, 'the project to open');
  const win = await app.browserWindow(page);
  check((await win.evaluate((w) => w.getTitle())) === 'Cx Planner — Riverside.cxp', 'window title names the file');
  let s = await state();
  check(s.workspacePath === workspace, 'workspace from settings is open');
  check(Object.keys(s.schedule).length === s.project!.tasks.length, 'schedule summary for every task');
  await page.waitForSelector('iframe[title="Print preview"]');
  await page.screenshot({ path: join(shots, 'project-open.png') });

  const task = s.project!.tasks[0]!;
  const r = await page.evaluate((id) => window.cx.apply({ kind: 'updateTask', id, patch: { name: 'Edited in e2e' } }), task.id);
  check(r.ok, 'edit applied');
  s = await state();
  check(s.canUndo && s.project!.tasks[0]!.name === 'Edited in e2e', 'edit is in the state, undo available');
  const refused = await page.evaluate((id) => window.cx.apply({ kind: 'updateTask', id, patch: { percentComplete: 150 }, restore: true }), task.id);
  check(!refused.ok && refused.code === 'invalid-input', 'undo-only command refused from the renderer');

  await page.getByText('3-week look-ahead').click();
  await page.keyboard.press('Control+z');
  await waitState((x) => !x.canUndo, 'undo');
  s = await state();
  check(s.project!.tasks[0]!.name === task.name && s.canRedo, 'Ctrl+Z undid the edit');

  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('heading', { name: 'Recent projects' }).waitFor();
  check((await win.evaluate((w) => w.getTitle())) === 'Cx Planner', 'title resets after close');
  check((await state()).recent[0]?.path === file, 'file is in the recent list');
  await page.screenshot({ path: join(shots, 'start.png') });

  const newFile = join(workspace, 'Job 7.cxp');
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog;
  }, newFile);
  await page.getByRole('button', { name: 'New project…' }).click();
  await page.getByLabel('Project name').fill('Job 7');
  await page.getByLabel('Start date').fill('2026-11-02');
  await page.screenshot({ path: join(shots, 'new-project.png') });
  await page.getByRole('button', { name: 'Create…' }).click();
  await waitState((x) => x.fileName === 'Job 7.cxp', 'the new project');
  check((await state()).project!.name === 'Job 7', 'new project created from the form');
  await page.getByText('This project has no assets yet.').waitFor();
  await page.screenshot({ path: join(shots, 'new-project-open.png') });

  const tpl = await page.evaluate(() => window.cx.templates.list());
  check(tpl.ok && tpl.value.length >= 8, 'template library listed through the API');
  console.log(`screenshots in ${shots}`);
} finally {
  await app.close();
}
