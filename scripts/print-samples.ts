/**
 * Render the sample schedule prints and test sheets to PDF and PNG with headless Chromium (Playwright).
 * Usage: pnpm print:samples [outDir]
 * Electron's printToPDF uses the same Chromium print path; this script lets CI and
 * developers check print output without starting the desktop app.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { computeSchedule } from '@cx/core';
import { largeProject, riversideProject } from '@cx/fixtures';
import {
  layoutSchedulePrint, layoutTestSheet, printDocumentHtml, type PrintDocument, type SchedulePrintOptions, type TestSheetOptions,
} from '@cx/render';
import { interFontCss } from '@cx/render/fonts-node';
import { starterTemplate } from '@cx/templates';

const outDir = resolve(process.argv[2] ?? 'spike-output');
mkdirSync(outDir, { recursive: true });

const riverside = riversideProject();
const large = largeProject();
const revisions = [
  { rev: 'A', date: '2026-11-02', note: 'Issued for coordination' },
  { rev: 'B', date: '2026-11-06', note: 'Progress update, test tech added to 1.3' },
];

export const SAMPLES: Array<{ name: string; opts: SchedulePrintOptions }> = [
  {
    name: 'lookahead-tabloid',
    opts: {
      project: riverside, schedule: computeSchedule(riverside), paper: 'tabloid',
      title: '3-Week Look-Ahead: Nov 2 – Nov 20, 2026', window: { start: '2026-11-02', end: '2026-11-20' },
      revision: { rev: 'B', issued: '2026-11-06', baseline: 'Rev A' }, revisions,
    },
  },
  {
    name: 'lookahead-letter',
    opts: {
      project: riverside, schedule: computeSchedule(riverside), paper: 'letter',
      title: '3-Week Look-Ahead: Nov 2 – Nov 20', window: { start: '2026-11-02', end: '2026-11-20' },
      revision: { rev: 'B', issued: '2026-11-06', baseline: 'Rev A' }, revisions,
    },
  },
  {
    name: 'full-schedule-ansi-d',
    opts: {
      project: large, schedule: computeSchedule(large), paper: 'ansi-d',
      title: 'Full Commissioning Schedule', dayWidthIn: 0.42,
      revision: { rev: 'A', issued: '2026-11-02', baseline: 'Rev A' }, revisions: revisions.slice(0, 1),
    },
  },
];

const riversideSchedule = computeSchedule(riverside);
const swgr = riverside.assets.find((a) => a.id === 'swgr-1a')!;
const plannedDates = (taskId: string) => {
  const s = riversideSchedule.tasks.get(taskId)!;
  return { start: riversideSchedule.calendar.dateAt(s.es), finish: riversideSchedule.calendar.dateAt(Math.max(s.es, s.ef - 1)) };
};
const lvTemplate = starterTemplate('starter-lv-switchgear')!;
const funcTask = lvTemplate.tasks.find((t) => t.key === 'func')!;

/** Made-up pre-energization checklist following the TestSheet mockup, with acceptance criteria. */
const PRE_ENERGIZATION = [
  ['Nameplate data matches approved submittal', 'Record in header'],
  ['Enclosure, bus and cable compartments clean and undamaged', 'Visual'],
  ['Anchorage and grounding connections secure', 'Per spec section [XX]'],
  ['Bus bolted connections torque-verified and witness-marked', 'Per mfr. torque table'],
  ['Cable terminations torque-verified; phasing and labels correct', 'Per mfr. torque table'],
  ['Breaker racking, interlocks and shutters operate freely', 'Mechanical operation'],
  ['Control wiring terminated and verified', 'Per spec section [XX]'],
  ['Insulation resistance: bus and feeders', '≥ [value] at [test V]'],
  ['Relay settings loaded and verified against study', 'Study rev ____'],
  ['Breaker functional trip test', 'Trips per [spec]'],
  ['Arc-flash labels and signage installed', 'Installed'],
  ['Deficiencies logged; as-found / as-left recorded', 'NCR # ____ if any'],
].map(([text, acceptance], i) => ({ id: `pe-${i + 1}`, text: text!, acceptance }));

export const TEST_SHEET_SAMPLES: Array<{ name: string; opts: TestSheetOptions }> = [
  {
    name: 'test-sheet-letter',
    opts: {
      project: riverside, asset: swgr, task: { ...riverside.tasks.find((t) => t.id === 't1.4')!, name: 'Low-Voltage Switchgear Pre-Energization Checks', type: 'hold' },
      checklist: PRE_ENERGIZATION, revision: { rev: 'A', issued: '2026-11-06' }, sheetId: 'LVSG-01', scheduled: plannedDates('t1.4'),
      holdNote: 'Do not proceed to functional test (Task 1.5) until released by the Cx agent and Owner representative.',
    },
  },
  {
    // A long checklist: the starter functional test repeated with extra steps to show pagination.
    name: 'test-sheet-letter-long',
    opts: {
      project: riverside, asset: swgr, task: riverside.tasks.find((t) => t.id === 't1.5')!,
      checklist: [
        ...funcTask.checklist,
        ...Array.from({ length: 22 }, (_, i) => ({
          id: `extra-${i + 1}`,
          text: `Feeder breaker ${i + 1}: open, close and trip from the local control switch and from the remote SCADA point; confirm status indication`,
        })),
      ],
      revision: { rev: 'B', issued: '2026-11-06' }, sheetName: funcTask.testForm, sheetId: 'LVSG-05', scheduled: plannedDates('t1.5'),
    },
  },
];

async function render(browser: Awaited<ReturnType<typeof chromium.launch>>, name: string, layout: PrintDocument, title: string, fontCss: string): Promise<void> {
  const html = printDocumentHtml(layout, { title, fontCss });
  writeFileSync(join(outDir, `${name}.html`), html);
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: join(outDir, `${name}.pdf`), preferCSSPageSize: true, printBackground: true });
  await page.close();
}

async function main(): Promise<void> {
  const fontCss = interFontCss();
  const browser = await chromium.launch();
  try {
    for (const { name, opts } of SAMPLES) {
      const layout = layoutSchedulePrint(opts);
      await render(browser, name, layout, opts.title, fontCss);
      console.log(`${name}: ${layout.sheets.length} sheet(s), ${layout.rowBands} row band(s) × ${layout.timeBands} time band(s), ${layout.taskCount} tasks`);
    }
    for (const { name, opts } of TEST_SHEET_SAMPLES) {
      const layout = layoutTestSheet(opts);
      await render(browser, name, layout, `Test sheet ${opts.asset.tag} ${opts.task.code}`, fontCss);
      console.log(`${name}: ${layout.sheets.length} page(s), ${layout.itemCount} checklist items`);
    }
  } finally {
    await browser.close();
  }
}

await main();
