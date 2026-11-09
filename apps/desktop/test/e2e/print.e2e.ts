import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkCalendar } from '@cx/core';
import { lookAheadWindow } from '@cx/render';
import { longDate } from '../../src/renderer/format.js';
import { launchApp, type AppHarness } from './harness.js';

let h: AppHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

/** Pages in a PDF written by Chromium (same count as the M0 spike). */
const pdfPages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
/** The first page's MediaBox in points, e.g. [0, 0, 792, 612] for Letter landscape. */
const mediaBox = (pdf: Buffer) => /\/MediaBox\s*\[([^\]]+)\]/.exec(pdf.toString('latin1'))?.[1]?.trim().split(/\s+/).map(Number);

describe('print / export PDF', () => {
  it('exports revisioned look-ahead PDFs and test sheets', async () => {
    h = await launchApp({ project: 'riverside' });
    const { page } = h;
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();

    await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menu', { name: 'File' }).getByRole('menuitem', { name: 'Print / Export PDF…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Print / Export PDF' });
    await dialog.waitFor();
    const rev = dialog.getByTestId('print-revision');
    const count = dialog.getByTestId('print-sheet-count');
    await expect.poll(() => rev.textContent()).toBe('A');
    expect(await dialog.getByRole('radio', { name: 'Look-ahead' }).getAttribute('aria-checked')).toBe('true');

    await dialog.getByLabel('Letter (11 × 8.5 in)').check();
    await dialog.getByLabel('Note for this revision').fill('Issued for coordination');
    await expect.poll(() => count.textContent()).toMatch(/^\d+ sheets? · 11 × 8\.5 in$/);
    // The preview iframe shows the sheet, with the note in its revision history.
    const frame = dialog.locator('iframe').contentFrame();
    await expect.poll(() => frame.locator('body').textContent()).toContain('Issued for coordination');
    await h.screenshot('print-dialog-lookahead');

    const first = join(h.dir, 'Look-ahead A.pdf');
    await h.answerSave(first);
    await dialog.getByRole('button', { name: 'Export PDF (Rev A)' }).click();
    await dialog.getByRole('status').getByText(`Saved Rev A: ${first}`).waitFor();
    await dialog.getByRole('button', { name: 'Open folder' }).waitFor();
    const sheetsA = Number(/^(\d+)/.exec((await count.textContent())!)![1]);
    expect(existsSync(first)).toBe(true);
    const pdfA = readFileSync(first);
    expect(pdfPages(pdfA)).toBe(sheetsA);
    expect(mediaBox(pdfA)).toEqual([0, 0, 792, 612]);

    // The revision moves on to B, and A is listed with its note.
    await expect.poll(() => rev.textContent()).toBe('B');
    await dialog.getByRole('list', { name: 'Earlier revisions' }).getByText(/Issued for coordination/).waitFor();
    await dialog.getByLabel('Tabloid (17 × 11 in)').check();
    await dialog.getByLabel('Note for this revision').fill('Progress update');
    await expect.poll(() => count.textContent()).toMatch(/· 17 × 11 in$/);
    const second = join(h.dir, 'Look-ahead B.pdf');
    await h.answerSave(second);
    await dialog.getByRole('button', { name: 'Export PDF (Rev B)' }).click();
    await dialog.getByRole('status').getByText(`Saved Rev B: ${second}`).waitFor();
    const pdfB = readFileSync(second);
    expect(pdfPages(pdfB)).toBe(Number(/^(\d+)/.exec((await count.textContent())!)![1]));
    expect(mediaBox(pdfB)).toEqual([0, 0, 1224, 792]);
    await expect.poll(() => rev.textContent()).toBe('C');

    const setup = await page.evaluate(() => window.cx.print.setup());
    if (!setup.ok) throw new Error(setup.message);
    expect(setup.value.history.map((p) => [p.kind, p.rev, p.paper, p.note])).toEqual([
      ['lookahead', 'A', 'letter', 'Issued for coordination'],
      ['lookahead', 'B', 'tabloid', 'Progress update'],
    ]);
    expect(setup.value.nextRevision).toMatchObject({ lookahead: 'C', 'test-sheets': 'A' });
    await dialog.getByRole('button', { name: 'Close' }).click();
    await dialog.waitFor({ state: 'detached' });

    // Test sheets: add a switchgear lineup from a starter template (its tasks have checklists).
    const added = await page.evaluate(async () => {
      const t = await window.cx.templates.get('starter-lv-switchgear');
      if (!t.ok) return t;
      return window.cx.apply({ kind: 'addAssetsFromTemplate', template: t.value, assets: [{ tag: 'SWGR-E2E', description: 'Switchgear' }] });
    });
    expect(added.ok).toBe(true);
    // Its first task is done and its last test (before the closing milestone) is held to start
    // after the 3-week look-ahead window.
    const swgrTasks = await page.evaluate(async () => {
      const st = await window.cx.getState();
      const asset = st.project!.assets.find((x) => x.tag === 'SWGR-E2E')!;
      return st.project!.tasks.filter((t) => t.assetId === asset.id && t.type !== 'milestone').map((t) => t.id);
    });
    const patched = await page.evaluate(
      ([first, last]) =>
        window.cx.apply({
          kind: 'batch',
          commands: [
            { kind: 'updateTask', id: first!, patch: { percentComplete: 100, actualStart: '2026-11-02', actualFinish: '2026-11-03' } },
            { kind: 'updateTask', id: last!, patch: { startNoEarlierThan: '2026-12-07' } },
          ],
        }),
      [swgrTasks[0], swgrTasks[swgrTasks.length - 1]],
    );
    expect(patched.ok).toBe(true);
    await page.keyboard.press('Control+p');
    await dialog.waitFor();
    await dialog.getByRole('radio', { name: 'Test sheets' }).click();
    const tasks = dialog.getByRole('list', { name: 'Tasks with checklists' });
    await tasks.waitFor();
    await expect.poll(() => rev.textContent()).toBe('A');

    // It opens with the incomplete tasks that start in the 3-week look-ahead window ticked.
    const state = await page.evaluate(() => window.cx.getState());
    const sheetSetup = await page.evaluate(() => window.cx.print.setup());
    if (!sheetSetup.ok) throw new Error(sheetSetup.message);
    const project = state.project!;
    const lookAhead = lookAheadWindow(project.dataDate, 3, new WorkCalendar(project.startDate, project.calendar));
    const checklistIds = sheetSetup.value.checklistTasks.map((t) => t.taskId);
    const taskOf = (id: string) => project.tasks.find((t) => t.id === id)!;
    const open = checklistIds.filter((id) => taskOf(id).percentComplete < 100 && !taskOf(id).actualFinish);
    const inWindow = open.filter((id) => {
      const start = state.schedule[id]!.start;
      return start >= lookAhead.start && start <= lookAhead.end;
    });
    const total = checklistIds.length;
    expect(inWindow.length).toBeGreaterThan(0);
    expect(inWindow.length).toBeLessThan(open.length);
    expect(open.length).toBeLessThan(total);
    const ticked = () => tasks.locator('ul input[type="checkbox"]:checked').count();
    const pickCount = dialog.getByTestId('test-sheet-count');
    const counted = (n: number) => `${n} of ${total} tasks`;
    await expect.poll(() => pickCount.textContent()).toBe(counted(inWindow.length));
    expect(await ticked()).toBe(inWindow.length);
    // Each task shows its scheduled dates.
    const firstDates = state.schedule[checklistIds[0]!]!;
    expect(await tasks.locator('.pd-dates').first().textContent()).toContain(longDate(firstDates.start).replace(/, \d{4}$/, ''));

    // Quick selections replace the selection.
    const quick = dialog.getByRole('group', { name: 'Quick select' });
    expect(await quick.getByRole('button', { name: 'Current asset filter' }).isDisabled()).toBe(true);
    await quick.getByRole('button', { name: 'All' }).click();
    await expect.poll(() => pickCount.textContent()).toBe(counted(total));
    await quick.getByRole('button', { name: 'Not complete' }).click();
    await expect.poll(() => pickCount.textContent()).toBe(counted(open.length));
    await quick.getByRole('button', { name: 'Clear' }).click();
    await expect.poll(() => pickCount.textContent()).toBe(counted(0));
    await quick.getByRole('button', { name: 'In look-ahead window' }).click();
    await expect.poll(() => pickCount.textContent()).toBe(counted(inWindow.length));
    await expect.poll(() => count.textContent()).toMatch(/· 8\.5 × 11 in$/);
    await dialog.getByText('Updating…').waitFor({ state: 'hidden' });
    await h.screenshot('print-dialog-test-sheet-picker');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await dialog.waitFor({ state: 'detached' });

    // With the asset filter set to the new switchgear, "Current asset filter" picks its tasks.
    const sidebar = page.getByRole('complementary', { name: 'Assets in view' });
    for (const box of await sidebar.getByRole('checkbox', { name: /^(?!Show all |SWGR-E2E,)/ }).all()) await box.uncheck();
    const e2eAsset = project.assets.find((a) => a.tag === 'SWGR-E2E')!.id;
    await page.keyboard.press('Control+p');
    await dialog.waitFor();
    await tasks.waitFor();
    await quick.getByRole('button', { name: 'Current asset filter' }).click();
    const onAsset = checklistIds.filter((id) => taskOf(id).assetId === e2eAsset);
    await expect.poll(() => pickCount.textContent()).toBe(counted(onAsset.length));
    // Asset group checkboxes still tick and untick a whole asset.
    await tasks.getByRole('checkbox', { name: /^SWGR-E2E/ }).uncheck();
    await expect.poll(() => pickCount.textContent()).toBe(counted(0));
    await tasks.getByRole('checkbox', { name: /^SWGR-E2E/ }).check();
    await expect.poll(() => pickCount.textContent()).toBe(counted(onAsset.length));

    await quick.getByRole('button', { name: 'Clear' }).click();
    const boxes = tasks.locator('ul input[type="checkbox"]');
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await expect.poll(() => count.textContent()).toMatch(/· 8\.5 × 11 in$/);
    await dialog.getByText('Updating…').waitFor({ state: 'hidden' });
    // Each sheet's header carries its own revision; the print's own revision is labelled as such.
    expect(await dialog.locator('.pd-rev dt').first().textContent()).toBe('Print revision');
    await dialog.getByTestId('sheet-revision-note').waitFor();
    const sheetFrame = dialog.locator('iframe').contentFrame();
    const sheetRevs = async () =>
      Object.fromEntries([...((await sheetFrame.locator('body').textContent()) ?? '').matchAll(/Sheet (\S+) · Rev ([A-Z])/g)].map((m) => [m[1]!, m[2]!]));
    const firstIssue = await sheetRevs();
    expect(Object.keys(firstIssue)).toHaveLength(2);
    expect(Object.values(firstIssue)).toEqual(['A', 'A']);
    const sheetsT = Number(/^(\d+)/.exec((await count.textContent())!)![1]);
    expect(sheetsT).toBeGreaterThanOrEqual(2);
    await dialog.getByRole('button', { name: 'Next sheet' }).click();
    await dialog.getByText(`Sheet 2 of ${sheetsT}`).waitFor();
    await h.screenshot('print-dialog-test-sheets');
    const sheetsPdf = join(h.dir, 'Test sheets.pdf');
    await h.answerSave(sheetsPdf);
    await dialog.getByRole('button', { name: 'Export PDF (Rev A)' }).click();
    await dialog.getByRole('status').getByText(`Saved Rev A: ${sheetsPdf}`).waitFor();
    const pdfT = readFileSync(sheetsPdf);
    expect(pdfPages(pdfT)).toBe(sheetsT);
    expect(mediaBox(pdfT)).toEqual([0, 0, 612, 792]);

    // Print the second task again with a third: the print is Rev B, the re-issued sheet Rev B
    // and the third task's sheet its first issue, Rev A.
    await expect.poll(() => rev.textContent()).toBe('B');
    await boxes.nth(0).uncheck();
    await boxes.nth(2).check();
    const showsNewSheet = async () => {
      const ids = Object.keys(await sheetRevs());
      return ids.length === 2 && ids.some((id) => !(id in firstIssue));
    };
    await expect.poll(showsNewSheet).toBe(true);
    await dialog.getByText('Updating…').waitFor({ state: 'hidden' });
    const secondIssue = await sheetRevs();
    for (const [id, r] of Object.entries(secondIssue)) expect([id, r]).toEqual([id, id in firstIssue ? 'B' : 'A']);
    await h.screenshot('print-dialog-test-sheets-rev');

    // Arrow keys move between kinds (a radio group with one Tab stop).
    const kindRadio = (name: string) => dialog.getByRole('radio', { name });
    await kindRadio('Test sheets').focus();
    await page.keyboard.press('ArrowLeft');
    expect(await kindRadio('Full schedule').getAttribute('aria-checked')).toBe('true');
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toBe('Full schedule');
    expect(await kindRadio('Look-ahead').getAttribute('tabindex')).toBe('-1');
    expect(await kindRadio('Full schedule').getAttribute('tabindex')).toBe('0');
    await expect.poll(() => count.textContent()).toMatch(/· 34 × 22 in$/);
    await h.screenshot('print-dialog-full-schedule');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await dialog.waitFor({ state: 'detached' });

    // The Schedule toolbar's Print / Export PDF opens on the last kind used.
    await page.getByRole('toolbar', { name: 'Schedule tools' }).getByRole('button', { name: 'Print / Export PDF' }).click();
    await dialog.waitFor();
    expect(await kindRadio('Full schedule').getAttribute('aria-checked')).toBe('true');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await dialog.waitFor({ state: 'detached' });

    // The look-ahead report's Print / Export PDF… opens on the look-ahead.
    const bar = page.getByRole('menubar');
    await bar.getByRole('menuitem', { name: 'Reports', exact: true }).click();
    await page.getByRole('menu', { name: 'Reports' }).getByRole('menuitemcheckbox', { name: '3-week look-ahead' }).click();
    await page.getByRole('button', { name: 'Print / Export PDF…' }).click();
    await dialog.waitFor();
    expect(await kindRadio('Look-ahead').getAttribute('aria-checked')).toBe('true');
    await expect.poll(() => rev.textContent()).toBe('C');
  });

  it('prints acceptance criteria entered in the template editor on the test sheet', async () => {
    h = await launchApp({ project: 'riverside' });
    const { page } = h;
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();

    // Duplicate the switchgear starter and give a checklist item acceptance criteria.
    await page.getByRole('menubar').getByRole('menuitem', { name: 'Templates', exact: true }).click();
    const editor = page.getByRole('main', { name: 'Template editor' });
    await editor.waitFor();
    await expect.poll(() => page.getByLabel('Template name').inputValue()).toBe('Low-voltage switchgear');
    await editor.getByRole('button', { name: 'Duplicate' }).click();
    await expect.poll(() => page.getByLabel('Template name').inputValue()).toBe('Low-voltage switchgear (copy)');
    await page.getByRole('grid', { name: 'Template tasks' }).getByRole('row').filter({ hasText: 'Insulation resistance test' }).click();
    const props = page.getByRole('region', { name: 'Task properties' });
    // The starter already has criteria on item 1; item 3 has none yet.
    expect(await props.getByLabel('Acceptance 1', { exact: true }).inputValue()).toBe('Per project spec / NETA ATS');
    const acc = props.getByLabel('Acceptance 3', { exact: true });
    expect(await acc.getAttribute('placeholder')).toBe('Acceptance (optional)');
    await acc.fill('≥ 100 MΩ at 1000 V DC');
    await h.screenshot('templates-acceptance');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Saved as version 2' }).waitFor();

    // Add an asset from the saved template.
    const added = await page.evaluate(async () => {
      const list = await window.cx.templates.list();
      if (!list.ok) return list;
      const t = await window.cx.templates.get(list.value.find((x) => x.name === 'Low-voltage switchgear (copy)')!.id);
      if (!t.ok) return t;
      return window.cx.apply({ kind: 'addAssetsFromTemplate', template: t.value, assets: [{ tag: 'SWGR-ACC', description: 'Switchgear' }] });
    });
    expect(added.ok).toBe(true);
    await page.getByRole('menubar').getByRole('menuitem', { name: 'Schedule', exact: true }).click();
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();

    // Test sheet for its insulation resistance task: the Acceptance column shows both values.
    await page.keyboard.press('Control+p');
    const dialog = page.getByRole('dialog', { name: 'Print / Export PDF' });
    await dialog.waitFor();
    await dialog.getByRole('radio', { name: 'Test sheets' }).click();
    const tasks = dialog.getByRole('list', { name: 'Tasks with checklists' });
    await tasks.waitFor();
    await dialog.getByRole('button', { name: 'Clear' }).click();
    await tasks.locator(':scope > li').filter({ hasText: 'SWGR-ACC' }).getByRole('checkbox', { name: /Insulation resistance test/ }).check();
    await expect.poll(() => dialog.getByTestId('print-sheet-count').textContent()).toMatch(/^1 sheet · 8\.5 × 11 in$/);
    const frame = dialog.locator('iframe').contentFrame();
    // Long values wrap onto several lines (tspans), so compare without spaces.
    const squash = (s: string | null) => (s ?? '').replace(/\s+/g, '');
    await expect.poll(async () => squash(await frame.locator('body').textContent())).toContain(squash('≥ 100 MΩ at 1000 V DC'));
    const text = squash(await frame.locator('body').textContent());
    expect(text).toContain('#CheckAcceptanceResult');
    expect(text).toContain('SWGR-ACC');
    expect(text).toContain(squash('Per project spec / NETA ATS'));
    await h.screenshot('print-test-sheet-acceptance');

    const pdf = join(h.dir, 'IR sheet.pdf');
    await h.answerSave(pdf);
    await dialog.getByRole('button', { name: 'Export PDF (Rev A)' }).click();
    await dialog.getByRole('status').getByText(`Saved Rev A: ${pdf}`).waitFor();
    expect(pdfPages(readFileSync(pdf))).toBe(1);
  });
});
