import { afterEach, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { launchApp, type AppHarness } from './harness.js';

let h: AppHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const panel = (page: Page) => page.getByRole('complementary', { name: 'Task details' });
const field = (page: Page, label: string) => panel(page).getByLabel(label, { exact: true });

async function openRiverside(): Promise<AppHarness> {
  const app = await launchApp({ project: 'riverside' });
  await app.page.getByRole('grid', { name: 'Tasks' }).waitFor();
  return app;
}

async function selectTask(page: Page, id: string) {
  await page.locator(`#gantt-row-${id.replace('.', '\\.')} .gc-id`).click();
}

describe('task panel', () => {
  it('shows the selected task like 01-Main, with the critical path callout', async () => {
    h = await openRiverside();
    const { page } = h;
    await expect(panel(page).textContent()).resolves.toContain('Select a task');
    await selectTask(page, 't1.4');
    const p = panel(page);
    await expect(p.getByRole('heading').textContent()).resolves.toBe('Task 1.4 · SWGR-1A');
    expect(await field(page, 'Task name').inputValue()).toBe('Relay settings & calibration');
    expect(await field(page, 'Start').inputValue()).toBe('Nov 10');
    expect(await field(page, 'Duration (working days)').inputValue()).toBe('4');
    expect(await field(page, '% complete').inputValue()).toBe('0');
    expect(await field(page, 'Predecessors').inputValue()).toBe('1.3 FS');
    expect(await field(page, 'Type').inputValue()).toBe('task');
    expect(await field(page, 'Responsible').inputValue()).toBe('Relay technician');
    await expect(p.getByTestId('float-note').textContent()).resolves.toBe('Critical path. 0 days of float. A slip here moves energization on Nov 18.');
    await h.screenshot('task-panel-critical');

    await selectTask(page, 't4.1');
    await expect(p.getByTestId('float-note').textContent()).resolves.toBe('Float: 1 day');
  });

  it('edits the duration and the dates after it move; undo restores them', async () => {
    h = await openRiverside();
    const { page } = h;
    const before = await h.state();
    expect(before.schedule['t1.5']!.start).toBe('2026-11-16');
    await selectTask(page, 't1.4');
    const dur = field(page, 'Duration (working days)');
    await dur.fill('6');
    await dur.press('Enter');
    const after = await h.waitState((s) => s.project!.tasks.find((t) => t.id === 't1.4')!.durationDays === 6, 'the new duration');
    // Two more working days push 1.5 from Mon Nov 16 to Wed Nov 18, and the grid shows it.
    expect(after.schedule['t1.5']!.start).toBe('2026-11-18');
    await expect.poll(() => page.locator('#gantt-row-t1\\.5 .gc').nth(3).textContent()).toBe('Nov 18');
    expect(after.undoLabel).toBe('Updated 1.4: duration');

    // One edit is one undo step (Ctrl+Z from the grid, outside the text field).
    await page.getByRole('grid', { name: 'Tasks' }).focus();
    await page.keyboard.press('Control+Z');
    const undone = await h.waitState((s) => s.project!.tasks.find((t) => t.id === 't1.4')!.durationDays === 4, 'undo');
    expect(undone.schedule['t1.5']!.start).toBe('2026-11-16');
    expect(undone.project).toEqual(before.project);
    await expect.poll(() => dur.inputValue()).toBe('4');
  });

  it('shows bad predecessors and loops under the field and changes nothing', async () => {
    h = await openRiverside();
    const { page } = h;
    const before = await h.state();
    await selectTask(page, 't1.4');
    const preds = field(page, 'Predecessors');
    await preds.fill('9.9');
    await preds.press('Enter');
    const err = panel(page).locator('[data-field="predecessors"] .field-error');
    await expect(err.textContent()).resolves.toBe('There is no task 9.9');
    expect(await preds.getAttribute('aria-invalid')).toBe('true');

    // 1.5 already follows 1.4, so 1.4 after 1.5 would be a loop: the command is refused.
    await preds.fill('1.3, 1.5');
    await preds.press('Enter');
    await expect.poll(() => err.textContent()).toBe('Linking 1.5 → 1.4 would make a loop');
    await h.screenshot('task-panel-predecessor-error');
    expect((await h.state()).revision).toBe(before.revision);
    expect((await h.state()).project).toEqual(before.project);

    // Escape puts the saved value back and clears the error.
    await preds.press('Escape');
    expect(await preds.inputValue()).toBe('1.3 FS');
    expect(await err.count()).toBe(0);

    // A good value saves as one step.
    await preds.fill('1.3 FS+1');
    await preds.press('Enter');
    const s = await h.waitState((x) => x.project!.dependencies.some((d) => d.successorId === 't1.4' && d.lagDays === 1), 'the new lag');
    expect(s.schedule['t1.4']!.start).toBe('2026-11-11');
  });

  it('edits name, start, percent, type, responsible and notes', async () => {
    h = await openRiverside();
    const { page } = h;
    await selectTask(page, 't3.2');
    const task = async () => (await h!.state()).project!.tasks.find((t) => t.id === 't3.2')!;

    const name = field(page, 'Task name');
    await name.fill('Battery string verification (all strings)');
    await name.press('Tab');
    await h.waitState((s) => s.project!.tasks.find((t) => t.id === 't3.2')!.name.endsWith('(all strings)'), 'the name');

    const start = field(page, 'Start');
    await start.fill('Dec 1');
    await start.press('Enter');
    await h.waitState((s) => s.schedule['t3.2']!.start === '2026-12-01', 'the start constraint');
    expect((await task()).startNoEarlierThan).toBe('2026-12-01');
    await expect(panel(page).locator('[data-field="start"] .field-hint').textContent()).resolves.toContain('Not before Dec 1');
    await start.fill('someday');
    await start.press('Enter');
    await expect(panel(page).locator('[data-field="start"] .field-error').textContent()).resolves.toContain('is not a date');
    await start.press('Escape');
    await panel(page).getByRole('button', { name: 'Clear' }).click();
    await h.waitState((s) => s.project!.tasks.find((t) => t.id === 't3.2')!.startNoEarlierThan === undefined, 'the constraint to clear');

    const pct = field(page, '% complete');
    await pct.fill('150');
    await pct.press('Enter');
    await expect(panel(page).locator('[data-field="percent"] .field-error').textContent()).resolves.toBe('% complete must be between 0 and 100');
    await pct.fill('25');
    await pct.press('Enter');
    await h.waitState((s) => s.project!.tasks.find((t) => t.id === 't3.2')!.percentComplete === 25, 'the percent');

    await field(page, 'Type').selectOption('witness');
    await h.waitState((s) => s.project!.tasks.find((t) => t.id === 't3.2')!.type === 'witness', 'the type');
    await field(page, 'Type').selectOption('milestone');
    await h.waitState((s) => s.project!.tasks.find((t) => t.id === 't3.2')!.durationDays === 0, 'a 0-day milestone');

    const resp = field(page, 'Responsible');
    await resp.fill('');
    await resp.press('Enter');
    await h.waitState((s) => s.project!.tasks.find((t) => t.id === 't3.2')!.responsible === undefined, 'responsible cleared');

    const notes = field(page, 'Notes');
    await notes.fill('Bring the load bank.');
    await notes.press('Enter'); // a new line, not a save
    await notes.type('Second line.');
    await name.click(); // blur saves
    await h.waitState((s) => s.project!.tasks.find((t) => t.id === 't3.2')!.notes === 'Bring the load bank.\nSecond line.', 'the notes');
    await h.screenshot('task-panel-edited');

    // Each edit above was its own undo step.
    expect((await h.state()).undoLabel).toBe('Updated 3.2: notes');
  });

  it('edits name and duration in the grid on double-click', async () => {
    h = await openRiverside();
    const { page } = h;
    await page.locator('#gantt-row-t1\\.4 .gc-task').dblclick();
    const nameEdit = page.getByRole('textbox', { name: 'Name of task 1.4' });
    await nameEdit.fill('Relay settings');
    await nameEdit.press('Enter');
    await h.waitState((s) => s.project!.tasks.find((t) => t.id === 't1.4')!.name === 'Relay settings', 'the grid rename');
    await expect(page.locator('#gantt-row-t1\\.4 .gc-task').textContent()).resolves.toBe('Relay settings');
    // Focus is back on the grid, so arrow keys move the selection again.
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.gantt-row[aria-selected="true"] .gc-id').textContent()).resolves.toBe('1.5');

    await page.locator('#gantt-row-t1\\.4 .gc-dur').dblclick();
    const durEdit = page.getByRole('textbox', { name: 'Duration of task 1.4 in working days' });
    await durEdit.fill('2');
    await h.screenshot('task-grid-inline-edit');
    await durEdit.press('Enter');
    const s = await h.waitState((x) => x.project!.tasks.find((t) => t.id === 't1.4')!.durationDays === 2, 'the grid duration');
    expect(s.schedule['t1.5']!.start).toBe('2026-11-12');

    // Escape cancels.
    await page.locator('#gantt-row-t1\\.4 .gc-dur').dblclick();
    await page.getByRole('textbox', { name: 'Duration of task 1.4 in working days' }).fill('9');
    await page.keyboard.press('Escape');
    expect(await page.getByRole('textbox', { name: 'Duration of task 1.4 in working days' }).count()).toBe(0);
    expect((await h.state()).revision).toBe(s.revision);
  });

  it('deletes the selected task with Delete after a confirm, and undo brings it back', async () => {
    h = await openRiverside();
    const { page } = h;
    const before = await h.state();
    await selectTask(page, 't1.4');
    await page.keyboard.press('Delete');
    const dialog = page.getByRole('dialog', { name: 'Delete task 1.4?' });
    await dialog.waitFor();
    await expect(dialog.textContent()).resolves.toContain('Relay settings & calibration');
    await h.screenshot('task-delete-confirm');
    // Cancel leaves it.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect((await h.state()).project!.tasks.length).toBe(before.project!.tasks.length);

    await page.getByRole('grid', { name: 'Tasks' }).focus();
    await page.keyboard.press('Delete');
    await page.getByRole('dialog', { name: 'Delete task 1.4?' }).getByRole('button', { name: 'Delete task' }).click();
    const after = await h.waitState((s) => !s.project!.tasks.some((t) => t.id === 't1.4'), 'the task to go');
    expect(after.project!.tasks.find((t) => t.id === 't1.5')!.code).toBe('1.4');
    await expect(panel(page).textContent()).resolves.toContain('Select a task');

    await page.keyboard.press('Control+Z');
    const undone = await h.waitState((s) => s.project!.tasks.some((t) => t.id === 't1.4'), 'undo of the delete');
    expect(undone.project).toEqual(before.project);
  });

  it('shows the template checklist of a task made from a template', async () => {
    h = await openRiverside();
    const { page } = h;
    // Add one asset from the starter LV switchgear template through the main process.
    const added = await page.evaluate(async () => {
      const t = await window.cx.templates.get('starter-lv-switchgear');
      if (!t.ok) return t.message;
      const r = await window.cx.apply({ kind: 'addAssetsFromTemplate', template: t.value, assets: [{ tag: 'SWGR-9Z', description: 'Test switchgear' }] });
      return r.ok ? 'ok' : r.message;
    });
    expect(added).toBe('ok');
    const s = await h.waitState((x) => x.project!.assets.some((a) => a.tag === 'SWGR-9Z'), 'the new asset');
    const asset = s.project!.assets.find((a) => a.tag === 'SWGR-9Z')!;
    const relay = s.project!.tasks.find((t) => t.assetId === asset.id && t.templateKey === 'relay')!;
    // Select it from the keyboard: End goes to the last task (5.6 Energization), then up two rows.
    expect(s.project!.tasks.at(-3)!.id).toBe(relay.id);
    await page.getByRole('grid', { name: 'Tasks' }).focus();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(panel(page).getByRole('heading').textContent()).resolves.toBe(`Task ${relay.code} · SWGR-9Z`);
    const sheet = panel(page).locator('[data-field="test-sheet"]');
    await expect.poll(() => sheet.textContent()).toContain('Low-voltage switchgear ·');
    await sheet.getByRole('button', { name: /^Open test sheet/ }).click();
    const dlg = page.getByRole('dialog');
    const items = dlg.getByRole('list', { name: 'Checklist items' }).getByRole('listitem');
    expect(await items.count()).toBeGreaterThan(0);
    await h.screenshot('task-test-sheet');
    await dlg.getByRole('button', { name: 'Close' }).click();
    expect(await page.getByRole('dialog').count()).toBe(0);

    // A task added by hand has none.
    await selectTask(page, 't1.4');
    await expect(sheet.textContent()).resolves.toContain('None');
  });
});
