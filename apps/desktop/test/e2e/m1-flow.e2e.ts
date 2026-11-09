/**
 * The M1 "done when" story, end to end in the real app: set up a job from nothing, keep its
 * schedule, and hand the field a revisioned look-ahead and blank test sheets. The PDFs are
 * copied to spike-output/desktop-e2e/m1-flow/ (or $CX_E2E_SHOTS/m1-flow) for CI artifacts.
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';
import type { Task } from '@cx/core';
import type { AppState } from '../../src/shared/api.js';
import { launchApp, type AppHarness } from './harness.js';

let h: AppHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(resolve(process.env.CX_E2E_SHOTS ?? join(desktop, '../../spike-output/desktop-e2e')), 'm1-flow');

const pdfPages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
const mediaBox = (pdf: Buffer) => /\/MediaBox\s*\[([^\]]+)\]/.exec(pdf.toString('latin1'))?.[1]?.trim().split(/\s+/).map(Number);
const sheetCount = async (page: Page) => Number(/^(\d+)/.exec((await page.getByTestId('print-sheet-count').textContent()) ?? '')?.[1]);

const panel = (page: Page) => page.getByRole('complementary', { name: 'Task details' });
const field = (page: Page, label: string) => panel(page).getByLabel(label, { exact: true });
const row = (page: Page, id: string) => page.locator(`[id="gantt-row-${id}"]`);
const taskOf = (s: AppState, id: string): Task => s.project!.tasks.find((t) => t.id === id)!;
const tagOf = (s: AppState, task: Task) => s.project!.assets.find((a) => a.id === task.assetId)?.tag;
/** The task of asset `tag` named `name`. */
const findTask = (s: AppState, tag: string, name: string): Task => {
  const t = s.project!.tasks.find((x) => x.name === name && tagOf(s, x) === tag);
  if (!t) throw new Error(`No task "${name}" on ${tag}`);
  return t;
};

async function menu(page: Page, top: string, item: string) {
  await page.getByRole('menubar').getByRole('menuitem', { name: top, exact: true }).click();
  await page.getByRole('menu', { name: top }).getByRole('menuitem', { name: item }).click();
}

async function addAssets(h: AppHarness, template: string, pattern: string, count: number, shot?: string) {
  const { page } = h;
  await menu(page, 'Edit', 'Add assets from template…');
  const dialog = page.getByRole('dialog', { name: 'Add assets from a template' });
  await dialog.waitFor();
  const picker = dialog.getByRole('combobox', { name: 'Template' });
  await expect.poll(() => picker.locator('option').count()).toBeGreaterThan(1);
  const label = await picker.locator('option', { hasText: template }).textContent();
  await picker.selectOption({ label: label! });
  await dialog.getByLabel('Tag or pattern').fill(pattern);
  await dialog.getByLabel('Location', { exact: true }).fill('Elec Rm 101');
  await dialog.getByRole('button', { name: 'Add rows' }).click();
  await expect.poll(() => dialog.getByRole('table', { name: 'Assets to add' }).locator('tbody tr').count()).toBe(count);
  if (shot) await h.screenshot(shot);
  await dialog.getByRole('button', { name: count === 1 ? 'Add 1 asset' : `Add ${count} assets` }).click();
  await dialog.waitFor({ state: 'detached' });
}

async function exportPdf(h: AppHarness, kind: 'Look-ahead' | 'Test sheets', rev: string, file: string, setup: (dialog: ReturnType<Page['getByRole']>) => Promise<void>, shot?: string) {
  const { page } = h;
  await menu(page, 'File', 'Print / Export PDF…');
  const dialog = page.getByRole('dialog', { name: 'Print / Export PDF' });
  await dialog.waitFor();
  await dialog.getByRole('radio', { name: kind }).click();
  await expect.poll(() => dialog.getByTestId('print-revision').textContent()).toBe(rev);
  await setup(dialog);
  if (shot) await h.screenshot(shot);
  await h.answerSave(file);
  await dialog.getByRole('button', { name: `Export PDF (Rev ${rev})` }).click();
  await dialog.getByRole('status').getByText(`Saved Rev ${rev}: ${file}`).waitFor();
  const sheets = await sheetCount(page);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await dialog.waitFor({ state: 'detached' });
  const pdf = readFileSync(file);
  expect(pdfPages(pdf)).toBe(sheets);
  mkdirSync(outDir, { recursive: true });
  copyFileSync(file, join(outDir, file.split(/[\\/]/).pop()!));
  return pdf;
}

describe('M1 end to end', () => {
  it('sets up a job, keeps its schedule, and issues a revisioned look-ahead and test sheets', async () => {
    h = await launchApp();
    const { page } = h;

    // 1. No project: the welcome screen. New project…
    await page.getByRole('main', { name: 'Welcome' }).waitFor();
    const file = join(h.workspace, 'Harbor Point Substation.cxp');
    await h.answerSave(file);
    await page.getByRole('button', { name: 'New project…' }).click();
    const newDialog = page.getByRole('dialog', { name: 'New project' });
    await newDialog.getByLabel('Project name').fill('Harbor Point Substation');
    await newDialog.getByLabel('Start date').fill('2026-11-02');
    await newDialog.getByRole('button', { name: 'Create…' }).click();
    await h.waitState((s) => s.fileName === 'Harbor Point Substation.cxp', 'the new project');
    await page.getByText('No assets yet').waitFor();

    // 2. Two LV switchgear lineups and one transformer from the starter templates.
    await addAssets(h, 'Low-voltage switchgear', 'SWGR-1..2', 2, 'm1-add-assets');
    await addAssets(h, 'Power transformer', 'XFMR-1', 1);
    let s = await h.waitState((x) => x.project!.assets.length === 3, 'three assets');
    expect(s.project!.assets.map((a) => a.tag)).toEqual(['SWGR-1', 'SWGR-2', 'XFMR-1']);
    expect(s.project!.tasks.length).toBe(6 + 6 + 5);
    expect(s.scheduleError).toBeNull();
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();

    // 3. The transformer is energized only after the switchgear functional test.
    const func = findTask(s, 'SWGR-1', 'Functional test');
    const energize = findTask(s, 'XFMR-1', 'Energization');
    // On its own the transformer would be ready well before the switchgear.
    expect(s.schedule[energize.id]!.start < s.schedule[func.id]!.finish).toBe(true);
    await row(page, energize.id).locator('.gc-id').click();
    const preds = field(page, 'Predecessors');
    const existing = await preds.inputValue();
    expect(existing).not.toBe('');
    const funcLabel = (await row(page, func.id).locator('.gc-id').textContent())!.trim();
    await preds.fill(`${existing}, ${funcLabel} FS`);
    await preds.press('Enter');
    s = await h.waitState((x) => x.project!.dependencies.some((d) => d.predecessorId === func.id && d.successorId === energize.id), 'the new link');
    // Energization can't come before the switchgear functional test finishes.
    expect(s.schedule[energize.id]!.start > s.schedule[func.id]!.finish).toBe(true);

    // 4. Progress on two tasks, then move the data date.
    const vmi1 = findTask(s, 'SWGR-1', 'Visual & mechanical inspection');
    const vmiX = findTask(s, 'XFMR-1', 'Visual & mechanical inspection');
    await row(page, vmi1.id).locator('.gc-id').click();
    await field(page, '% complete').fill('50');
    await field(page, '% complete').press('Enter');
    await h.waitState((x) => taskOf(x, vmi1.id).percentComplete === 50, 'progress on SWGR-1');
    await row(page, vmiX.id).locator('.gc-id').click();
    await field(page, 'Actual start').fill('Nov 2');
    await field(page, 'Actual start').press('Enter');
    await h.waitState((x) => taskOf(x, vmiX.id).actualStart === '2026-11-02', 'the transformer actual start');
    await field(page, 'Actual finish').fill('Nov 2');
    await field(page, 'Actual finish').press('Enter');
    s = await h.waitState((x) => taskOf(x, vmiX.id).percentComplete === 100, 'the transformer inspection done');
    expect(taskOf(s, vmi1.id).actualStart).toBe('2026-11-02');

    await page.getByRole('button', { name: /Data as of Nov 2, 2026/ }).click();
    const dd = page.getByRole('dialog', { name: 'Data date' });
    await dd.getByLabel('Data as of').fill('2026-11-04');
    await dd.getByRole('button', { name: 'Set data date' }).click();
    s = await h.waitState((x) => x.project!.dataDate === '2026-11-04', 'the data date');
    await dd.waitFor({ state: 'detached' });
    const moved = s;

    // 5. Undo back past the progress and the cross-asset link, then redo it all.
    const grid = page.getByRole('grid', { name: 'Tasks' });
    await grid.focus();
    const hasLink = (x: AppState) => x.project!.dependencies.some((d) => d.predecessorId === func.id && d.successorId === energize.id);
    const step = async (key: 'Control+z' | 'Control+y', ok: (x: AppState) => boolean, what: string) => {
      const seq = (await h!.state()).seq;
      await page.keyboard.press(key);
      return h!.waitState((x) => x.seq > seq && ok(x), what);
    };
    s = await step('Control+z', (x) => x.project!.dataDate === '2026-11-02', 'undo of the data date');
    expect(s.canRedo).toBe(true);
    await step('Control+z', (x) => taskOf(x, vmiX.id).actualFinish == null, 'undo of the transformer actual finish');
    await step('Control+z', (x) => taskOf(x, vmiX.id).actualStart == null, 'undo of the transformer actual start');
    s = await step('Control+z', (x) => taskOf(x, vmi1.id).percentComplete === 0, 'undo of the 50% entry');
    expect(hasLink(s)).toBe(true);
    s = await step('Control+z', (x) => !hasLink(x), 'undo of the predecessor link');
    expect(s.schedule[energize.id]!.start < s.schedule[func.id]!.finish).toBe(true);
    await step('Control+y', hasLink, 'redo of the predecessor link');
    await step('Control+y', (x) => taskOf(x, vmi1.id).percentComplete === 50, 'redo of the 50% entry');
    await step('Control+y', (x) => taskOf(x, vmiX.id).actualStart === '2026-11-02', 'redo of the transformer actual start');
    await step('Control+y', (x) => taskOf(x, vmiX.id).percentComplete === 100, 'redo of the transformer actual finish');
    s = await step('Control+y', (x) => x.project!.dataDate === '2026-11-04', 'redo of the data date');
    expect(s.canRedo).toBe(false);
    expect(s.project).toEqual(moved.project);
    expect(s.schedule).toEqual(moved.schedule);

    // 6. A 3-week look-ahead on Tabloid (Rev A), and blank test sheets.
    const lookA = join(h.dir, 'Look-ahead Rev A.pdf');
    const pdfA = await exportPdf(h, 'Look-ahead', 'A', lookA, async (d) => {
      await d.getByLabel('Tabloid (17 × 11 in)').check();
      await d.locator('select[name="weeks"]').selectOption('3');
      await d.getByLabel('Note for this revision').fill('Issued for field use');
      await expect.poll(() => d.getByTestId('print-sheet-count').textContent()).toMatch(/· 17 × 11 in$/);
      await expect.poll(() => d.locator('iframe').contentFrame().locator('body').textContent()).toContain('SWGR-1');
    });
    expect(mediaBox(pdfA)).toEqual([0, 0, 1224, 792]);
    const sheets = join(h.dir, 'Test sheets Rev A.pdf');
    const pdfT = await exportPdf(h, 'Test sheets', 'A', sheets, async (d) => {
      await d.getByRole('list', { name: 'Tasks with checklists' }).waitFor();
      await expect.poll(() => d.getByTestId('print-sheet-count').textContent()).toMatch(/· 8\.5 × 11 in$/);
    });
    expect(mediaBox(pdfT)).toEqual([0, 0, 612, 792]);
    expect(pdfPages(pdfT)).toBeGreaterThanOrEqual(10);

    // 7. Close, reopen from the recent list, and check everything persisted.
    const before = await h.state();
    await menu(page, 'File', 'Close project');
    const welcome = page.getByRole('main', { name: 'Welcome' });
    await welcome.waitFor();
    await welcome.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Harbor Point Substation\.cxp/ }).click();
    s = await h.waitState((x) => x.fileName === 'Harbor Point Substation.cxp' && x.project !== null, 'the project to reopen');
    expect(s.project).toEqual(before.project);
    expect(s.schedule).toEqual(before.schedule);
    expect(s.project!.dataDate).toBe('2026-11-04');
    expect(taskOf(s, vmi1.id)).toMatchObject({ percentComplete: 50, actualStart: '2026-11-02' });
    expect(taskOf(s, vmiX.id)).toMatchObject({ percentComplete: 100, actualFinish: '2026-11-02' });
    const setup = await page.evaluate(() => window.cx.print.setup());
    if (!setup.ok) throw new Error(setup.message);
    expect(setup.value.history.map((p) => [p.kind, p.rev, p.paper])).toEqual([
      ['lookahead', 'A', 'tabloid'],
      ['test-sheets', 'A', 'letter'],
    ]);
    await row(page, vmi1.id).locator('.gc-id').click();
    await panel(page).getByRole('heading').filter({ hasText: 'SWGR-1' }).waitFor();
    await h.screenshot('m1-schedule');

    // The template editor shows the starter in use by the two lineups.
    const bar = page.getByRole('menubar');
    await bar.getByRole('menuitem', { name: 'Templates', exact: true }).click();
    await page.getByRole('main', { name: 'Template editor' }).waitFor();
    await expect.poll(() => page.getByLabel('Template name').inputValue()).toBe('Low-voltage switchgear');
    await expect.poll(() => page.getByTestId('template-summary').textContent()).toMatch(/used by 2 assets/);
    await h.screenshot('m1-templates');
    await bar.getByRole('menuitem', { name: 'Schedule', exact: true }).click();
    await page.getByRole('grid', { name: 'Tasks' }).waitFor();

    // 8. The next look-ahead is Rev B.
    const lookB = join(h.dir, 'Look-ahead Rev B.pdf');
    const pdfB = await exportPdf(h, 'Look-ahead', 'B', lookB, async (d) => {
      await d.getByLabel('Tabloid (17 × 11 in)').check();
      await d.getByLabel('Note for this revision').fill('Progress to Nov 4');
      await d.getByRole('list', { name: 'Earlier revisions' }).getByText(/Issued for field use/).waitFor();
      // The sheet's revision box lists Rev B with its note, under Rev A, not just the note text.
      const sheet = () => d.locator('iframe').contentFrame().locator('body').textContent();
      await expect.poll(sheet).toMatch(/A · [^·]+ · Issued for field use/);
      await expect.poll(sheet).toMatch(/B · [^·]+ · Progress to Nov 4/);
    }, 'm1-print-dialog');
    expect(mediaBox(pdfB)).toEqual([0, 0, 1224, 792]);
    // The stored print records: B was issued and recorded as B.
    const after = await page.evaluate(() => window.cx.print.setup());
    if (!after.ok) throw new Error(after.message);
    expect(after.value.history.map((p) => [p.kind, p.rev, p.paper, p.note])).toEqual([
      ['lookahead', 'A', 'tabloid', 'Issued for field use'],
      ['test-sheets', 'A', 'letter', expect.any(String)],
      ['lookahead', 'B', 'tabloid', 'Progress to Nov 4'],
    ]);
    expect(after.value.nextRevision.lookahead).toBe('C');
  });
});
