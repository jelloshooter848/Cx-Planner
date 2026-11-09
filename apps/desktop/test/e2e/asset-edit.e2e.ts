import { afterEach, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { launchApp, type AppHarness } from './harness.js';

let h: AppHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const panel = (page: Page) => page.getByRole('complementary', { name: 'Asset details' });
const field = (page: Page, label: string) => panel(page).getByLabel(label, { exact: true });
const groupRow = (page: Page, assetId: string) => page.locator(`.gantt-row.is-group[data-asset-id="${assetId}"]`);

async function openRiverside(): Promise<AppHarness> {
  const app = await launchApp({ project: 'riverside' });
  await app.page.getByRole('grid', { name: 'Tasks' }).waitFor();
  return app;
}

describe('asset edit and delete', () => {
  it('edits an asset from its group row, deletes another and undoes the delete', async () => {
    h = await openRiverside();
    const { page } = h;
    const before = await h.state();

    // Select SWGR-1A's group row: the panel shows the asset form.
    await groupRow(page, 'swgr-1a').locator('.gc-group').click();
    expect(await groupRow(page, 'swgr-1a').getAttribute('aria-selected')).toBe('true');
    await expect(panel(page).getByRole('heading').textContent()).resolves.toBe('Asset 1 · 6 tasks');
    expect(await field(page, 'Tag').inputValue()).toBe('SWGR-1A');
    expect(await field(page, 'Description').inputValue()).toBe('Low-voltage switchgear');
    expect(await field(page, 'Location').inputValue()).toBe('Elec Rm 101');
    expect(await field(page, 'System').inputValue()).toBe('Normal power');
    await h.screenshot('asset-panel');

    // From the keyboard: Delete on the grid asks to delete the selected asset (cancel it),
    // and Escape clears the asset selection.
    const grid = page.getByRole('grid', { name: 'Tasks' });
    await grid.focus();
    await page.keyboard.press('Delete');
    const askSwgr = page.getByRole('dialog', { name: 'Delete asset SWGR-1A?' });
    await askSwgr.waitFor();
    await askSwgr.getByRole('button', { name: 'Cancel' }).click();
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0);
    expect((await h.state()).project!.assets[0]!.id).toBe('swgr-1a');
    await grid.focus();
    await page.keyboard.press('Escape');
    await expect.poll(() => groupRow(page, 'swgr-1a').getAttribute('aria-selected')).toBe('false');
    expect(await panel(page).count()).toBe(0);

    // A keyboard user reaches the asset form from a task: Down selects the first task, then
    // the task panel's Edit asset button selects its asset.
    await grid.focus();
    await page.keyboard.press('ArrowDown');
    const editAsset = page.getByRole('complementary', { name: 'Task details' }).getByRole('button', { name: 'Edit asset SWGR-1A' });
    await editAsset.focus();
    await h.screenshot('task-panel-edit-asset');
    await page.keyboard.press('Enter');
    await expect.poll(() => groupRow(page, 'swgr-1a').getAttribute('aria-selected')).toBe('true');
    expect(await field(page, 'Tag').inputValue()).toBe('SWGR-1A');

    // A tag another asset uses (any case) is refused in the form, and nothing is sent.
    const tag = field(page, 'Tag');
    await tag.fill(' xfmr-1a ');
    await tag.press('Enter');
    const err = panel(page).locator('[data-field="asset-tag"] .field-error');
    await expect(err.textContent()).resolves.toBe('Tag "xfmr-1a" is already used');
    expect(await tag.getAttribute('aria-invalid')).toBe('true');
    expect((await h.state()).revision).toBe(before.revision);
    await h.screenshot('asset-panel-tag-error');
    await tag.fill('');
    await tag.press('Enter');
    await expect(err.textContent()).resolves.toBe('An asset needs a tag');

    // Rename to SWGR-1C.
    await tag.fill('SWGR-1C');
    await tag.press('Enter');
    let s = await h.waitState((st) => st.project!.assets[0]!.tag === 'SWGR-1C', 'the new tag');
    expect(s.undoLabel).toBe('Updated asset SWGR-1A: tag');
    await expect.poll(() => groupRow(page, 'swgr-1a').locator('.gantt-tag').textContent()).toBe('SWGR-1C');
    expect(await err.count()).toBe(0);

    // Change the location (commits on blur) and see it on the group row.
    const loc = field(page, 'Location');
    await loc.fill('Elec Rm 105');
    await field(page, 'System').focus();
    s = await h.waitState((st) => st.project!.assets[0]!.location === 'Elec Rm 105', 'the new location');
    await expect.poll(() => groupRow(page, 'swgr-1a').locator('.gantt-asset-detail').textContent()).toBe('Low-voltage switchgear · Elec Rm 105');

    // Delete XFMR-1A from the panel: the dialog names it and its task count.
    await groupRow(page, 'xfmr-1a').locator('.gc-group').click();
    await expect(panel(page).getByRole('heading').textContent()).resolves.toBe('Asset 2 · 5 tasks');
    await panel(page).getByRole('button', { name: 'Delete asset…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete asset XFMR-1A?' });
    await dialog.waitFor();
    const text = await dialog.textContent();
    expect(text).toContain('XFMR-1A (Power transformer · Yard pad 1)');
    expect(text).toContain('with its 5 tasks, and 1 link to tasks of other assets');
    await h.screenshot('asset-delete-dialog');
    const beforeDelete = s;
    await dialog.getByRole('button', { name: 'Delete asset' }).click();
    s = await h.waitState((st) => !st.project!.assets.some((a) => a.id === 'xfmr-1a'), 'the asset deleted');
    expect(s.project!.tasks.some((t) => t.assetId === 'xfmr-1a')).toBe(false);
    const xfmrTasks = new Set(beforeDelete.project!.tasks.filter((t) => t.assetId === 'xfmr-1a').map((t) => t.id));
    expect(s.project!.dependencies.some((d) => xfmrTasks.has(d.predecessorId) || xfmrTasks.has(d.successorId))).toBe(false);
    expect(s.scheduleError).toBeNull();
    expect(Object.keys(s.schedule).some((id) => xfmrTasks.has(id))).toBe(false);
    expect(s.schedule['t4.4']).toBeDefined();
    expect(s.undoLabel).toBe('Removed asset XFMR-1A and 5 tasks');
    await expect.poll(() => groupRow(page, 'xfmr-1a').count()).toBe(0);
    expect(await page.getByRole('dialog').count()).toBe(0);
    // The selection went with the asset.
    await expect(page.getByRole('complementary', { name: 'Task details' }).textContent()).resolves.toContain('Select a task');

    // One Ctrl+Z puts the asset, its tasks and links back.
    await page.getByRole('grid', { name: 'Tasks' }).focus();
    await page.keyboard.press('Control+Z');
    s = await h.waitState((st) => st.project!.assets.some((a) => a.id === 'xfmr-1a'), 'undo of the delete');
    expect(s.project).toEqual(beforeDelete.project);
    expect(s.scheduleError).toBeNull();
    await expect.poll(() => groupRow(page, 'xfmr-1a').count()).toBe(1);
  });

  it('deletes the selected task\'s asset from the Edit menu', async () => {
    h = await openRiverside();
    const { page } = h;
    await page.locator('#gantt-row-t3\\.2 .gc-id').click();
    await page.getByRole('menubar').getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await page.getByRole('menu', { name: 'Edit' }).getByRole('menuitem', { name: 'Delete asset…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete asset UPS-1A?' });
    await dialog.waitFor();
    expect(await dialog.textContent()).toContain('with its 4 tasks, and 1 link to tasks of other assets');
    await dialog.getByRole('button', { name: 'Delete asset' }).click();
    const s = await h.waitState((st) => !st.project!.assets.some((a) => a.id === 'ups-1a'), 'the asset deleted');
    expect(s.scheduleError).toBeNull();
  });
});
