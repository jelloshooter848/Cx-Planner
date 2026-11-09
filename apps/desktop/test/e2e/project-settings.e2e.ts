import { afterEach, describe, expect, it } from 'vitest';
import { WorkCalendar } from '@cx/core';
import { launchApp, type AppHarness } from './harness.js';

let h: AppHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

describe('project settings', () => {
  it('adds a holiday inside a task, which pushes its finish a working day, and undoes it', async () => {
    h = await launchApp({ project: 'riverside' });
    const { page } = h;
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();
    const before = await h.state();
    const project = before.project!;
    // A task at least two days long; a holiday on its second day moves its finish.
    const task = project.tasks.find((t) => t.durationDays >= 2 && !t.actualStart && t.percentComplete === 0 && before.schedule[t.id])!;
    const was = before.schedule[task.id]!;
    const cal = new WorkCalendar(project.startDate, project.calendar);
    const holiday = cal.dateAt(was.es + 1);
    expect(holiday > was.start && holiday <= was.finish).toBe(true);

    await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menu', { name: 'File' }).getByRole('menuitem', { name: 'Project settings…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Project settings' });
    await dialog.waitFor();
    expect(await dialog.getByLabel('Project name').inputValue()).toBe(project.name);
    expect(await dialog.getByLabel('Subtitle').inputValue()).toBe(project.subtitle ?? '');
    expect(await dialog.getByLabel('Start date').inputValue()).toBe(project.startDate);
    expect(await dialog.getByRole('checkbox', { name: 'Monday' }).isChecked()).toBe(true);
    expect(await dialog.getByRole('checkbox', { name: 'Saturday' }).isChecked()).toBe(false);
    const list = dialog.getByRole('list', { name: 'Holidays' });
    expect(await list.getByRole('listitem').count()).toBe(project.calendar.holidays.length);
    await expect(list.locator('[data-date="2026-11-26"]').textContent()).resolves.toContain('Thanksgiving Day');
    await h.screenshot('project-settings');

    await dialog.getByLabel('Holiday date').fill(holiday);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await list.locator(`[data-date="${holiday}"]`).waitFor();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await dialog.waitFor({ state: 'detached' });

    const after = await h.waitState((s) => s.project!.calendar.holidays.includes(holiday), 'the holiday to be saved');
    const now = after.schedule[task.id]!;
    expect(now.start).toBe(was.start);
    const expected = new WorkCalendar(project.startDate, after.project!.calendar).dateAt(was.ef - 1);
    expect(now.finish).toBe(expected);
    expect(now.finish > was.finish).toBe(true);
    // One working day later: the old finish's next working day.
    expect(new WorkCalendar(project.startDate, after.project!.calendar).indexOf(now.finish)).toBe(cal.indexOf(was.finish));
    expect(after.undoLabel).toBe('Changed the work calendar');

    await page.keyboard.press('Control+z');
    const undone = await h.waitState((s) => !s.project!.calendar.holidays.includes(holiday), 'undo');
    expect(undone.schedule[task.id]!.finish).toBe(was.finish);
  });

  it('edits project info and adds federal holidays from the status bar, in one undo step', async () => {
    h = await launchApp({ project: 'riverside' });
    const { page } = h;
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();
    await page.getByRole('button', { name: /^Project settings: / }).click();
    const dialog = page.getByRole('dialog', { name: 'Project settings' });
    await dialog.waitFor();
    // Nothing changed yet: Save is off.
    expect(await dialog.getByRole('button', { name: 'Save' }).isDisabled()).toBe(true);

    await dialog.getByLabel('Project name').fill('Renamed Job');
    await dialog.getByLabel('Subtitle').fill('');
    await dialog.getByRole('checkbox', { name: 'Saturday' }).check();
    await dialog.getByLabel('Year').selectOption('2027');
    await dialog.getByRole('button', { name: 'Add US federal holidays for 2027' }).click();
    await expect(dialog.getByRole('status').textContent()).resolves.toBe('Added 12 US federal holidays for 2027.');
    await dialog.getByRole('button', { name: 'Remove holiday Dec 25, 2026' }).click();
    await h.screenshot('project-settings-edited');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await dialog.waitFor({ state: 'detached' });

    const s = await h.waitState((x) => x.project!.name === 'Renamed Job', 'the rename');
    expect(s.project!.subtitle).toBeUndefined();
    expect(s.project!.calendar.workWeekdays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.project!.calendar.holidays).toContain('2027-07-05');
    expect(s.project!.calendar.holidays).not.toContain('2026-12-25');
    expect(s.undoLabel).toBe('Changed project settings');
    await expect(page.getByTestId('statusbar').textContent()).resolves.toMatch(/^Renamed Job · /);

    await page.keyboard.press('Control+z');
    const undone = await h.waitState((x) => x.project!.name !== 'Renamed Job', 'undo');
    expect(undone.project!.subtitle).toBe('Electrical commissioning');
    expect(undone.project!.calendar.holidays).toEqual(['2026-11-26', '2026-12-25']);
    expect(undone.project!.calendar.workWeekdays).toEqual([1, 2, 3, 4, 5]);
  });
});
