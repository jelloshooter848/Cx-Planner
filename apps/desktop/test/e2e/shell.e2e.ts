import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { riversideProject } from '@cx/fixtures';
import { ProjectStore } from '@cx/storage';
import { launchApp, type AppHarness } from './harness.js';

let h: AppHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

describe('desktop shell', () => {
  it('creates a new project from the welcome screen and names the file in the title', async () => {
    h = await launchApp();
    const { page } = h;
    await page.getByRole('main', { name: 'Welcome' }).waitFor();
    await expect(page.getByTestId('titlebar').textContent()).resolves.toBe('Cx Planner');
    await expect(page.getByTestId('statusbar').textContent()).resolves.toContain('No project open');
    await h.screenshot('welcome');

    const file = join(h.workspace, 'Job 7.cxp');
    await h.answerSave(file);
    await page.getByRole('button', { name: 'New project…' }).click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await dialog.getByLabel('Project name').fill('Job 7');
    await dialog.getByLabel('Start date').fill('2026-11-02');
    await h.screenshot('new-project-dialog');
    await dialog.getByRole('button', { name: 'Create…' }).click();

    await h.waitState((s) => s.fileName === 'Job 7.cxp', 'the new project');
    await page.getByTestId('titlebar').getByText('— Job 7.cxp').waitFor();
    expect(await page.getByTestId('titlebar').textContent()).toBe('Cx Planner — Job 7.cxp');
    expect(await h.windowTitle()).toBe('Cx Planner — Job 7.cxp');
    expect(await dialog.count()).toBe(0);
    const status = await page.getByTestId('statusbar').textContent();
    expect(status).toContain('0 assets · 0 tasks');
    expect(status).toMatch(/Data as of \w{3} \d{1,2}, \d{4} · Saved/);
    await page.getByText('No assets yet').waitFor();
    await h.screenshot('new-project-open');

    // Ctrl+N opens the form from anywhere; Escape closes it.
    await page.keyboard.press('Control+n');
    await dialog.waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });

    // Tab and Shift+Tab stay inside the dialog.
    await page.keyboard.press('Control+n');
    await dialog.waitFor();
    const focusInDialog = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await focusInDialog()).toBe(true);
    }
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await focusInDialog()).toBe(true);
    }
    // Escape closes it even when focus has left it.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
  });

  it('shows the undo and redo action in the Edit menu', async () => {
    h = await launchApp({ project: 'riverside' });
    const { page } = h;
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();
    expect(await page.getByTestId('titlebar').textContent()).toBe('Cx Planner — Riverside.cxp');
    expect(await page.getByTestId('statusbar').textContent()).toMatch(/^Riverside Data Center – Bldg A · 4 assets · \d+ tasks · Critical path ends \w{3} \d{1,2}Data as of Nov \d{1,2}, 2026 · Saved$/);
    await h.screenshot('schedule');

    const editMenu = page.getByRole('menu', { name: 'Edit' });
    const openEdit = async () => {
      await page.getByRole('menubar').getByRole('menuitem', { name: 'Edit', exact: true }).click();
      await editMenu.waitFor();
    };
    await openEdit();
    await expect(editMenu.getByRole('menuitem', { name: 'Undo', exact: true }).isDisabled()).resolves.toBe(true);
    await expect(editMenu.getByRole('menuitem', { name: 'Redo', exact: true }).isDisabled()).resolves.toBe(true);
    await page.keyboard.press('Escape');
    await editMenu.waitFor({ state: 'detached' });

    const s = await h.state();
    const task = s.project!.tasks[0]!;
    const r = await page.evaluate((id) => window.cx.apply({ kind: 'updateTask', id, patch: { name: 'Edited in e2e' } }), task.id);
    expect(r.ok).toBe(true);
    const summary = r.ok ? r.value.summary : null;
    expect(summary).toBeTruthy();
    await page.getByRole('gridcell', { name: 'Edited in e2e' }).waitFor();

    await openEdit();
    const undo = editMenu.getByRole('menuitem', { name: `Undo ${summary}` });
    expect(await undo.isEnabled()).toBe(true);
    expect(await undo.getAttribute('aria-keyshortcuts')).toBe('Ctrl+Z');
    await h.screenshot('edit-menu');
    await undo.click();
    await h.waitState((x) => !x.canUndo && x.canRedo, 'undo from the menu');
    await page.getByRole('gridcell', { name: 'Edited in e2e' }).waitFor({ state: 'detached' });

    await openEdit();
    expect(await editMenu.getByRole('menuitem', { name: `Redo ${summary}` }).isEnabled()).toBe(true);
    await page.keyboard.press('Escape');

    // Keyboard: Ctrl+Y redoes, Ctrl+Z undoes.
    await page.keyboard.press('Control+y');
    await h.waitState((x) => x.canUndo && x.project!.tasks[0]!.name === 'Edited in e2e', 'Ctrl+Y redo');
    await page.keyboard.press('Control+z');
    await h.waitState((x) => !x.canUndo && x.project!.tasks[0]!.name === task.name, 'Ctrl+Z undo');
    await page.keyboard.press('Control+Shift+z');
    await h.waitState((x) => x.canUndo, 'Ctrl+Shift+Z redo');
  });

  it('switches views from the menu row and closes back to the welcome screen', async () => {
    h = await launchApp({ project: 'riverside' });
    const { page } = h;
    const bar = page.getByRole('menubar');

    // Undo-only commands are refused from the renderer.
    const task = (await h.state()).project!.tasks[0]!;
    const refused = await page.evaluate((id) => window.cx.apply({ kind: 'updateTask', id, patch: { percentComplete: 150 }, restore: true }), task.id);
    expect(!refused.ok && refused.code).toBe('invalid-input');

    await bar.getByRole('menuitem', { name: 'Templates', exact: true }).click();
    const library = page.getByRole('complementary', { name: 'Template library' });
    await library.getByText('Starter templates').waitFor();
    await library.getByText('Low-voltage switchgear').waitFor();
    expect(await bar.getByRole('menuitem', { name: 'Templates', exact: true }).getAttribute('aria-current')).toBe('page');
    await h.screenshot('templates');

    await bar.getByRole('menuitem', { name: 'Reports', exact: true }).click();
    await page.getByRole('menu', { name: 'Reports' }).getByRole('menuitemcheckbox', { name: '3-week look-ahead' }).click();
    await page.frameLocator('iframe[title="Print preview"]').locator('svg').first().waitFor();
    await h.screenshot('look-ahead');

    await bar.getByRole('menuitem', { name: 'Schedule', exact: true }).click();
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();

    await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
    const file = page.getByRole('menu', { name: 'File' });
    for (const name of ['New project…', 'Open…', 'Open recent', 'Save As…', 'Close project', 'Exit']) {
      await file.getByRole('menuitem', { name, exact: true }).waitFor();
    }
    await h.screenshot('file-menu');
    await file.getByRole('menuitem', { name: 'Close project' }).click();

    await page.getByRole('main', { name: 'Welcome' }).waitFor();
    expect(await h.windowTitle()).toBe('Cx Planner');
    const recent = page.getByRole('button', { name: /^Riverside\.cxp/ });
    await recent.waitFor();
    await h.screenshot('welcome-recent');

    // Reopen from the recent list.
    await recent.click();
    await h.waitState((s) => s.fileName === 'Riverside.cxp', 'reopen from recent');
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();
  });

  it('gets back to the welcome screen from Templates, and closing from Templates shows it', async () => {
    h = await launchApp();
    const { page } = h;
    const bar = page.getByRole('menubar');
    const welcome = page.getByRole('main', { name: 'Welcome' });
    const library = page.getByRole('complementary', { name: 'Template library' });
    await welcome.waitFor();

    // Templates work without a project; the Schedule tab leads back to the welcome screen.
    await bar.getByRole('menuitem', { name: 'Templates', exact: true }).click();
    await library.getByText('Starter templates').waitFor();
    expect(await bar.getByRole('menuitem', { name: 'Schedule', exact: true }).isEnabled()).toBe(true);
    await bar.getByRole('menuitem', { name: 'Schedule', exact: true }).click();
    await welcome.waitFor();

    // View > Start page, and the link in the Templates view, do the same.
    await bar.getByRole('menuitem', { name: 'Templates', exact: true }).click();
    await library.waitFor();
    await bar.getByRole('menuitem', { name: 'View', exact: true }).click();
    await page.getByRole('menu', { name: 'View' }).getByRole('menuitemcheckbox', { name: 'Start page' }).click();
    await welcome.waitFor();
    await bar.getByRole('menuitem', { name: 'Templates', exact: true }).click();
    await h.screenshot('templates-no-project');
    await page.getByRole('button', { name: 'Back to start page' }).click();
    await welcome.waitFor();

    // Open a project, go to Templates, close: the welcome screen shows.
    const path = join(h.workspace, 'Close.cxp');
    const store = ProjectStore.open(path, { create: true });
    store.replaceProject(riversideProject(), 'e2e');
    store.close();
    await h.answerOpen(path);
    await page.keyboard.press('Control+o');
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();
    await bar.getByRole('menuitem', { name: 'Templates', exact: true }).click();
    await library.waitFor();
    expect(await page.getByRole('button', { name: 'Back to start page' }).count()).toBe(0);
    await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menu', { name: 'File' }).getByRole('menuitem', { name: 'Close project' }).click();
    await welcome.waitFor();
  });

  it('makes the menu row one tab stop reached with F10 or Alt', async () => {
    h = await launchApp();
    const { page } = h;
    await page.getByRole('main', { name: 'Welcome' }).waitFor();
    const bar = page.getByRole('menubar');
    const tabStops = () => bar.evaluate((el) => [...el.querySelectorAll('[data-top]')].filter((b) => (b as HTMLElement).tabIndex === 0).map((b) => b.textContent));
    expect(await tabStops()).toEqual(['File']);
    const focusedTop = () => page.evaluate(() => (document.activeElement?.closest('[role="menubar"]') ? document.activeElement.textContent : null));

    await page.keyboard.press('F10');
    expect(await focusedTop()).toBe('File');
    await page.keyboard.press('ArrowRight');
    expect(await focusedTop()).toBe('Edit');
    expect(await tabStops()).toEqual(['Edit']);
    // A lone Alt leaves the row; the next one comes back to the item last used.
    await page.keyboard.press('Alt');
    expect(await focusedTop()).toBeNull();
    await page.keyboard.press('Alt');
    expect(await focusedTop()).toBe('Edit');
    // Tab leaves the row in one step, to the first control of the welcome screen.
    await page.keyboard.press('Tab');
    expect(await focusedTop()).toBeNull();
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('New project…');
  });

  it('lists a project opened from the command line under Open recent', async () => {
    h = await launchApp({ project: 'riverside' });
    const { page } = h;
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();
    await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
    const openRecent = page.getByRole('menu', { name: 'File' }).getByRole('menuitem', { name: 'Open recent' });
    expect(await openRecent.isEnabled()).toBe(true);
    await openRecent.hover();
    await page.getByRole('menu', { name: 'Open recent' }).getByRole('menuitem', { name: /^Riverside\.cxp/ }).waitFor();
  });

  it('opens a project with Ctrl+O in a fresh profile and reopens it from the keyboard menu', async () => {
    h = await launchApp();
    const { page } = h;
    await page.getByRole('main', { name: 'Welcome' }).waitFor();
    const path = join(h.workspace, 'Keyboard.cxp');
    const store = ProjectStore.open(path, { create: true });
    store.replaceProject(riversideProject(), 'e2e');
    store.close();

    await h.answerOpen(path);
    await page.keyboard.press('Control+o');
    await h.waitState((s) => s.fileName === 'Keyboard.cxp', 'Ctrl+O open');
    await page.getByTestId('titlebar').getByText('— Keyboard.cxp').waitFor();

    // The recent list the renderer shows already has the file.
    const fileTop = page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true });
    await fileTop.click();
    const fileMenu = page.getByRole('menu', { name: 'File' });
    const openRecent = fileMenu.getByRole('menuitem', { name: 'Open recent' });
    expect(await openRecent.isEnabled()).toBe(true);
    await openRecent.hover();
    await page.getByRole('menu', { name: 'Open recent' }).getByRole('menuitem', { name: /^Keyboard\.cxp/ }).waitFor();
    await fileMenu.getByRole('menuitem', { name: 'Close project' }).click();
    await page.getByRole('main', { name: 'Welcome' }).waitFor();

    // Keyboard only: File, ArrowDown into the menu, down to Open recent, ArrowRight, Enter.
    await fileTop.focus();
    await page.keyboard.press('ArrowDown');
    await fileMenu.waitFor();
    const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    expect(await focused()).toMatch(/^New project/);
    for (let i = 0; i < 5 && !(await focused()).startsWith('Open recent'); i++) await page.keyboard.press('ArrowDown');
    expect(await focused()).toMatch(/^Open recent/);
    await page.keyboard.press('ArrowRight');
    const flyout = page.getByRole('menu', { name: 'Open recent' });
    await flyout.waitFor();
    await page.waitForFunction(() => !!document.activeElement?.closest('[role="menu"][aria-label="Open recent"]'));
    expect(await focused()).toMatch(/^Keyboard\.cxp/);
    await h.screenshot('open-recent-keyboard');
    await page.keyboard.press('Enter');
    await h.waitState((s) => s.fileName === 'Keyboard.cxp', 'reopen from Open recent');
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();
    expect(await fileMenu.count()).toBe(0);
  });
});
