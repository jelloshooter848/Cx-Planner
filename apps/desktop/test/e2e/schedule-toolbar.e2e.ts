import { afterEach, describe, expect, it } from 'vitest';
import { riversideProject } from '@cx/fixtures';
import { launchApp, type AppHarness } from './harness.js';

let h: AppHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const sample = riversideProject();

describe('schedule toolbar and asset sidebar', () => {
  it('adds a task after the selected one, and undo / redo it', async () => {
    h = await launchApp({ project: 'riverside' });
    const { page } = h;
    const tools = page.getByRole('toolbar', { name: 'Schedule tools' });
    const addTask = tools.getByRole('button', { name: 'Add task' });
    const undo = tools.getByRole('button', { name: 'Undo' });
    const redo = tools.getByRole('button', { name: 'Redo' });
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();
    await h.screenshot('schedule-toolbar');

    // Nothing selected and nothing to undo: disabled, with a tooltip saying why.
    expect(await addTask.isDisabled()).toBe(true);
    expect(await addTask.getAttribute('title')).toBe('Select a task to add a new one after it');
    expect(await undo.isDisabled()).toBe(true);
    expect(await undo.getAttribute('title')).toBe('Nothing to undo');
    expect(await redo.isDisabled()).toBe(true);
    // Baseline waits for a later release.
    expect(await tools.getByRole('button', { name: 'Baseline: Rev A' }).isDisabled()).toBe(true);

    await page.locator('#gantt-row-t1\\.3 .gc-task').click();
    expect(await addTask.getAttribute('title')).toBe('Add a task after 1.3');
    await addTask.click();
    const s = await h.waitState((st) => st.project!.tasks.length === sample.tasks.length + 1, 'the new task');
    const added = s.project!.tasks.find((t) => !sample.tasks.some((x) => x.id === t.id))!;
    expect(added).toMatchObject({ name: 'New task', code: '1.4', assetId: 'swgr-1a' });
    // The new task is selected and shown in the panel.
    await expect.poll(() => page.locator('.gantt-row[aria-selected="true"] .gc-id').textContent()).toBe('1.4');
    await expect.poll(() => page.locator('.gantt-row[aria-selected="true"] .gc-task').textContent()).toBe('New task');

    await expect.poll(() => undo.isDisabled()).toBe(false);
    expect(await undo.getAttribute('title')).toMatch(/^Undo: Added task 1\.4 New task/);
    await undo.click();
    await h.waitState((st) => st.project!.tasks.length === sample.tasks.length, 'undo');
    await expect.poll(() => redo.isDisabled()).toBe(false);
    expect(await redo.getAttribute('title')).toMatch(/^Redo: /);
    await redo.click();
    await h.waitState((st) => st.project!.tasks.length === sample.tasks.length + 1, 'redo');
  });

  it('links two tasks picked with Ctrl+click, and indents / outdents', async () => {
    h = await launchApp({ project: 'riverside' });
    const { page } = h;
    const tools = page.getByRole('toolbar', { name: 'Schedule tools' });
    const link = tools.getByRole('button', { name: 'Link tasks' });
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();

    await page.locator('#gantt-row-t1\\.4 .gc-task').click();
    expect(await link.isDisabled()).toBe(true);
    await page.locator('#gantt-row-t3\\.1 .gc-task').click({ modifiers: ['Control'] });
    expect(await page.locator('.gantt-row[aria-selected="true"]').count()).toBe(2);
    expect(await link.getAttribute('title')).toBe('Link 1.4 → 3.1 (finish-to-start)');
    await h.screenshot('schedule-toolbar-two-selected');
    await link.click();
    await h.waitState((st) => st.project!.dependencies.some((d) => d.predecessorId === 't1.4' && d.successorId === 't3.1' && d.type === 'FS'), 'the link');
    await expect.poll(() => page.locator('#gantt-row-t3\\.1 .gc-pred').textContent()).toContain('1.4 FS');
    // The same pair cannot be linked twice.
    await expect.poll(() => link.getAttribute('title')).toBe('3.1 already follows 1.4');

    // From the keyboard: Ctrl+Down moves the row cursor without changing the selection, and
    // Ctrl+Space adds the task under it.
    await page.locator('#gantt-row-t3\\.4 .gc-task').click();
    const grid = page.getByRole('grid', { name: 'Tasks' });
    await grid.focus();
    await page.keyboard.press('Control+ArrowDown');
    expect(await page.locator('.gantt-row[aria-selected="true"]').count()).toBe(1);
    expect(await grid.getAttribute('aria-activedescendant')).toBe('gantt-row-t4.1');
    await page.keyboard.press('Control+Space');
    expect(await page.locator('.gantt-row[aria-selected="true"]').count()).toBe(2);
    expect(await link.getAttribute('title')).toBe('Link 3.4 → 4.1 (finish-to-start)');
    // A disabled button stays focusable and describes why it is disabled.
    await page.locator('#gantt-row-t1\\.3 .gc-task').click();
    expect(await link.getAttribute('aria-disabled')).toBe('true');
    await link.focus();
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Link tasks');
    const reasonId = await link.getAttribute('aria-describedby');
    expect(await page.locator(`[id="${reasonId}"]`).textContent()).toBe('Select a task, then Ctrl+click a second task to link them');

    // Indent moves 2.1 into the asset above (as its last task); Outdent moves it back.
    await page.locator('#gantt-row-t2\\.1 .gc-task').click();
    const indent = tools.getByRole('button', { name: 'Indent' });
    expect(await indent.getAttribute('title')).toBe('Move 2.1 into SWGR-1A (above)');
    await indent.click();
    let s = await h.waitState((st) => st.project!.tasks.find((t) => t.id === 't2.1')!.assetId === 'swgr-1a', 'indent');
    expect(s.project!.tasks.find((t) => t.id === 't2.1')!.code).toBe('1.7');
    await tools.getByRole('button', { name: 'Outdent' }).click();
    s = await h.waitState((st) => st.project!.tasks.find((t) => t.id === 't2.1')!.assetId === 'xfmr-1a', 'outdent');
    expect(s.project!.tasks.find((t) => t.id === 't2.1')!.code).toBe('2.1');

    // Alt+Down moves the selected task down inside its asset.
    await page.getByRole('grid', { name: 'Tasks' }).focus();
    await page.keyboard.press('Alt+ArrowDown');
    await h.waitState((st) => st.project!.tasks.find((t) => t.id === 't2.1')!.code === '2.2', 'move down');
  });

  it('filters the Gantt from the sidebar and shows progress per asset', async () => {
    h = await launchApp({ project: 'riverside' });
    const { page } = h;
    const sidebar = page.getByRole('complementary', { name: 'Assets in view' });
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();
    const groups = () => page.locator('.gantt-row.is-group').evaluateAll((els) => els.map((e) => e.getAttribute('data-asset-id')));
    const status = page.getByTestId('statusbar').locator('.statusbar-left');

    // Grouped by system, each with a computed percent complete.
    expect(await sidebar.locator('.asset-group-head').allTextContents()).toEqual(['Normal power', 'Critical power']);
    const swgrTasks = sample.tasks.filter((t) => t.assetId === 'swgr-1a');
    const days = swgrTasks.reduce((n, t) => n + t.durationDays, 0);
    const pct = Math.round(swgrTasks.reduce((n, t) => n + t.durationDays * t.percentComplete, 0) / days);
    expect(await sidebar.locator('[data-asset-id="swgr-1a"] .asset-pct').textContent()).toBe(`${pct}%`);
    expect(await status.textContent()).toMatch(/ · 4 of 4 assets in view · \d+ tasks · Critical path ends /);

    // Unticking an asset hides it from the Gantt.
    await sidebar.getByRole('checkbox', { name: /^XFMR-1A/ }).uncheck();
    await expect.poll(groups).toEqual(['swgr-1a', 'ups-1a', 'gen-1']);
    const inView = sample.tasks.filter((t) => t.assetId !== 'xfmr-1a').length;
    await expect.poll(() => status.textContent()).toMatch(new RegExp(` · 3 of 4 assets in view · ${inView} tasks · Critical path ends`));

    // The text filter narrows by system (or tag).
    await sidebar.getByRole('searchbox').fill('critical');
    await expect.poll(groups).toEqual(['ups-1a', 'gen-1']);
    expect(await sidebar.locator('.asset-group-head').allTextContents()).toEqual(['Critical power']);
    await sidebar.getByRole('searchbox').fill('gen');
    await expect.poll(groups).toEqual(['gen-1']);
    await h.screenshot('schedule-sidebar-filtered');

    // The system tick box shows or hides the whole group.
    await sidebar.getByRole('searchbox').fill('');
    await sidebar.getByRole('checkbox', { name: 'Show all Critical power assets' }).uncheck();
    await expect.poll(groups).toEqual(['swgr-1a']);
    await sidebar.getByRole('checkbox', { name: 'Show all Normal power assets' }).check();
    await expect.poll(groups).toEqual(['swgr-1a', 'xfmr-1a']);

    // The Print dialog offers the filter.
    await page.getByRole('toolbar', { name: 'Schedule tools' }).getByRole('button', { name: 'Print / Export PDF' }).click();
    const dialog = page.getByRole('dialog', { name: 'Print / Export PDF' });
    await dialog.waitFor();
    expect(await dialog.getByRole('radio', { name: /Current asset filter/ }).first().isDisabled()).toBe(false);
    await dialog.getByRole('button', { name: 'Close' }).click();

    // With every asset unticked the Gantt says why it is empty and offers to clear the filter.
    await sidebar.getByRole('checkbox', { name: 'Show all Normal power assets' }).uncheck();
    const empty = page.getByText('No assets in view. Tick assets in the sidebar or clear the filter.');
    await empty.waitFor();
    await expect.poll(() => status.textContent()).toMatch(/ · 0 of 4 assets in view · 0 tasks/);
    await h.screenshot('schedule-no-assets-in-view');
    await page.getByRole('button', { name: 'Clear filter' }).click();
    await expect.poll(groups).toEqual(['swgr-1a', 'xfmr-1a', 'ups-1a', 'gen-1']);
    await empty.waitFor({ state: 'detached' });
  });

  it('shades the look-ahead window and changes it from the toolbar', async () => {
    h = await launchApp({ project: 'riverside' });
    const { page } = h;
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();
    const shade = page.getByTestId('gantt-lookahead');
    await shade.waitFor({ state: 'attached' });
    const width = async () => Number(await shade.getAttribute('width'));
    const dayWidth = Number(await page.getByRole('grid', { name: 'Tasks' }).getAttribute('data-day-width'));
    // Three weeks: Monday of the data-date week to Friday of the third week (19 calendar days).
    expect(Math.round((await width()) / dayWidth)).toBe(19);
    const select = page.getByRole('combobox', { name: 'Look-ahead' });
    await select.selectOption('2');
    await expect.poll(async () => Math.round((await width()) / dayWidth)).toBe(12);
    expect(await shade.locator('title').textContent()).toMatch(/^Look-ahead window /);
  });
});
