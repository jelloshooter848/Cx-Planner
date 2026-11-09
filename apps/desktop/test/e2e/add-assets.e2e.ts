import { afterEach, describe, expect, it } from 'vitest';
import { ProjectStore } from '@cx/storage';
import { launchApp, type AppHarness } from './harness.js';

let h: AppHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

describe('add assets from a template', () => {
  it('adds 3 panelboards from a tag pattern as 12 tasks, flags duplicate tags, and undoes in one step', async () => {
    h = await launchApp({ project: 'riverside' });
    const { page } = h;
    await page.getByRole('table', { name: 'Tasks' }).waitFor();
    const before = await h.state();
    const assetsBefore = before.project!.assets.length;
    const tasksBefore = before.project!.tasks.length;

    await page.getByRole('menubar').getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await page.getByRole('menu', { name: 'Edit' }).getByRole('menuitem', { name: 'Add assets from template…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add assets from a template' });
    await dialog.waitFor();

    const picker = dialog.getByRole('combobox', { name: 'Template' });
    await expect.poll(() => picker.locator('option').count()).toBeGreaterThan(1);
    const option = picker.locator('option', { hasText: 'Panelboard' });
    expect(await option.textContent()).toMatch(/^Panelboard \/ distribution — 4 tasks · \d+ d$/);
    await picker.selectOption({ label: (await option.textContent())! });
    await dialog.getByRole('complementary', { name: 'Tasks per asset' }).getByText('Circuit directory & labelling').waitFor();

    await dialog.getByLabel('Tag or pattern').fill('PNL-E2E-1..3');
    await dialog.getByLabel('Location', { exact: true }).fill('Elec Rm 204');
    await dialog.getByRole('button', { name: 'Add rows' }).click();
    const rows = dialog.getByRole('table', { name: 'Assets to add' }).locator('tbody tr');
    await expect.poll(() => rows.count()).toBe(3);
    expect(await dialog.getByLabel('Tag, row 3').inputValue()).toBe('PNL-E2E-3');
    expect(await dialog.getByLabel('Location, row 2').inputValue()).toBe('Elec Rm 204');
    await dialog.getByLabel('Each follows the previous asset').check();
    const summary = dialog.getByTestId('add-assets-summary');
    await expect.poll(() => summary.textContent()).toMatch(/^3 assets · 12 tasks · finish \w{3} \d{1,2}, \d{4}$/);
    await h.screenshot('add-assets-dialog');

    // A tag already in the project is flagged and blocks the add.
    const existing = before.project!.assets[0]!.tag;
    await dialog.getByRole('button', { name: '+ Add row' }).click();
    await dialog.getByLabel('Tag, row 4').fill(existing);
    await dialog.getByRole('list', { name: 'Tag problems' }).getByText(`${existing} is already in the project`).waitFor();
    expect(await dialog.getByRole('button', { name: 'Add 4 assets' }).isDisabled()).toBe(true);
    await h.screenshot('add-assets-duplicate');
    await dialog.getByRole('button', { name: 'Remove row 4' }).click();

    await dialog.getByRole('button', { name: 'Add 3 assets' }).click();
    await dialog.waitFor({ state: 'detached' });
    const after = await h.waitState((s) => s.project!.tasks.length === tasksBefore + 12, '12 new tasks');
    expect(after.project!.assets.slice(assetsBefore).map((a) => [a.tag, a.location])).toEqual([
      ['PNL-E2E-1', 'Elec Rm 204'],
      ['PNL-E2E-2', 'Elec Rm 204'],
      ['PNL-E2E-3', 'Elec Rm 204'],
    ]);
    const table = page.getByRole('table', { name: 'Tasks' });
    await table.getByText('PNL-E2E-3', { exact: true }).waitFor();
    expect(await table.getByText('Circuit directory & labelling').count()).toBeGreaterThanOrEqual(3);
    await h.screenshot('add-assets-done');

    // One undo takes the whole add back.
    expect(after.undoLabel).toBe('Added 3 assets from Panelboard / distribution: PNL-E2E-1, PNL-E2E-2, PNL-E2E-3');
    await page.keyboard.press('Control+z');
    await h.waitState((s) => s.project!.tasks.length === tasksBefore, 'the add to be undone');

    // The template snapshot was stored in the project file.
    await h.app.close();
    const store = ProjectStore.open(h.projectFile!, { backup: false });
    try {
      expect(store.getTemplateSnapshots().map((t) => t.id)).toContain('starter-panelboard');
    } finally {
      store.close();
    }
  });
});
