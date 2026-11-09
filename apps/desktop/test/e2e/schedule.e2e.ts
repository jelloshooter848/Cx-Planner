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
});
