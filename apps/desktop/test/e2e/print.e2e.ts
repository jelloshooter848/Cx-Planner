import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
    await page.keyboard.press('Control+p');
    await dialog.waitFor();
    await dialog.getByRole('radio', { name: 'Test sheets' }).click();
    const tasks = dialog.getByRole('list', { name: 'Tasks with checklists' });
    await tasks.waitFor();
    await expect.poll(() => rev.textContent()).toBe('A');
    await dialog.getByRole('button', { name: 'Clear' }).click();
    const boxes = tasks.locator('ul input[type="checkbox"]');
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await expect.poll(() => count.textContent()).toMatch(/· 8\.5 × 11 in$/);
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

    // Full schedule from the Schedule toolbar.
    await dialog.getByRole('radio', { name: 'Full schedule' }).click();
    await expect.poll(() => count.textContent()).toMatch(/· 34 × 22 in$/);
    await h.screenshot('print-dialog-full-schedule');
  });
});
