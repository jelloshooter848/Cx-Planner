import { afterEach, describe, expect, it } from 'vitest';
import { riversideProject } from '@cx/fixtures';
import { launchApp, type AppHarness } from './harness.js';

let h: AppHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const selectedCode = (h: AppHarness) => h.page.locator('.gantt-row[aria-selected="true"] .gc-id').textContent();

describe('schedule Gantt', () => {
  it('shows every asset of the Riverside sample, with bars, and zooms', async () => {
    h = await launchApp({ project: 'riverside' });
    const { page } = h;
    const grid = page.getByRole('grid', { name: 'Tasks' });
    await grid.waitFor();

    const sample = riversideProject();
    for (const a of sample.assets) {
      const group = page.locator(`.gantt-row.is-group[data-asset-id="${a.id}"]`);
      await expect(group.locator('.gantt-tag').textContent()).resolves.toBe(a.tag);
      await expect(group.textContent()).resolves.toContain(`${a.description} · ${a.location}`);
    }
    expect(await page.locator('.gantt-row.is-task').count()).toBe(sample.tasks.length);
    // Every task has a bar or milestone diamond; critical ones have the red ring.
    expect(await page.locator('.gantt-bars [data-task-id]').count()).toBe(sample.tasks.length);
    expect(await page.locator('.gantt-bars .gb-critical .gb-crit-ring').count()).toBeGreaterThan(0);
    expect(await page.locator('.gantt-bars .gb-label', { hasText: 'Hold' }).count()).toBeGreaterThan(0);
    expect(await page.locator('.gantt-bars .gb-label', { hasText: 'Witness' }).count()).toBeGreaterThan(0);
    // A vertical SVG line has a zero-width box, so check it is drawn rather than "visible".
    await page.getByTestId('gantt-data-date').waitFor({ state: 'attached' });
    // Predecessors and readiness symbols in the table.
    const row13 = page.locator('#gantt-row-t1\\.3');
    await expect(row13.locator('.gc-pred').textContent()).resolves.toBe('1.2 FS');
    expect(await row13.locator('.gc-times svg').count()).toBe(5);
    await expect(page.getByRole('group', { name: 'Legend' }).textContent()).resolves.toContain('T I M E S');
    await h.screenshot('schedule-gantt-week');

    const zoom = page.getByRole('group', { name: 'Zoom' });
    const dayWidth = async () => Number(await grid.getAttribute('data-day-width'));
    const barWidth = async () => Number(await page.locator('[data-task-id="t1.4"] .gb-bar').getAttribute('width'));
    expect(await zoom.getByRole('button', { name: 'Week' }).getAttribute('aria-pressed')).toBe('true');
    const week = { day: await dayWidth(), bar: await barWidth(), header: await page.getByTestId('gantt-time-header').textContent() };
    expect(week.header).toContain('November 2026');
    expect(week.header).toContain('Nov 9');

    await zoom.getByRole('button', { name: 'Day' }).click();
    await expect.poll(dayWidth).toBeGreaterThan(week.day);
    expect(await barWidth()).toBeGreaterThan(week.bar);
    expect(await zoom.getByRole('button', { name: 'Day' }).getAttribute('aria-pressed')).toBe('true');
    await h.screenshot('schedule-gantt-day');

    await zoom.getByRole('button', { name: 'Month' }).click();
    await expect.poll(dayWidth).toBeLessThan(week.day);
    expect(await barWidth()).toBeLessThan(week.bar);
    const monthHeader = await page.getByTestId('gantt-time-header').textContent();
    expect(monthHeader).toContain('2026');
    expect(monthHeader).toContain('Dec');
    await h.screenshot('schedule-gantt-month');
  });

  it('selects rows by click and arrow keys', async () => {
    h = await launchApp({ project: 'riverside' });
    const { page } = h;
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();
    await page.locator('#gantt-row-t1\\.4 .gc-task').click();
    await expect(selectedCode(h)).resolves.toBe('1.4');
    await page.keyboard.press('ArrowDown');
    await expect(selectedCode(h)).resolves.toBe('1.5');
    // Moving past the last task of an asset skips the next group header.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(selectedCode(h)).resolves.toBe('2.1');
    await page.keyboard.press('ArrowUp');
    await expect(selectedCode(h)).resolves.toBe('1.6');
    await page.keyboard.press('Home');
    await expect(selectedCode(h)).resolves.toBe('1.1');
    // Clicking a bar selects its task too.
    await page.locator('.gantt-bars [data-task-id="t3.2"] .gb-bar').click();
    await expect(selectedCode(h)).resolves.toBe('3.2');
    await h.screenshot('schedule-gantt-selected');
    await page.keyboard.press('Escape');
    expect(await page.locator('.gantt-row[aria-selected="true"]').count()).toBe(0);
  });

  it('keeps a 1000+ task project light and scrolls to the end', async () => {
    h = await launchApp({ project: 'large', largeAssets: 220 });
    const { page } = h;
    const grid = page.getByRole('grid', { name: 'Tasks' });
    await grid.waitFor();
    const state = await h.state();
    expect(state.project!.tasks.length).toBeGreaterThan(1000);
    expect(Number(await grid.getAttribute('aria-rowcount'))).toBe(state.project!.tasks.length + state.project!.assets.length + 1);
    // Only the rows in view are in the DOM.
    expect(await page.locator('.gantt-row').count()).toBeLessThan(80);

    // Scroll through the whole list; each frame should stay quick.
    const ms = await page.evaluate(async () => {
      const el = document.querySelector('.gantt-scroll') as HTMLElement;
      const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
      const times: number[] = [];
      for (let i = 0; i <= 40; i++) {
        el.scrollTop = (el.scrollHeight * i) / 40;
        const t0 = performance.now();
        await frame();
        await frame();
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      return { median: times[Math.floor(times.length / 2)]!, p90: times[Math.floor(times.length * 0.9)]! };
    });
    // Two frames at 60 Hz are about 33ms; leave some slack for xvfb.
    expect(ms.median).toBeLessThan(50);
    expect(ms.p90).toBeLessThan(80);
    const lastAsset = state.project!.assets.at(-1)!;
    await page.locator(`.gantt-row.is-group[data-asset-id="${lastAsset.id}"]`).waitFor();
    expect(await page.locator('.gantt-row').count()).toBeLessThan(80);

    // End selects the last task and keeps it in view.
    await grid.focus();
    await page.keyboard.press('Home');
    await page.locator('.gantt-row[aria-selected="true"]').waitFor();
    await expect(selectedCode(h)).resolves.toBe('1.1');
    await page.keyboard.press('End');
    await expect(selectedCode(h)).resolves.toBe(state.project!.tasks.at(-1)!.code);
    await h.screenshot('schedule-gantt-large');
  });

  it('fits a 1366×768 laptop: collapsible side panels and a resizable table', async () => {
    h = await launchApp({ project: 'riverside', size: { width: 1366, height: 768 } });
    const { page } = h;
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();
    const pane = page.getByTestId('gantt-timeline-pane');
    const splitter = page.getByRole('separator', { name: 'Resize task table' });
    const paneWidth = async () => (await pane.boundingBox())!.width;
    const gridWidth = async () => Number(await splitter.getAttribute('aria-valuenow'));
    const cellsWidth = async () => (await page.locator('.gantt-head-cells').boundingBox())!.width;
    const assets = page.getByRole('complementary', { name: 'Assets in view', exact: true });
    const details = page.getByRole('complementary', { name: 'Task details' });

    // Both panels open: the table gives way so the timeline keeps its minimum width.
    await page.locator('#gantt-row-t1\\.4 .gc-task').click();
    expect(await paneWidth()).toBeGreaterThanOrEqual(240);
    await h.screenshot('schedule-1366-panels-open');

    // Fold both panels from their chevrons; focus lands on the button that opens them again.
    await assets.getByRole('button', { name: 'Hide assets in view panel' }).click();
    const showAssets = page.getByRole('button', { name: 'Show assets in view panel' });
    await expect.poll(() => showAssets.evaluate((el) => el === document.activeElement)).toBe(true);
    await details.getByRole('button', { name: 'Hide details panel' }).click();
    expect(await assets.count()).toBe(0);
    expect(await details.count()).toBe(0);
    await expect.poll(paneWidth).toBeGreaterThanOrEqual(600);
    // Selecting another task leaves the details panel folded.
    await page.locator('#gantt-row-t2\\.2 .gc-task').click();
    expect(await details.count()).toBe(0);
    await h.screenshot('schedule-1366-panels-collapsed');

    // Drag the splitter: the table widens and the timeline narrows by the same amount.
    const before = { grid: await gridWidth(), pane: await paneWidth(), cells: await cellsWidth() };
    const box = (await splitter.boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, y, { steps: 4 });
    await page.mouse.move(box.x + box.width / 2 + 100, y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(gridWidth).toBe(before.grid + 100);
    expect(await cellsWidth()).toBeCloseTo(before.cells + 100, 0);
    expect(await paneWidth()).toBeCloseTo(before.pane - 100, 0);
    expect((await h.page.evaluate(() => localStorage.getItem('cx.scheduleLayout.v1'))) ?? '').toContain(`"gridWidth":${before.grid + 100}`);

    // Keyboard: arrows move it 16 px, Home goes to the narrowest table; double-click resets.
    await splitter.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(gridWidth).toBe(before.grid + 84);
    await page.keyboard.press('Home');
    await expect.poll(gridWidth).toBe(320);
    expect(await cellsWidth()).toBeCloseTo(320, 0);
    // Columns that do not fit are hidden whole, and the header says how many.
    await expect(page.getByTestId('gantt-cols-hidden').textContent()).resolves.toBe('+3');
    expect(await page.locator('.gantt-colheads [role="columnheader"]').allTextContents()).toEqual(['ID', 'Task', 'Dur', 'Start', 'Timeline']);
    await h.screenshot('schedule-1366-narrow-table');

    // The layout comes back after a reload: the same table width, both panels still folded.
    await page.reload();
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();
    await expect.poll(gridWidth).toBe(320);
    await showAssets.waitFor();
    await page.getByRole('button', { name: 'Show details panel' }).waitFor();
    expect(await assets.count()).toBe(0);
    expect(await details.count()).toBe(0);
    await expect.poll(paneWidth).toBeGreaterThanOrEqual(600);
    // The selection is not part of the layout; pick the task again (the panel stays folded).
    await page.locator('#gantt-row-t2\\.2 .gc-task').click();
    expect(await details.count()).toBe(0);
    await splitter.dblclick();
    await expect.poll(gridWidth).toBe(before.grid);

    // View menu items and the strips' buttons open the panels again, as they were.
    await page.getByRole('menubar').getByRole('menuitem', { name: 'View' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Assets panel' }).click();
    await assets.waitFor();
    await page.getByRole('button', { name: 'Show details panel' }).click();
    await details.waitFor();
    await expect(details.textContent()).resolves.toContain('Task 2.2');
    await expect.poll(paneWidth).toBeLessThan(600);
    expect(await paneWidth()).toBeGreaterThanOrEqual(240);
    await h.screenshot('schedule-1366-panels-reopened');
  });
});
