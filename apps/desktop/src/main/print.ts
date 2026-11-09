import { BrowserWindow } from 'electron';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Project } from '@cx/core';
import type { Paper } from '@cx/render';
import { interFontCss } from '@cx/render/fonts-node';
import { buildPrint, type BuiltPrint } from './print-jobs.js';

let fontCss: string | undefined;
export function setFontDir(dir: string): void {
  fontCss = interFontCss(dir);
}

/** The bundled Inter @font-face rules for print documents (undefined until setFontDir). */
export function printFontCss(): string | undefined {
  return fontCss;
}

/** A look-ahead of a project with no print history (spikes and smoke tests). */
export function lookAheadDocument(project: Project, req: { paper: 'letter' | 'tabloid'; weeks: 2 | 3 | 4 | 6 }): BuiltPrint {
  return buildPrint({
    project, templates: [], history: [], fontCss,
    request: { kind: 'lookahead', paper: req.paper, weeks: req.weeks, start: project.dataDate, assetIds: null, showTimes: true, note: '' },
  });
}

/** The full schedule of a project with no print history (spikes and smoke tests). */
export function fullScheduleDocument(project: Project, paper: 'tabloid' | 'ansi-d' | 'arch-d'): BuiltPrint {
  return buildPrint({ project, templates: [], history: [], fontCss, request: { kind: 'full-schedule', paper, dayWidthIn: 0.42, assetIds: null, note: '' } });
}

/** Loads an HTML print document in an offscreen window, runs `fn` on it, then closes it. */
async function withPrintWindow<T>(html: string, fn: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  // A temp file, not a data: URL: large-format documents exceed Chromium's data URL limit.
  const dir = mkdtempSync(join(tmpdir(), 'cx-print-'));
  const file = join(dir, 'print.html');
  writeFileSync(file, html);
  try {
    await win.loadFile(file);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)').catch(() => true);
    return await fn(win);
  } finally {
    win.destroy();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Render an HTML print document to PDF in an offscreen window, using the document's CSS page size. */
export function htmlToPdf(html: string): Promise<Buffer> {
  return withPrintWindow(html, (win) =>
    win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } }),
  );
}

const MICRONS_PER_IN = 25_400;

/**
 * Shows the system print dialog for an HTML print document at its paper size, no margins.
 * Resolves true when it was sent to a printer, false when the user cancelled.
 */
export function printHtml(html: string, paper: Paper): Promise<boolean> {
  return withPrintWindow(
    html,
    (win) =>
      new Promise<boolean>((resolve, reject) => {
        win.webContents.print(
          {
            silent: false,
            printBackground: true,
            landscape: paper.widthIn > paper.heightIn,
            // Chromium takes the page size portrait (width < height) and turns it with `landscape`.
            pageSize: { width: Math.round(Math.min(paper.widthIn, paper.heightIn) * MICRONS_PER_IN), height: Math.round(Math.max(paper.widthIn, paper.heightIn) * MICRONS_PER_IN) },
            margins: { marginType: 'none' },
          },
          (success, reason) => {
            if (success) resolve(true);
            else if (/cancel/i.test(reason)) resolve(false);
            else reject(new Error(`Could not print: ${reason}`));
          },
        );
      }),
  );
}
