import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Template } from '@cx/core';
import { launchApp, type AppHarness } from './harness.js';

let h: AppHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

/** Data-start/finish of each preview bar, by task key. */
async function previewBars(page: AppHarness['page']): Promise<Record<string, [number, number]>> {
  return page.evaluate(() => {
    const out: Record<string, [number, number]> = {};
    for (const row of document.querySelectorAll<HTMLElement>('.tpl-chart-row')) {
      const bar = row.querySelector<HTMLElement>('.tpl-bar');
      if (bar) out[row.dataset.key!] = [Number(bar.dataset.start), Number(bar.dataset.finish)];
    }
    return out;
  });
}

describe('template editor', () => {
  it('duplicates a starter, edits a duration, saves, and the preview follows', async () => {
    h = await launchApp({ project: 'riverside' });
    const { page } = h;
    await page.getByRole('menubar').getByRole('menuitem', { name: 'Templates', exact: true }).click();
    const editor = page.getByRole('main', { name: 'Template editor' });
    await editor.waitFor();
    await expect.poll(() => page.getByLabel('Template name').inputValue()).toBe('Low-voltage switchgear');
    const summary = page.getByTestId('template-summary');
    expect(await summary.textContent()).toMatch(/^Starter template · 6 tasks · 12 working days · used by 0 assets/);
    await h.screenshot('templates');

    // Duplicate the starter: the copy opens under My templates.
    await editor.getByRole('button', { name: 'Duplicate' }).click();
    await page
      .getByRole('list', { name: 'My templates' })
      .getByRole('button', { name: /Low-voltage switchgear \(copy\)/ })
      .waitFor();
    await expect.poll(() => page.getByLabel('Template name').inputValue()).toBe('Low-voltage switchgear (copy)');
    expect(await summary.textContent()).toMatch(/^My template · 6 tasks · 12 working days/);

    // Edit task 4's duration in the properties panel.
    const table = page.getByRole('grid', { name: 'Template tasks' });
    await table.getByRole('row').filter({ hasText: 'Relay settings & calibration' }).click();
    const props = page.getByRole('region', { name: 'Task properties' });
    await props.getByText('Task 4 · Properties').waitFor();
    await props.getByLabel('Duration (days)').fill('6');
    expect((await previewBars(page)).relay).toEqual([6, 12]);
    expect((await previewBars(page)).func).toEqual([12, 14]);
    expect(await summary.textContent()).toContain('14 working days');
    expect(await summary.textContent()).toContain('Unsaved changes');
    await h.screenshot('templates-edited');

    // Save: the workspace has the new version and the editor is clean again.
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Saved as version 2' }).waitFor();
    expect(await summary.textContent()).not.toContain('Unsaved changes');
    const stored = await page.evaluate(async () => {
      const list = await window.cx.templates.list();
      if (!list.ok) throw new Error(list.message);
      const copy = list.value.find((t) => t.name === 'Low-voltage switchgear (copy)')!;
      const t = await window.cx.templates.get(copy.id);
      if (!t.ok) throw new Error(t.message);
      return t.value;
    });
    expect(stored.version).toBe(2);
    expect(stored.tasks.find((t) => t.key === 'relay')!.durationDays).toBe(6);

    // Leaving the view and coming back keeps the template open with its preview.
    await page.getByRole('menubar').getByRole('menuitem', { name: 'Schedule', exact: true }).click();
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();
    await page.getByRole('menubar').getByRole('menuitem', { name: 'Templates', exact: true }).click();
    await expect.poll(() => page.getByLabel('Template name').inputValue()).toBe('Low-voltage switchgear (copy)');
    expect((await previewBars(page)).relay).toEqual([6, 12]);
  });

  it('edits tasks and checklists, refuses to save a broken template, and asks before dropping changes', async () => {
    h = await launchApp();
    const { page } = h;
    await page.getByRole('main', { name: 'Welcome' }).waitFor();
    await page.getByRole('menubar').getByRole('menuitem', { name: 'Templates', exact: true }).click();
    const editor = page.getByRole('main', { name: 'Template editor' });
    await editor.waitFor();

    await page.getByRole('button', { name: 'New template' }).click();
    await expect.poll(() => page.getByLabel('Template name').inputValue()).toBe('New template');
    await page.getByLabel('Template name').fill('Feeder cable test');
    await editor.getByRole('button', { name: 'Add task' }).click();
    const props = page.getByRole('region', { name: 'Task properties' });
    await props.getByLabel('Task name').fill('Megger feeders');
    await props.getByLabel('Duration (days)').fill('2');
    await props.getByRole('button', { name: 'Add checklist item' }).click();
    await page.keyboard.type('Cable ID matches schedule');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Readings recorded');
    await props.getByRole('button', { name: 'Move checklist item 2 up' }).click();
    await editor.getByRole('button', { name: 'Add task' }).click();
    await props.getByLabel('Task name').fill('Hi-pot');
    await props.getByLabel('Type').selectOption('witness');
    await props.getByLabel('Notice lead (days)').fill('3');
    await props.getByRole('button', { name: 'Add certification' }).click();
    await page.keyboard.type('NETA Level III');

    // A loop: task 1 after task 2 (which follows task 1).
    await page.getByRole('grid', { name: 'Template tasks' }).getByRole('row').filter({ hasText: 'Megger feeders' }).click();
    await props.getByLabel('Predecessor').fill('2');
    await props.getByLabel('Predecessor').press('Enter');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    const problems = page.getByRole('alert', { name: 'Problems to fix before saving' });
    await problems.getByText(/Predecessor loop/).waitFor();
    await h.screenshot('templates-problems');
    // Duplicate would save the draft into the copy, so it stops at the same problems.
    await props.getByLabel('Task name').focus();
    await editor.getByRole('button', { name: 'Duplicate' }).click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Problems to fix before saving');
    expect(await page.getByLabel('Template name').inputValue()).toBe('Feeder cable test');
    await props.getByLabel('Predecessor').fill('');
    await props.getByLabel('Predecessor').press('Enter');
    await problems.waitFor({ state: 'detached' });

    // A bad predecessor is reported next to the field and not applied.
    await props.getByLabel('Predecessor').fill('9');
    await props.getByLabel('Predecessor').press('Enter');
    await props.getByText('There is no task 9').waitFor();
    await props.getByLabel('Predecessor').fill('');
    await props.getByLabel('Predecessor').press('Enter');

    await page.getByRole('region', { name: 'Template details' }).getByRole('button', { name: 'Add stage' }).click();
    await page.keyboard.type('Pulled');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Saved as version 2' }).waitFor();
    const saved = await page.evaluate(async () => {
      const list = await window.cx.templates.list();
      if (!list.ok) throw new Error(list.message);
      const t = await window.cx.templates.get(list.value.find((x) => x.name === 'Feeder cable test')!.id);
      if (!t.ok) throw new Error(t.message);
      return t.value;
    });
    expect(saved.stages).toEqual(['Pulled']);
    expect(saved.tasks.map((t) => [t.name, t.type, t.durationDays, t.predecessors.length])).toEqual([
      ['Megger feeders', 'task', 2, 0],
      ['Hi-pot', 'witness', 1, 1],
    ]);
    expect(saved.tasks[0]!.checklist.map((c) => c.text)).toEqual(['Readings recorded', 'Cable ID matches schedule']);
    expect(saved.tasks[1]).toMatchObject({ noticeLeadDays: 3, requiredCerts: ['NETA Level III'] });

    // Reorder and remove rows, then try to leave: the editor asks first.
    await page.getByRole('button', { name: 'Move task 2 up' }).click();
    await expect.poll(() => page.getByRole('grid', { name: 'Template tasks' }).getByRole('row').nth(1).textContent()).toContain('Hi-pot');
    await page.getByRole('button', { name: 'Remove task 2' }).click();
    await expect.poll(() => page.getByRole('grid', { name: 'Template tasks' }).getByRole('row').count()).toBe(2);
    await page
      .getByRole('list', { name: 'Starter templates' })
      .getByRole('button', { name: /Power transformer/ })
      .click();
    const ask = page.getByRole('dialog', { name: 'Unsaved changes' });
    await ask.waitFor();
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect.poll(() => page.getByLabel('Template name').inputValue()).toBe('Feeder cable test');
    await page
      .getByRole('list', { name: 'Starter templates' })
      .getByRole('button', { name: /Power transformer/ })
      .click();
    await ask.getByRole('button', { name: 'Discard changes' }).click();
    await expect.poll(() => page.getByLabel('Template name').inputValue()).toBe('Power transformer');
  });

  it('exports and imports a template file', async () => {
    h = await launchApp();
    const { page } = h;
    await page.getByRole('main', { name: 'Welcome' }).waitFor();
    await page.getByRole('menubar').getByRole('menuitem', { name: 'Templates', exact: true }).click();
    const editor = page.getByRole('main', { name: 'Template editor' });
    await editor.waitFor();
    const file = join(h.dir, 'lv.json');
    await h.answerSave(file);
    await editor.getByRole('button', { name: 'Export template file' }).click();
    await page.getByRole('status').filter({ hasText: 'Exported to' }).waitFor();
    const json = JSON.parse(readFileSync(file, 'utf8')) as { template: Template };
    expect(json.template.name).toBe('Low-voltage switchgear');

    await h.answerOpen(file);
    await page.getByRole('button', { name: 'Import template file…' }).click();
    await page.getByRole('status').filter({ hasText: 'Imported Low-voltage switchgear as a new template' }).waitFor();
    await page
      .getByRole('list', { name: 'My templates' })
      .getByRole('button', { name: /Low-voltage switchgear/ })
      .waitFor();
    expect(await page.getByTestId('template-summary').textContent()).toMatch(/^My template · 6 tasks/);
  });

  it('re-applies a saved change to existing assets as one undoable step', async () => {
    h = await launchApp({ project: 'riverside' });
    const { page } = h;
    // Two assets made from the low-voltage starter.
    await page.evaluate(async () => {
      const t = await window.cx.templates.get('starter-lv-switchgear');
      if (!t.ok) throw new Error(t.message);
      const r = await window.cx.apply({
        kind: 'addAssetsFromTemplate',
        template: t.value,
        assets: [
          { id: 'lv-a', tag: 'SWGR-7A', description: 'Lineup A' },
          { id: 'lv-b', tag: 'SWGR-7B', description: 'Lineup B' },
        ],
      });
      if (!r.ok) throw new Error(r.message);
    });
    await page.getByRole('menubar').getByRole('menuitem', { name: 'Templates', exact: true }).click();
    const editor = page.getByRole('main', { name: 'Template editor' });
    await editor.waitFor();
    expect(await page.getByTestId('template-summary').textContent()).toContain('used by 2 assets');
    expect(await page.getByTestId('reapply-note').textContent()).toContain('Two existing assets use this template.');

    await page.getByRole('grid', { name: 'Template tasks' }).getByRole('row').filter({ hasText: 'Torque verification' }).click();
    await page.getByRole('region', { name: 'Task properties' }).getByLabel('Duration (days)').fill('3');
    const reapply = page.getByRole('button', { name: 'Re-apply to existing assets…' });
    expect(await reapply.isDisabled()).toBe(true);
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Saved as version' }).waitFor();
    await h.screenshot('templates-before-reapply');
    await reapply.click();

    const dialog = page.getByRole('dialog', { name: 'Re-apply template to existing assets' });
    await dialog.waitFor();
    const assets = dialog.getByRole('list', { name: 'Affected assets' });
    expect(await assets.textContent()).toContain('SWGR-7A');
    expect(await assets.textContent()).toContain('Updates Torque verification: duration 2 d → 3 d');
    await h.screenshot('templates-reapply-dialog');
    await dialog.getByRole('button', { name: 'Re-apply to 2 assets' }).click();
    await dialog.waitFor({ state: 'detached' });

    const torque = (s: Awaited<ReturnType<AppHarness['state']>>) =>
      s.project!.tasks.filter((t) => t.templateKey === 'torque').map((t) => t.durationDays);
    let s = await h.waitState((x) => torque(x).every((d) => d === 3), 're-applied durations');
    expect(torque(s)).toEqual([3, 3]);
    expect(s.undoLabel).toMatch(/Re-appl/i);
    await page.evaluate(() => window.cx.undo());
    s = await h.waitState((x) => torque(x).every((d) => d === 2), 'undone re-apply');
    expect(s.project!.assets.filter((a) => a.id.startsWith('lv-')).map((a) => a.templateVersion)).toEqual([1, 1]);
  });

  it('undoes template edits with Ctrl+Z, pins the re-apply note, and asks before the window closes', async () => {
    h = await launchApp({ project: 'riverside' });
    const { page, app } = h;
    const before = await h.state();
    await page.getByRole('menubar').getByRole('menuitem', { name: 'Templates', exact: true }).click();
    const editor = page.getByRole('main', { name: 'Template editor' });
    await editor.waitFor();
    await expect.poll(() => page.getByLabel('Template name').inputValue()).toBe('Low-voltage switchgear');

    // The status bar describes the library, and the note stays in view below the properties.
    await expect.poll(() => page.getByTestId('statusbar').textContent()).toMatch(/^Library: \d+ starters · 0 custom/);
    expect(await page.getByTestId('statusbar').textContent()).toContain('Export to share');
    const note = await page.getByTestId('reapply-note').boundingBox();
    const bar = await page.getByTestId('statusbar').boundingBox();
    expect(note!.y + note!.height).toBeLessThanOrEqual(bar!.y);
    await h.screenshot('templates-note-pinned');

    // Delete a row from the keyboard, then Ctrl+Z puts it back (the project is untouched).
    const grid = page.getByRole('grid', { name: 'Template tasks' });
    const rows = () => grid.getByRole('row').count();
    const count = await rows();
    const relay = grid.getByRole('row').filter({ hasText: 'Relay settings & calibration' });
    await relay.click();
    expect(await relay.getAttribute('aria-selected')).toBe('true');
    await relay.press('Delete');
    await expect.poll(rows).toBe(count - 1);
    await page.getByRole('status').filter({ hasText: 'Removed task 4 "Relay settings & calibration"' }).waitFor();
    await page.keyboard.press('Control+z');
    await expect.poll(rows).toBe(count);
    await page.keyboard.press('Control+y');
    await expect.poll(rows).toBe(count - 1);
    await page.keyboard.press('Control+z');
    await expect.poll(rows).toBe(count);
    expect(await editor.getByRole('button', { name: 'Save', exact: true }).isDisabled()).toBe(true);
    const after = await h.state();
    expect([after.revision, after.undoLabel]).toEqual([before.revision, before.undoLabel]);

    // Typing a predecessor applies it at once, so Save is ready without leaving the field.
    await grid.getByRole('row').filter({ hasText: 'Functional' }).click();
    const props = page.getByRole('region', { name: 'Task properties' });
    await props.getByLabel('Predecessor').fill('1');
    expect(await editor.getByRole('button', { name: 'Save', exact: true }).isDisabled()).toBe(false);
    expect(await props.getByLabel('Predecessor').inputValue()).toBe('1');

    // Closing the window asks first; Cancel keeps it open.
    const closeWindow = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    await closeWindow();
    const ask = page.getByRole('dialog', { name: 'Unsaved changes' });
    await ask.getByText(/close the window/).waitFor();
    await h.screenshot('templates-close-prompt');
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await ask.waitFor({ state: 'detached' });
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

    // From another view too: the editor comes back to ask. Discard closes the window.
    await page.getByRole('menubar').getByRole('menuitem', { name: 'Schedule', exact: true }).click();
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();
    await closeWindow();
    await ask.waitFor();
    expect(await page.getByLabel('Template name').inputValue()).toBe('Low-voltage switchgear');
    const closed = app.waitForEvent('close');
    await ask.getByRole('button', { name: 'Discard changes' }).click();
    await closed;
  });
});

