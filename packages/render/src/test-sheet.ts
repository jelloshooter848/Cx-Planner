import type { Asset, IsoDate, Project, Task } from '@cx/core';
import { inch, PAPER, portrait, type Paper } from './paper.js';
import { diamond } from './symbols.js';
import { esc, fit, longDate, shortDate, wrapText } from './text.js';

/**
 * One check on a printed test sheet. A template `ChecklistItem` fits as is;
 * `acceptance` (e.g. "Per mfr. torque table") adds an Acceptance column when any item has one.
 */
export interface TestSheetItem {
  id: string;
  text: string;
  acceptance?: string;
}

export interface TestSheetOptions {
  project: Project;
  asset: Asset;
  task: Task;
  checklist: readonly TestSheetItem[];
  /** Revision of the sheet. `issued` is printed in the footer as the generated date. */
  revision: { rev: string; issued: IsoDate };
  /** Form name from the template, e.g. "Protective relay test". Defaults to the task name. */
  sheetName?: string;
  /** Form number, e.g. "LVSG-01". Printed with the revision in the header. */
  sheetId?: string;
  /** Planned dates, e.g. from the computed schedule. Left blank when omitted. */
  scheduled?: { start: IsoDate; finish: IsoDate };
  /** Test instrument, serial number, calibration due and drawing reference boxes. Default true. */
  instrumentFields?: boolean;
  /**
   * Fewest hand-written comment lines on the last page. Default 1; space left above the
   * sign-off is filled with more lines, up to 8. Capped so the comments, sign-off and at
   * least one checklist row still fit on one page.
   */
  commentLines?: number;
  /** Wording of the hold / witness point box. Defaults to a generic release statement. */
  holdNote?: string;
}

export interface TestSheetPage {
  /** 1-based page number. */
  number: number;
  /** Ids of the checklist items printed on this page, in order. */
  itemIds: string[];
  svg: string;
}

export interface TestSheetLayout {
  /** Letter portrait, 8.5 × 11 in. */
  paper: Paper;
  sheets: TestSheetPage[];
  itemCount: number;
}

const INK = '#111';
const MUTED = '#4b5260';
const GRID = '#9aa1ab';
const SHADE = '#eceef1';

const PAGE = portrait(PAPER.letter);
const PAGE_W = inch(PAGE.widthIn);
const PAGE_H = inch(PAGE.heightIn);
const MX = inch(0.5);
const MY = inch(0.5);
const CONTENT_W = PAGE_W - 2 * MX;

const FONT = 13;
const LINE_H = 15;
const ROW_PAD = 11;
const MIN_ROW_H = 36;
const TABLE_HEAD_H = 33;
const INFO_ROW_H = 45;
const GAP = 12;
const FOOTER_H = 34; // generated line + page number
const SIGN_H = 52;
const COMMENT_LINE = 25;
const MAX_FILL_COMMENT_LINES = 8;
/** Lines of item text that a capped comment area always leaves room for. */
const ROW_BUDGET_LINES = 10;

interface Col {
  key: 'num' | 'check' | 'acceptance' | 'result' | 'notes' | 'init';
  label: string;
  w: number;
}

/** Lay out a printed test sheet on Letter portrait, splitting long checklists over several pages. */
export function layoutTestSheet(opts: TestSheetOptions): TestSheetLayout {
  const cols = columns(opts.checklist.some((i) => i.acceptance?.trim()));
  const colW = (k: Col['key']) => cols.find((c) => c.key === k)?.w ?? 0;

  const header = headerHeight(opts);
  const info = opts.instrumentFields === false ? INFO_ROW_H : 2 * INFO_ROW_H;
  const tableTop = (first: boolean) => MY + header + GAP + (first ? info + GAP : 0) + TABLE_HEAD_H;
  const bottom = PAGE_H - MY - FOOTER_H;
  // Comment lines may not squeeze the checklist: keep room for a row of ROW_BUDGET_LINES lines.
  const commentLines = commentLineCount(opts, bottom - SIGN_H - tableTop(true) - (ROW_BUDGET_LINES * LINE_H + ROW_PAD));
  const lastBottom = bottom - SIGN_H - tailHeight(opts, commentLines);
  // A row never grows past what fits on the first page above the sign-off, so any single row
  // fits on any page and the sign-off page always shows part of the checklist.
  const maxLines = Math.max(1, Math.floor((lastBottom - tableTop(true) - ROW_PAD) / LINE_H));

  const rows = opts.checklist.map((item, i) => {
    const check = clampLines(wrapText(item.text, colW('check') - 16, FONT), maxLines, colW('check') - 16, FONT);
    const acceptance = item.acceptance
      ? clampLines(wrapText(item.acceptance, colW('acceptance') - 14, 12), maxLines, colW('acceptance') - 14, 12)
      : [];
    const lines = Math.max(check.length, acceptance.length);
    return { item, n: i + 1, check, acceptance, h: Math.max(MIN_ROW_H, lines * LINE_H + ROW_PAD) };
  });

  // Greedy fill, then make sure the hold box, comments and sign-off fit after the last row.
  const pages: Array<typeof rows> = [[]];
  let y = tableTop(true);
  for (const row of rows) {
    const cur = pages[pages.length - 1]!;
    if (cur.length > 0 && y + row.h > bottom) {
      pages.push([]);
      y = tableTop(false);
    }
    pages[pages.length - 1]!.push(row);
    y += row.h;
  }
  const used = (p: typeof rows, i: number) => tableTop(i === 0) + p.reduce((s, r) => s + r.h, 0);
  const lastIdx = pages.length - 1;
  const prev = pages[lastIdx]!;
  if (used(prev, lastIdx) > lastBottom && prev.length > 1) {
    // Carry the last row over so the sign-off page still shows part of the checklist.
    // (A lone row always fits above the sign-off: rows are capped at maxLines.)
    pages.push([prev.pop()!]);
  }

  const total = pages.length;
  const sheets = pages.map((pageRows, i) => ({
    number: i + 1,
    itemIds: pageRows.map((r) => r.item.id),
    svg: drawPage({ opts, cols, rows: pageRows, first: i === 0, last: i === total - 1, number: i + 1, total, header, info, commentLines }),
  }));
  return { paper: PAGE, sheets, itemCount: opts.checklist.length };
}

function columns(withAcceptance: boolean): Col[] {
  const fixed: Col[] = [
    { key: 'num', label: '#', w: 34 },
    { key: 'check', label: 'Check', w: 0 },
    // Wide enough for typical criteria (~25 characters, e.g. "Per project spec / NETA ATS") on one line.
    ...(withAcceptance ? [{ key: 'acceptance' as const, label: 'Acceptance', w: 190 }] : []),
    { key: 'result', label: 'Result', w: 100 },
    { key: 'notes', label: 'Notes', w: withAcceptance ? 76 : 140 },
    { key: 'init', label: 'Init.', w: 46 },
  ];
  const rest = CONTENT_W - fixed.reduce((s, c) => s + c.w, 0);
  return fixed.map((c) => (c.key === 'check' ? { ...c, w: rest } : c));
}

const TITLE_SIZE = 25;
const TITLE_LINE = 30;
const RIGHT_W = 250;

function titleLines(opts: TestSheetOptions): string[] {
  const lines = wrapText(opts.task.name, CONTENT_W - RIGHT_W - 20, TITLE_SIZE, true);
  if (lines.length <= 2) return lines;
  return [lines[0]!, fit(lines.slice(1).join(' '), CONTENT_W - RIGHT_W - 20, TITLE_SIZE, true)];
}

function headerHeight(opts: TestSheetOptions): number {
  return Math.max(30 + titleLines(opts).length * TITLE_LINE, 82) + 8;
}

function holdKind(task: Task): 'hold' | 'witness' | undefined {
  return task.type === 'hold' || task.type === 'witness' ? task.type : undefined;
}

function holdNoteLines(opts: TestSheetOptions): string[] {
  const note =
    opts.holdNote ??
    (holdKind(opts.task) === 'hold'
      ? 'Do not proceed past this task until it is released by the Cx agent and Owner representative.'
      : 'Give notice so the Cx agent and Owner representative can witness this test.');
  return wrapText(note, CONTENT_W - 350, 12);
}

function holdBoxHeight(opts: TestSheetOptions): number {
  return Math.max(66, 36 + holdNoteLines(opts).length * LINE_H);
}

function holdHeight(opts: TestSheetOptions): number {
  return holdKind(opts.task) ? GAP + holdBoxHeight(opts) : 0;
}

/** Requested comment lines, capped to what fits in `room` px together with the hold box. */
function commentLineCount(opts: TestSheetOptions, room: number): number {
  const requested = Math.max(0, Math.floor(opts.commentLines ?? 1));
  if (requested === 0) return 0;
  const fits = Math.floor((room - holdHeight(opts) - 2 * GAP - 22) / COMMENT_LINE);
  return Math.max(0, Math.min(requested, fits));
}

function tailHeight(opts: TestSheetOptions, commentLines: number): number {
  let h = holdHeight(opts);
  if (commentLines > 0) h += GAP + 22 + commentLines * COMMENT_LINE;
  return h + GAP;
}

/** Keep at most `max` lines; the last kept line ends with an ellipsis when text was cut. */
function clampLines(lines: string[], max: number, width: number, size: number): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = fit(`${lines.slice(max - 1).join(' ')}…`, width, size);
  return kept;
}

interface DrawArgs {
  opts: TestSheetOptions;
  cols: Col[];
  rows: Array<{ item: TestSheetItem; n: number; check: string[]; acceptance: string[]; h: number }>;
  first: boolean;
  last: boolean;
  number: number;
  total: number;
  header: number;
  info: number;
  commentLines: number;
}

function drawPage(a: DrawArgs): string {
  const { opts, cols } = a;
  const out: string[] = [];
  const x0 = MX;
  const right = MX + CONTENT_W;

  // ---- Header (every page)
  const kind = opts.sheetName && opts.sheetName !== opts.task.name ? ` · ${opts.sheetName}` : '';
  const kicker = `Test sheet · Task ${opts.task.code}${kind}${a.first ? '' : ' (continued)'}`.toUpperCase();
  out.push(text(x0, MY + 12, fit(kicker, CONTENT_W - RIGHT_W, 11.5, true), { size: 11.5, weight: 600, fill: MUTED, ls: 0.6 }));
  titleLines(opts).forEach((line, i) => out.push(text(x0, MY + 40 + i * TITLE_LINE, line, { size: TITLE_SIZE, weight: 700 })));
  const sheetRef = [opts.sheetId ? `Sheet ${opts.sheetId}` : 'Sheet', `Rev ${opts.revision.rev}`].join(' · ');
  const proj = opts.project.name;
  out.push(
    text(right, MY + 14, fit(opts.asset.tag, RIGHT_W, 17, true), { size: 17, weight: 700, anchor: 'end' }),
    text(right, MY + 35, fit(opts.asset.description, RIGHT_W, 12.5), { size: 12.5, anchor: 'end' }),
    text(right, MY + 54, fit(proj, RIGHT_W, 12.5), { size: 12.5, anchor: 'end' }),
    text(right, MY + 73, fit(sheetRef, RIGHT_W, 12.5), { size: 12.5, anchor: 'end' }),
  );
  out.push(`<rect x="${x0}" y="${MY + a.header - 3}" width="${CONTENT_W}" height="3" fill="${INK}"/>`);
  let y = MY + a.header + GAP;

  // ---- Asset / task info block (first page)
  if (a.first) {
    const sched = opts.scheduled ? dateRange(opts.scheduled.start, opts.scheduled.finish) : '';
    const rowsOfCells: Array<Array<[string, string, number]>> = [
      [
        ['Location', opts.asset.location ?? '', 200],
        ['Scheduled', sched, 190],
        ['Test date', '', 130],
        ['Responsible', opts.task.responsible ?? '', 0],
      ],
    ];
    if (opts.instrumentFields !== false) {
      rowsOfCells.push([
        ['Test instrument', '', 220],
        ['Serial no.', '', 150],
        ['Cal. due', '', 110],
        ['Drawing / submittal ref.', '', 0],
      ]);
    }
    out.push(`<rect x="${x0}" y="${y}" width="${CONTENT_W}" height="${a.info}" fill="none" stroke="${INK}" stroke-width="1"/>`);
    rowsOfCells.forEach((cells, ri) => {
      const ry = y + ri * INFO_ROW_H;
      if (ri > 0) out.push(hline(x0, right, ry, INK));
      let cx = x0;
      cells.forEach(([label, value, w], ci) => {
        const cw = w || right - cx;
        if (ci > 0) out.push(vline(cx, ry, ry + INFO_ROW_H, INK));
        out.push(text(cx + 10, ry + 17, label, { size: 11.5, fill: MUTED }));
        if (value) out.push(text(cx + 10, ry + 36, fit(value, cw - 20, 13.5, true), { size: 13.5, weight: 600 }));
        cx += cw;
      });
    });
    y += a.info + GAP;
  }

  // ---- Checklist table (header repeated on every page that has rows)
  if (a.rows.length > 0 || a.opts.checklist.length === 0) {
    const tableTop = y;
    out.push(`<rect x="${x0}" y="${y}" width="${CONTENT_W}" height="${TABLE_HEAD_H}" fill="${SHADE}"/>`);
    let cx = x0;
    for (const c of cols) {
      const center = c.key === 'result' || c.key === 'init';
      out.push(text(center ? cx + c.w / 2 : cx + 10, y + 21, c.label, { size: 12, weight: 600, anchor: center ? 'middle' : 'start' }));
      cx += c.w;
    }
    y += TABLE_HEAD_H;
    out.push(hline(x0, right, y, INK));
    if (a.rows.length === 0) {
      out.push(text(x0 + 10, y + 25, 'No checklist items on this task. Record results under Comments.', { size: FONT, fill: MUTED }));
      y += MIN_ROW_H;
    }
    for (const row of a.rows) {
      out.push(`<g data-item="${esc(row.item.id)}">`);
      let rx = x0;
      const top = (lines: string[]) => y + row.h / 2 - ((lines.length - 1) * LINE_H) / 2 + 4.5;
      for (const c of cols) {
        switch (c.key) {
          case 'num':
            out.push(text(rx + 10, y + row.h / 2 + 4.5, String(row.n), { size: FONT }));
            break;
          case 'check':
            out.push(multiline(rx + 10, top(row.check), row.check, FONT));
            break;
          case 'acceptance':
            out.push(multiline(rx + 10, top(row.acceptance), row.acceptance, 12, MUTED));
            break;
          case 'result':
            out.push(resultBoxes(rx + c.w / 2, y + row.h / 2));
            break;
          default:
            break;
        }
        rx += c.w;
      }
      out.push('</g>');
      y += row.h;
      out.push(hline(x0, right, y, GRID));
    }
    // Outer frame and column rules.
    out.push(`<rect x="${x0}" y="${tableTop}" width="${CONTENT_W}" height="${y - tableTop}" fill="none" stroke="${INK}" stroke-width="1"/>`);
    let vx = x0;
    cols.forEach((c, i) => {
      if (i > 0 && (c.key === 'notes' || c.key === 'init')) out.push(vline(vx, tableTop, y, INK));
      vx += c.w;
    });
  }

  if (a.last) {
    // ---- Hold / witness point box
    const kindOf = holdKind(opts.task);
    if (kindOf) {
      y += GAP;
      const lines = holdNoteLines(opts);
      const h = holdBoxHeight(opts);
      out.push(`<rect x="${x0}" y="${y}" width="${CONTENT_W}" height="${h}" fill="none" stroke="${INK}" stroke-width="2"/>`);
      out.push(diamond(x0 + 26, y + h / 2, 13, kindOf === 'hold'));
      out.push(text(x0 + 50, y + 22, kindOf === 'hold' ? 'HOLD POINT' : 'WITNESS POINT', { size: 13, weight: 700, ls: 0.4 }));
      out.push(multiline(x0 + 50, y + 39, lines, 12));
      const lx = right - 240;
      out.push(hline(lx, right - 16, y + h / 2 + 6, INK), text(lx, y + h / 2 + 24, 'Released by / date', { size: 11.5, fill: MUTED }));
      y += h;
    }

    // ---- Comments
    const min = a.commentLines;
    if (min > 0) {
      y += GAP;
      const room = PAGE_H - MY - FOOTER_H - SIGN_H - GAP - (y + 22);
      const n = Math.max(min, Math.min(MAX_FILL_COMMENT_LINES, Math.floor(room / COMMENT_LINE)));
      out.push(text(x0, y + 12, 'COMMENTS', { size: 11.5, weight: 700, ls: 0.6 }));
      for (let i = 0; i < n; i++) out.push(hline(x0, right, y + 22 + (i + 1) * COMMENT_LINE, GRID));
    }

    // ---- Sign-off (bottom of the last page)
    const sy = PAGE_H - MY - FOOTER_H - SIGN_H + 26;
    const gap = 26;
    const w = (CONTENT_W - 2 * gap) / 3;
    ['Performed by (print, sign) / date', 'Witnessed by (print, sign) / date', 'QC reviewed by / date'].forEach((label, i) => {
      const sx = x0 + i * (w + gap);
      out.push(hline(sx, sx + w, sy, INK), text(sx, sy + 17, label, { size: 11.5, fill: MUTED }));
    });
  }

  // ---- Footer (every page)
  const fy = PAGE_H - MY - 6;
  out.push(
    text(x0, fy, `Generated by Cx Planner · ${longDate(opts.revision.issued)}`, { size: 11.5, fill: MUTED }),
    text(x0 + CONTENT_W / 2, fy, `${opts.asset.tag} · Task ${opts.task.code}`, { size: 11.5, fill: MUTED, anchor: 'middle' }),
    text(right, fy, `Page ${a.number} of ${a.total}`, { size: 11.5, fill: MUTED, anchor: 'end' }),
  );

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.widthIn}in" height="${PAGE.heightIn}in" viewBox="0 0 ${PAGE_W} ${PAGE_H}" ` +
    `font-family="Inter, Arial, sans-serif" text-rendering="geometricPrecision">` +
    `<rect width="${PAGE_W}" height="${PAGE_H}" fill="#fff"/>${out.join('')}</svg>`
  );
}

/** Three tick boxes labelled P, F and N/A, centred on (cx, cy). */
function resultBoxes(cx: number, cy: number): string {
  const s = 15;
  const step = 28;
  return ['P', 'F', 'N/A']
    .map((label, i) => {
      const bx = cx + (i - 1) * step;
      return (
        `<rect x="${r1(bx - s / 2)}" y="${r1(cy - s + 2)}" width="${s}" height="${s}" fill="#fff" stroke="${INK}" stroke-width="1.2"/>` +
        text(bx, cy + 14, label, { size: 9.5, weight: 700, anchor: 'middle' })
      );
    })
    .join('');
}

function dateRange(start: IsoDate, finish: IsoDate): string {
  if (start === finish) return shortDate(start);
  return `${shortDate(start)} – ${shortDate(finish)}`;
}

interface TextOpts {
  size: number;
  weight?: number;
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
  ls?: number;
}

function text(x: number, y: number, s: string, o: TextOpts): string {
  const attrs = [
    `x="${r1(x)}"`,
    `y="${r1(y)}"`,
    `font-size="${o.size}"`,
    o.weight ? `font-weight="${o.weight}"` : '',
    `fill="${o.fill ?? INK}"`,
    o.anchor && o.anchor !== 'start' ? `text-anchor="${o.anchor}"` : '',
    o.ls ? `letter-spacing="${o.ls}"` : '',
  ].filter(Boolean);
  return `<text ${attrs.join(' ')}>${esc(s)}</text>`;
}

/** Lines stacked LINE_H apart, first baseline at y. */
function multiline(x: number, y: number, lines: string[], size: number, fill = INK): string {
  if (lines.length === 0) return '';
  const spans = lines.map((l, i) => `<tspan x="${r1(x)}"${i === 0 ? '' : ` dy="${LINE_H}"`}>${esc(l)}</tspan>`).join('');
  return `<text x="${r1(x)}" y="${r1(y)}" font-size="${size}" fill="${fill}">${spans}</text>`;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const vline = (x: number, y1: number, y2: number, c: string) => `<line x1="${r1(x)}" y1="${r1(y1)}" x2="${r1(x)}" y2="${r1(y2)}" stroke="${c}" stroke-width="1"/>`;
const hline = (x1: number, x2: number, y: number, c: string) => `<line x1="${r1(x1)}" y1="${r1(y)}" x2="${r1(x2)}" y2="${r1(y)}" stroke="${c}" stroke-width="1"/>`;
