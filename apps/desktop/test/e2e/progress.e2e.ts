import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import type { Task } from '@cx/core';
import type { AppState } from '../../src/shared/api.js';
import { launchApp, type AppHarness } from './harness.js';

let h: AppHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const panel = (page: Page) => page.getByRole('complementary', { name: 'Task details' });
const field = (page: Page, label: string) => panel(page).getByLabel(label, { exact: true });
const row = (page: Page, id: string) => page.locator(`#gantt-row-${id.replace('.', '\\.')}`);
const taskOf = (s: AppState, id: string): Task => s.project!.tasks.find((t) => t.id === id)!;

async function openRiverside(): Promise<AppHarness> {
  const app = await launchApp({ project: 'riverside' });
  await app.page.getByRole('grid', { name: 'Tasks' }).waitFor();
  return app;
}

/** Summaries in the project file's change log, read beside the running app. */
function changeLog(file: string): string[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare('SELECT DISTINCT revision, summary FROM change_event WHERE summary IS NOT NULL ORDER BY revision').all() as { summary: string }[]).map((r) => r.summary);
  } finally {
    db.close();
  }
}

describe('progress entry', () => {
  it('records % complete and actual dates in the task panel, following the progress rules', async () => {
    h = await openRiverside();
    const { page } = h;
    await row(page, 't1.4').locator('.gc-id').click();
    expect(await field(page, 'Actual start').inputValue()).toBe('');
    expect(await field(page, 'Actual finish').inputValue()).toBe('');

    // % above 0 fills in the actual start from the computed start (Nov 10).
    const pct = field(page, '% complete');
    await pct.fill('30');
    await pct.press('Enter');
    let s = await h.waitState((x) => taskOf(x, 't1.4').percentComplete === 30, 'the percent');
    expect(taskOf(s, 't1.4').actualStart).toBe('2026-11-10');
    await expect.poll(() => field(page, 'Actual start').inputValue()).toBe('Nov 10');
    expect(s.undoLabel).toBe('Updated 1.4: % complete, actual start');

    // A finish before the start is refused under the field.
    const finish = field(page, 'Actual finish');
    await finish.fill('Nov 9');
    await finish.press('Enter');
    await expect(panel(page).locator('[data-field="actual-finish"] .field-error').textContent()).resolves.toContain('cannot be before the actual start');
    // An actual finish sets 100%.
    await finish.fill('Nov 12');
    await finish.press('Enter');
    s = await h.waitState((x) => taskOf(x, 't1.4').actualFinish === '2026-11-12', 'the actual finish');
    expect(taskOf(s, 't1.4').percentComplete).toBe(100);
    await expect.poll(() => pct.inputValue()).toBe('100');

    // 100% asks for the actual finish (default: the data date) and the missing start.
    await row(page, 't1.5').locator('.gc-id').click();
    await field(page, '% complete').fill('100');
    await field(page, '% complete').press('Enter');
    const prompt = page.getByRole('dialog', { name: 'Mark 1.5 complete' });
    await prompt.waitFor();
    expect(await prompt.getByLabel('Actual finish').inputValue()).toBe('2026-11-06');
    // Its computed start (Nov 13) is after the data date, so the start defaults to the finish.
    expect(await prompt.getByLabel('Actual start').inputValue()).toBe('2026-11-06');
    await prompt.getByLabel('Actual start').fill('2026-11-09');
    await h.screenshot('progress-finish-prompt');
    await prompt.getByRole('button', { name: 'Mark complete' }).click();
    await expect(prompt.getByRole('alert').textContent()).resolves.toContain('cannot be before the actual start');
    await prompt.getByLabel('Actual start').fill('2026-11-05');
    await prompt.getByRole('button', { name: 'Mark complete' }).click();
    s = await h.waitState((x) => taskOf(x, 't1.5').percentComplete === 100, 'the task to be complete');
    expect(taskOf(s, 't1.5')).toMatchObject({ actualStart: '2026-11-05', actualFinish: '2026-11-06' });
    await prompt.waitFor({ state: 'detached' });
    expect(s.undoLabel).toBe('Updated 1.5: % complete, actual start, actual finish');

    // Clearing the actual start sets the task back to not started, in one undo step.
    const start = field(page, 'Actual start');
    await start.fill('');
    await start.press('Enter');
    s = await h.waitState((x) => taskOf(x, 't1.5').actualStart === undefined, 'the reset');
    expect(taskOf(s, 't1.5')).toMatchObject({ percentComplete: 0 });
    expect(taskOf(s, 't1.5').actualFinish).toBeUndefined();
    await row(page, 't1.5').locator('.gc-id').click();
    await page.keyboard.press('Control+z');
    await h.waitState((x) => taskOf(x, 't1.5').percentComplete === 100, 'the undo');
    await h.screenshot('progress-panel');

    expect(changeLog(h.projectFile!)).toEqual(
      expect.arrayContaining([
        'Updated 1.4: % complete, actual start',
        'Updated 1.4: % complete, actual finish',
        'Updated 1.5: % complete, actual start, actual finish',
        'Updated 1.5: % complete, actual start, actual finish',
      ]),
    );
  });

  it('edits % and actual dates in place in progress mode', async () => {
    h = await openRiverside();
    const { page } = h;
    const toggle = page.getByRole('button', { name: 'Progress mode' });
    expect(await toggle.getAttribute('aria-pressed')).toBe('false');
    await expect(page.getByRole('columnheader', { name: 'Actual start' }).count()).resolves.toBe(0);
    await toggle.click();
    expect(await toggle.getAttribute('aria-pressed')).toBe('true');
    await page.getByRole('columnheader', { name: 'Actual start' }).waitFor();

    // One click opens the cell; Enter saves and moves down to the next task.
    await row(page, 't2.3').locator('.gc-pct').click();
    await page.getByRole('textbox', { name: '% complete of task 2.3' }).fill('40');
    await page.keyboard.press('Enter');
    const s = await h.waitState((x) => taskOf(x, 't2.3').percentComplete === 40, 'the grid percent');
    expect(taskOf(s, 't2.3').actualStart).toBeDefined();
    await expect(row(page, 't2.3').locator('.gc-pct').textContent()).resolves.toBe('40%');
    // Tab moves across the row.
    await page.getByRole('textbox', { name: '% complete of task 2.4' }).waitFor();
    await page.keyboard.press('Tab');
    const startEdit = page.getByRole('textbox', { name: 'Actual start of task 2.4' });
    await startEdit.fill('Nov 5');
    await h.screenshot('progress-mode-grid');
    await page.keyboard.press('Tab');
    await h.waitState((x) => taskOf(x, 't2.4').actualStart === '2026-11-05', 'the grid actual start');
    await page.getByRole('textbox', { name: 'Actual finish of task 2.4' }).waitFor();
    await page.keyboard.press('Escape');
    await expect(row(page, 't2.4').locator('.gc-astart').textContent()).resolves.toBe('Nov 5');
    expect(taskOf(await h.state(), 't2.4').percentComplete).toBe(0);

    // 100% in the grid asks for the finish too; 1.3 already has its start.
    await row(page, 't1.3').locator('.gc-pct').click();
    await page.getByRole('textbox', { name: '% complete of task 1.3' }).fill('100');
    await page.keyboard.press('Enter');
    const prompt = page.getByRole('dialog', { name: 'Mark 1.3 complete' });
    await prompt.waitFor();
    await expect(prompt.getByLabel('Actual start').count()).resolves.toBe(0);
    await prompt.getByRole('button', { name: 'Mark complete' }).click();
    await h.waitState((x) => taskOf(x, 't1.3').actualFinish === '2026-11-06' && taskOf(x, 't1.3').percentComplete === 100, 'the grid completion');
    await expect(row(page, 't1.3').locator('.gc-afinish').textContent()).resolves.toBe('Nov 6');

    // A bad value is refused with a notice and the cell stays as it was.
    await row(page, 't2.5').locator('.gc-pct').click();
    await page.getByRole('textbox', { name: '% complete of task 2.5' }).fill('150');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert').first().textContent()).resolves.toContain('% complete must be between 0 and 100');

    await toggle.click();
    await page.getByRole('columnheader', { name: 'Actual start' }).waitFor({ state: 'detached' });
    await page.getByRole('columnheader', { name: 'Pred' }).waitFor();
  });

  it('changes the data date from the status bar', async () => {
    h = await openRiverside();
    const { page } = h;
    const before = await h.state();
    await page.getByRole('button', { name: /Data as of Nov 6, 2026/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Data date' });
    const input = dialog.getByLabel('Data as of');
    expect(await input.inputValue()).toBe('2026-11-06');
    await input.fill('2026-11-13');
    await h.screenshot('progress-data-date');
    await dialog.getByRole('button', { name: 'Set data date' }).click();
    const s = await h.waitState((x) => x.project!.dataDate === '2026-11-13', 'the data date');
    await dialog.waitFor({ state: 'detached' });
    expect(s.undoLabel).toBe('Set data date to 2026-11-13');
    // Unstarted work moves to the new data date.
    expect(s.schedule['t1.4']!.start >= '2026-11-13').toBe(true);
    expect(before.schedule['t1.4']!.start < '2026-11-13').toBe(true);
    await expect(page.getByTestId('statusbar').textContent()).resolves.toContain('Data as of Nov 13, 2026 · Saved');
    expect(changeLog(h.projectFile!)).toContain('Set data date to 2026-11-13');

    await page.keyboard.press('Control+z');
    await h.waitState((x) => x.project!.dataDate === '2026-11-06', 'the undo');
  });
});
