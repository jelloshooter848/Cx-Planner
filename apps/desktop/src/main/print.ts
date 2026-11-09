import { BrowserWindow } from 'electron';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeSchedule, type Project } from '@cx/core';
import { layoutSchedulePrint, lookAheadTitle, lookAheadWindow, printDocumentHtml, type PaperId, type PrintLayout } from '@cx/render';
import { interFontCss } from '@cx/render/fonts-node';

export interface LookAheadRequest {
  paper: PaperId;
  weeks: number;
  /** Data date the look-ahead starts from (its Monday). Defaults to the project's data date. */
  dataDate?: string;
  assetIds?: string[];
  showCriticalPath?: boolean;
  showTimes?: boolean;
}

let fontCss: string | undefined;
export function setFontDir(dir: string): void {
  fontCss = interFontCss(dir);
}

export function lookAheadDocument(project: Project, req: LookAheadRequest): { html: string; layout: PrintLayout; title: string } {
  const schedule = computeSchedule(project);
  const window = lookAheadWindow(req.dataDate ?? project.dataDate, req.weeks, schedule.calendar);
  const title = lookAheadTitle(window, req.weeks);
  const layout = layoutSchedulePrint({
    project, schedule, paper: req.paper, title, window,
    assetIds: req.assetIds, showCriticalPath: req.showCriticalPath, showTimes: req.showTimes,
    revision: { rev: 'B', issued: project.dataDate, baseline: 'Rev A' },
    revisions: [
      { rev: 'A', date: '2026-11-02', note: 'Issued for coordination' },
      { rev: 'B', date: '2026-11-06', note: 'Progress update' },
    ],
  });
  return { html: printDocumentHtml(layout, { title, fontCss }), layout, title };
}

export function fullScheduleDocument(project: Project, paper: PaperId): { html: string; layout: PrintLayout } {
  const layout = layoutSchedulePrint({
    project, schedule: computeSchedule(project), paper, title: 'Full Commissioning Schedule', dayWidthIn: 0.42,
    revision: { rev: 'A', issued: project.dataDate, baseline: 'Rev A' },
  });
  return { html: printDocumentHtml(layout, { title: 'Full schedule', fontCss }), layout };
}

/** Render an HTML print document to PDF in an offscreen window, using the document's CSS page size. */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  // A temp file, not a data: URL: large-format documents exceed Chromium's data URL limit.
  const dir = mkdtempSync(join(tmpdir(), 'cx-print-'));
  const file = join(dir, 'print.html');
  writeFileSync(file, html);
  try {
    await win.loadFile(file);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)').catch(() => true);
    return await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  } finally {
    win.destroy();
    rmSync(dir, { recursive: true, force: true });
  }
}
