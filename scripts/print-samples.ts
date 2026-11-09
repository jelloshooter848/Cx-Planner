/**
 * Render the sample schedule prints to PDF and PNG with headless Chromium (Playwright).
 * Usage: pnpm print:samples [outDir]
 * Electron's printToPDF uses the same Chromium print path; this script lets CI and
 * developers check print output without starting the desktop app.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { computeSchedule } from '@cx/core';
import { largeProject, riversideProject } from '@cx/fixtures';
import { layoutSchedulePrint, printDocumentHtml, type SchedulePrintOptions } from '@cx/render';
import { interFontCss } from '@cx/render/fonts-node';

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

async function main(): Promise<void> {
  const fontCss = interFontCss();
  const browser = await chromium.launch();
  try {
    for (const { name, opts } of SAMPLES) {
      const layout = layoutSchedulePrint(opts);
      const html = printDocumentHtml(layout, { title: opts.title, fontCss });
      writeFileSync(join(outDir, `${name}.html`), html);
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.pdf({ path: join(outDir, `${name}.pdf`), preferCSSPageSize: true, printBackground: true });
      await page.close();
      console.log(`${name}: ${layout.sheets.length} sheet(s), ${layout.rowBands} row band(s) × ${layout.timeBands} time band(s), ${layout.taskCount} tasks`);
    }
  } finally {
    await browser.close();
  }
}

await main();
