import type { Asset, IsoDate, Project, ScheduleResult, Task } from '@cx/core';
import { TIMES_KEYS } from '@cx/core';
import { inch, PAPER, type Paper, type PaperId } from './paper.js';
import { diamond, timesSymbol } from './symbols.js';
import { esc, fit, longDate, shortDate, textWidth, weekdayLetter } from './text.js';

export interface RevisionEntry {
  rev: string;
  date: IsoDate;
  note: string;
}

export interface SchedulePrintOptions {
  project: Project;
  schedule: ScheduleResult;
  paper: PaperId;
  /** Sheet title, e.g. "3-Week Look-Ahead: Nov 2 – Nov 20, 2026". */
  title: string;
  /** Optional date window (inclusive). Tasks outside it are left off. Omit for the full schedule. */
  window?: { start: IsoDate; end: IsoDate };
  revision: { rev: string; issued: IsoDate; baseline?: string };
  /** Revision history. The footer lists the newest three, oldest first. */
  revisions?: RevisionEntry[];
  /** Only print these asset groups (by asset id). Omit to print every asset. */
  assetIds?: string[];
  /** Draw critical tasks with a heavy outline and list it in the legend. Default true. */
  showCriticalPath?: boolean;
  /**
   * Print a "Dur" column (working days, e.g. "4 d"; milestones "0 d"). Default true for the full
   * schedule (no `window`), false for look-aheads. It is the first column dropped on narrow sheets.
   */
  showDuration?: boolean;
  /** Print the T I M E S readiness columns and their legend line. Default true. */
  showTimes?: boolean;
  /**
   * Width of one working day in inches. Omit to fit the whole window on one sheet's width
   * (never narrower than `minDayWidthIn`, after which the time axis splits across sheets).
   */
  dayWidthIn?: number;
  minDayWidthIn?: number;
  /** Space for hand-written field notes at the foot of each sheet. Default true. */
  fieldNotes?: boolean;
}

export interface PrintSheet {
  /** 1-based sheet number in reading order. */
  number: number;
  /** Row band (1-based, top to bottom) and time band (1-based, left to right). */
  rowBand: number;
  timeBand: number;
  svg: string;
}

export interface PrintLayout {
  paper: Paper;
  sheets: PrintSheet[];
  rowBands: number;
  timeBands: number;
  /** Tasks shown, in print order. */
  taskCount: number;
}

type Row =
  | { kind: 'group'; asset: Asset; continued: boolean }
  | { kind: 'task'; task: Task };

interface Column {
  key: string;
  label: string;
  widthIn: number;
  align?: 'start' | 'middle' | 'end';
  /**
   * Optional columns are dropped on narrow sheets, lowest number first, until the timeline is
   * usable (at least 5 in wide, and, when fitting to the sheet, at least the minimum day width).
   */
  dropOrder?: number;
}

const INK = '#111';
const GRID = '#9aa1ab';
const GRID_LIGHT = '#d4d8de';
const SHADE = '#eceef1';
const MUTED = '#4b5260';

const MARGIN = inch(0.45);
const HEADER_H = inch(0.95);
const TIME_HEAD_H = inch(0.29);
const ROW_H = inch(0.31);
const FONT = 12; // px (9pt)

const BASE_COLUMNS: Column[] = [
  { key: 'id', label: 'ID', widthIn: 0.48 },
  { key: 'task', label: 'Task', widthIn: 2.75 },
  { key: 'responsible', label: 'Responsible', widthIn: 1.55, dropOrder: 2 },
  { key: 'dur', label: 'Dur', widthIn: 0.5, align: 'end', dropOrder: 1 },
  { key: 'start', label: 'Start', widthIn: 0.65 },
  { key: 'finish', label: 'Finish', widthIn: 0.65 },
  { key: 'pct', label: '%', widthIn: 0.52, align: 'end' },
  ...TIMES_KEYS.map((k) => ({ key: `times-${k}`, label: k, widthIn: 0.33, align: 'middle' as const })),
];

/** Lay out a schedule print over as many sheets as needed, repeating headers on every sheet. */
export function layoutSchedulePrint(opts: SchedulePrintOptions): PrintLayout {
  const paper = PAPER[opts.paper];
  const { project, schedule } = opts;
  const cal = schedule.calendar;
  const pageW = inch(paper.widthIn);
  const pageH = inch(paper.heightIn);
  const contentW = pageW - 2 * MARGIN;

  // Which tasks, and over what working-day range?
  const tasks = printedTasks(opts);
  let first: number;
  let last: number; // inclusive working-day indexes
  if (opts.window) {
    first = cal.indexOf(opts.window.start);
    last = cal.indexOf(opts.window.end);
    if (!cal.isWorkday(opts.window.end)) last -= 1;
  } else if (tasks.length === 0) {
    first = schedule.dataDateIndex;
    last = first;
  } else {
    first = Math.min(...tasks.map((t) => schedule.tasks.get(t.id)!.es));
    last = Math.max(...tasks.map((t) => schedule.tasks.get(t.id)!.ef)) + 1;
  }
  const dayCount = Math.max(1, last - first + 1);

  // Columns: drop optional ones on small sheets so the timeline keeps a usable width.
  const showDuration = opts.showDuration ?? !opts.window;
  let columns = BASE_COLUMNS.filter(
    (c) => !(opts.showTimes === false && c.key.startsWith('times-')) && !(!showDuration && c.key === 'dur'),
  );
  const tableWidth = (cols: Column[]) => cols.reduce((n, c) => n + inch(c.widthIn), 0);
  const minDay = inch(opts.minDayWidthIn ?? 0.2);
  const narrow = (cols: Column[]) => {
    const tl = contentW - tableWidth(cols);
    // Fit-to-width full schedules also keep each day at least minDay wide; look-aheads (a window)
    // and fixed day widths only need the 5 in timeline floor.
    return tl < inch(5) || (!opts.window && opts.dayWidthIn === undefined && tl / dayCount < minDay);
  };
  const dropOrder = columns.filter((c) => c.dropOrder !== undefined).sort((a, b) => a.dropOrder! - b.dropOrder!);
  for (const c of dropOrder) {
    if (!narrow(columns)) break;
    columns = columns.filter((x) => x !== c);
  }
  const tableW = tableWidth(columns);
  const timelineW = contentW - tableW;

  const dayW = opts.dayWidthIn !== undefined ? inch(opts.dayWidthIn) : Math.max(minDay, timelineW / dayCount);
  const daysPerSheet = Math.max(1, Math.floor((timelineW + 0.01) / dayW));
  const timeBands = packWeeks(first, last, daysPerSheet, (i) => cal.dateAt(i));

  // Rows, grouped by asset, then split into bands that fit the sheet height.
  const assetsById = new Map(project.assets.map((a) => [a.id, a]));
  const rows: Row[] = [];
  for (const asset of project.assets) {
    const own = tasks.filter((t) => t.assetId === asset.id);
    if (own.length === 0) continue;
    rows.push({ kind: 'group', asset, continued: false });
    for (const t of own) rows.push({ kind: 'task', task: t });
  }
  const footer = layoutFooter(opts, contentW, cal.dateAt(schedule.dataDateIndex));
  const bodyH = pageH - 2 * MARGIN - HEADER_H - 2 * TIME_HEAD_H - footer.height;
  const rowsPerSheet = Math.max(2, Math.floor(bodyH / ROW_H));
  const rowBands = bandRows(rows, rowsPerSheet, assetsById);

  const sheets: PrintSheet[] = [];
  const total = rowBands.length * timeBands.length;
  rowBands.forEach((bandRowsList, ri) => {
    timeBands.forEach((band, ti) => {
      const number = ri * timeBands.length + ti + 1;
      sheets.push({
        number,
        rowBand: ri + 1,
        timeBand: ti + 1,
        svg: drawSheet({
          opts, paper, pageW, pageH, columns, tableW, dayW, band, rows: bandRowsList, footer,
          sheetLabel: `${number} of ${total}`,
          bandLabel: total > 1 ? `Rows ${ri + 1}/${rowBands.length} · Time ${ti + 1}/${timeBands.length}` : '',
        }),
      });
    });
  });
  return { paper, sheets, rowBands: rowBands.length, timeBands: timeBands.length, taskCount: tasks.length };
}

/** The tasks a schedule print shows, in project order: asset filter, then date window. */
export function printedTasks(opts: Pick<SchedulePrintOptions, 'project' | 'schedule' | 'window' | 'assetIds'>): Task[] {
  const { project, schedule } = opts;
  const cal = schedule.calendar;
  const inWindow = (t: Task): boolean => {
    if (!opts.window) return true;
    const s = schedule.tasks.get(t.id)!;
    const a = cal.indexOf(opts.window.start);
    const b = cal.indexOf(opts.window.end);
    const last = Math.max(s.es, s.ef - 1);
    return s.es <= b && last >= a;
  };
  const assetFilter = opts.assetIds ? new Set(opts.assetIds) : undefined;
  return project.tasks.filter((t) => (!assetFilter || assetFilter.has(t.assetId)) && inWindow(t));
}

/**
 * First start and last finish (inclusive dates) of the tasks a schedule print shows, for its
 * title. Null when no task is printed.
 */
export function printedTaskRange(
  opts: Pick<SchedulePrintOptions, 'project' | 'schedule' | 'window' | 'assetIds'>,
): { start: IsoDate; end: IsoDate } | null {
  let start: IsoDate | undefined;
  let end: IsoDate | undefined;
  for (const t of printedTasks(opts)) {
    const s = opts.schedule.tasks.get(t.id)!;
    if (start === undefined || s.start < start) start = s.start;
    if (end === undefined || s.finish > end) end = s.finish;
  }
  return start !== undefined && end !== undefined ? { start, end } : null;
}

/** Split [first, last] into bands of at most `cap` days, breaking at week starts when possible. */
export function packWeeks(first: number, last: number, cap: number, dateAt: (i: number) => IsoDate): Array<[number, number]> {
  const weeks: Array<[number, number]> = [];
  let start = first;
  for (let i = first + 1; i <= last + 1; i++) {
    if (i > last || isNewWeek(dateAt(i - 1), dateAt(i))) {
      weeks.push([start, i - 1]);
      start = i;
    }
  }
  const bands: Array<[number, number]> = [];
  let cur: [number, number] | undefined;
  for (const [a, b] of weeks) {
    if (cur && b - cur[0] + 1 <= cap) {
      cur[1] = b;
      continue;
    }
    if (cur) bands.push(cur);
    // A week longer than the cap (very narrow sheets) gets split.
    let s = a;
    while (b - s + 1 > cap) {
      bands.push([s, s + cap - 1]);
      s += cap;
    }
    cur = [s, b];
  }
  if (cur) bands.push(cur);
  return bands;
}

function isNewWeek(prev: IsoDate, next: IsoDate): boolean {
  const day = (d: IsoDate) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  // Week boundary: crossed a Monday (Mon=1). Days since Thursday 1970-01-01 → Monday-based week number.
  return Math.floor((day(prev) + 3) / 7) !== Math.floor((day(next) + 3) / 7);
}

/** Split rows into sheet-sized bands. Never end a band on a group header; repeat the header on continuation. */
function bandRows(rows: Row[], perSheet: number, assets: Map<string, Asset>): Row[][] {
  const bands: Row[][] = [];
  let cur: Row[] = [];
  let currentAsset: Asset | undefined;
  for (const row of rows) {
    if (row.kind === 'group') currentAsset = row.asset;
    if (cur.length >= perSheet) {
      let carry: Row[] = [];
      if (cur[cur.length - 1]!.kind === 'group') carry = [cur.pop()!];
      bands.push(cur);
      cur = carry;
      if (cur.length === 0 && row.kind === 'task') {
        const asset = assets.get(row.task.assetId) ?? currentAsset;
        if (asset) cur.push({ kind: 'group', asset, continued: true });
      }
    }
    cur.push(row);
  }
  if (cur.length > 0) bands.push(cur);
  return bands.length > 0 ? bands : [[]];
}

interface DrawArgs {
  opts: SchedulePrintOptions;
  paper: Paper;
  pageW: number;
  pageH: number;
  columns: Column[];
  tableW: number;
  dayW: number;
  band: [number, number];
  rows: Row[];
  sheetLabel: string;
  bandLabel: string;
  footer: FooterLayout;
}

function drawSheet(a: DrawArgs): string {
  const { opts, pageW, pageH, columns, tableW, dayW, band, rows } = a;
  const { project, schedule } = opts;
  const cal = schedule.calendar;
  const out: string[] = [];
  const x0 = MARGIN;
  const contentW = pageW - 2 * MARGIN;
  const tlX = x0 + tableW;
  const days = band[1] - band[0] + 1;
  const tlW = days * dayW;
  const right = tlX + tlW;
  const dayX = (i: number) => tlX + (i - band[0]) * dayW;

  // ---- Title block
  out.push(
    text(x0, MARGIN + 14, `${project.name}${project.subtitle ? ` · ${project.subtitle}` : ''}`.toUpperCase(), { size: 12, weight: 600, fill: MUTED, ls: 0.6 }),
    text(x0, MARGIN + 52, fit(opts.title, contentW - inch(4.7), titleSize(pageW), true), { size: titleSize(pageW), weight: 700 }),
  );
  const boxes: Array<[string, string]> = [
    ['Revision', opts.revision.rev],
    ['Issued', longDate(opts.revision.issued)],
    ...(opts.revision.baseline ? [['Baseline', opts.revision.baseline] as [string, string]] : []),
    ['Sheet', a.sheetLabel],
  ];
  const boxW = [inch(0.8), inch(1.15), inch(0.8), inch(0.75)];
  let bx = x0 + contentW;
  const widths = boxes.map((_, i) => (i === boxes.length - 1 ? boxW[3]! : boxW[Math.min(i, 2)]!));
  bx -= widths.reduce((s, w) => s + w, 0);
  const by = MARGIN;
  const bh = inch(0.55);
  out.push(`<rect x="${bx}" y="${by}" width="${widths.reduce((s, w) => s + w, 0)}" height="${bh}" fill="none" stroke="${INK}" stroke-width="1"/>`);
  boxes.forEach(([label, value], i) => {
    if (i > 0) out.push(vline(bx, by, by + bh, INK));
    out.push(text(bx + 9, by + 19, label, { size: 11, fill: MUTED }), text(bx + 9, by + 40, value, { size: 15, weight: 700 }));
    bx += widths[i]!;
  });
  if (a.bandLabel) out.push(text(x0 + contentW, by + bh + 16, a.bandLabel, { size: 11, fill: MUTED, anchor: 'end' }));
  const ruleY = MARGIN + HEADER_H - inch(0.18);
  out.push(`<rect x="${x0}" y="${ruleY}" width="${contentW}" height="3" fill="${INK}"/>`);

  // ---- Grid header (repeated on every sheet)
  const gy = MARGIN + HEADER_H;
  const hy1 = gy + TIME_HEAD_H;
  const bodyY = gy + 2 * TIME_HEAD_H;
  out.push(`<rect x="${x0}" y="${gy}" width="${right - x0}" height="${2 * TIME_HEAD_H}" fill="${SHADE}"/>`);
  let cx = x0;
  for (const c of columns) {
    const w = inch(c.widthIn);
    const tx = c.align === 'middle' ? cx + w / 2 : c.align === 'end' ? cx + w - 8 : cx + 8;
    out.push(text(tx, hy1 + 19, c.label, { size: FONT, weight: 600, anchor: c.align ?? 'start' }));
    cx += w;
  }
  // Week and day headings.
  let weekStart = band[0];
  for (let i = band[0]; i <= band[1] + 1; i++) {
    const boundary = i > band[1] || (i > band[0] && isNewWeek(cal.dateAt(i - 1), cal.dateAt(i)));
    if (!boundary) continue;
    const wx = dayX(weekStart);
    const ww = (i - weekStart) * dayW;
    const label = ww > inch(1.1) ? `Week of ${shortDate(cal.dateAt(weekStart))}` : shortDate(cal.dateAt(weekStart));
    out.push(text(wx + 7, gy + 19, fit(label, ww - 10, FONT, true), { size: FONT, weight: 600 }));
    if (weekStart > band[0]) out.push(vline(wx, gy, bodyY, GRID));
    weekStart = i;
  }
  for (let i = band[0]; i <= band[1]; i++) {
    const d = cal.dateAt(i);
    const label = dayW >= inch(0.42) ? `${weekdayLetter(d)} ${Number(d.slice(8))}` : String(Number(d.slice(8)));
    if (dayW >= inch(0.16)) out.push(text(dayX(i) + dayW / 2, hy1 + 19, label, { size: dayW >= inch(0.3) ? 11 : 9, fill: MUTED, anchor: 'middle' }));
  }

  // ---- Body, painted in layers so nothing important is drawn over:
  // row shading → grid lines → row content (text, bars, diamonds) → data date → frame → marker labels.
  const bodyBottom = bodyY + rows.length * ROW_H;
  const shading: string[] = [];
  const grid: string[] = [];
  const content: string[] = [];
  const labels: string[] = [];
  rows.forEach((row, r) => {
    const y = bodyY + r * ROW_H;
    const mid = y + ROW_H / 2;
    if (row.kind === 'group') {
      shading.push(`<rect x="${x0}" y="${y}" width="${right - x0}" height="${ROW_H}" fill="${SHADE}"/>`);
      const tag = row.asset.tag + (row.continued ? ' (cont.)' : '');
      const detail = [row.asset.description, row.asset.location].filter(Boolean).join(' · ');
      content.push(
        `<text x="${x0 + 8}" y="${mid + 4.5}" font-size="${FONT + 1}" font-weight="700" fill="${INK}">${esc(tag)}` +
          `<tspan font-weight="400" font-size="${FONT}" fill="${MUTED}" dx="6">${esc(fit(detail, tableW - 120, FONT))}</tspan></text>`,
      );
    } else {
      const drawn = drawTaskRow(row.task, y, mid, x0, columns, opts, dayX, band, dayW);
      content.push(...drawn.content);
      labels.push(...drawn.labels);
    }
    grid.push(hline(x0, right, y + ROW_H, GRID_LIGHT));
  });

  // Day grid lines and week dividers over the body.
  for (let i = band[0] + 1; i <= band[1]; i++) {
    const strong = isNewWeek(cal.dateAt(i - 1), cal.dateAt(i));
    if (strong || dayW >= inch(0.16)) grid.push(vline(dayX(i), strong ? gy + TIME_HEAD_H : hy1, bodyBottom, strong ? GRID : GRID_LIGHT));
  }
  out.push(...shading, ...grid, ...content);
  // Data date line.
  const dd = schedule.dataDateIndex;
  if (dd >= band[0] && dd <= band[1] + 1) {
    out.push(`<line x1="${dayX(dd)}" y1="${hy1}" x2="${dayX(dd)}" y2="${bodyBottom}" stroke="${INK}" stroke-width="1.6" stroke-dasharray="5 3"/>`);
  }
  // Frame.
  out.push(`<rect x="${x0}" y="${gy}" width="${right - x0}" height="${bodyBottom - gy}" fill="none" stroke="${INK}" stroke-width="1"/>`);
  out.push(vline(tlX, gy, bodyBottom, INK), hline(x0, right, hy1 + TIME_HEAD_H, GRID), hline(tlX, right, hy1, GRID));
  // Marker labels last, so no line of any kind runs through them.
  out.push(...labels);

  // ---- Footer: legend, field notes, revisions, sign-off
  out.push(`<g class="sheet-footer">${a.footer.draw(x0, pageH - MARGIN - a.footer.height)}</g>`);

  const defs =
    `<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="6" height="6" fill="#fff"/><line x1="0" y1="0" x2="0" y2="6" stroke="${MUTED}" stroke-width="1.6"/></pattern></defs>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${a.paper.widthIn}in" height="${a.paper.heightIn}in" viewBox="0 0 ${pageW} ${pageH}" ` +
    `font-family="Inter, Arial, sans-serif" text-rendering="geometricPrecision">${defs}` +
    `<rect width="${pageW}" height="${pageH}" fill="#fff"/>${out.join('')}</svg>`
  );
}

function drawTaskRow(
  t: Task,
  y: number,
  mid: number,
  x0: number,
  columns: Column[],
  opts: SchedulePrintOptions,
  dayX: (i: number) => number,
  band: [number, number],
  dayW: number,
): { content: string[]; labels: string[] } {
  const s = opts.schedule.tasks.get(t.id)!;
  const out: string[] = [];
  const labels: string[] = [];
  let cx = x0;
  for (const c of columns) {
    const w = inch(c.widthIn);
    const baseline = mid + 4.5;
    const val = (v: string, extra: Partial<TextOpts> = {}) =>
      out.push(text(c.align === 'end' ? cx + w - 8 : cx + 8, baseline, fit(v, w - 14, FONT), { size: FONT, anchor: c.align ?? 'start', ...extra }));
    switch (c.key) {
      case 'id': val(t.code); break;
      case 'task': val(t.name); break;
      case 'responsible': val(t.responsible ?? ''); break;
      case 'dur': val(`${t.durationDays} d`); break;
      case 'start': val(shortDate(s.start)); break;
      case 'finish': val(shortDate(s.finish)); break;
      case 'pct': out.push(text(cx + w - 8, baseline, `${Math.round(t.percentComplete)}%`, { size: FONT, anchor: 'end' })); break;
      default:
        if (c.key.startsWith('times-') && t.readiness) {
          const k = c.key.slice(6) as keyof NonNullable<Task['readiness']>;
          out.push(timesSymbol(t.readiness[k], cx + w / 2, mid, 6.5));
        }
    }
    cx += w;
  }

  // Bar.
  const barH = inch(0.13);
  const top = mid - barH / 2;
  const done = t.percentComplete >= 100 || !!t.actualFinish;
  const heavy = s.critical && opts.showCriticalPath !== false ? 2.6 : 1.2;
  const visibleStart = Math.max(s.es, band[0]);
  const visibleEnd = Math.min(s.ef, band[1] + 1);
  if (t.durationDays > 0 && visibleEnd > visibleStart) {
    const bx = dayX(visibleStart);
    const bw = dayX(visibleEnd) - bx;
    if (done) {
      out.push(`<rect x="${bx}" y="${top}" width="${bw}" height="${barH}" fill="${INK}"/>`);
    } else if (t.percentComplete > 0) {
      const fullW = dayX(s.ef) - dayX(s.es);
      const doneEnd = dayX(s.es) + (fullW * t.percentComplete) / 100;
      const fx1 = Math.min(Math.max(doneEnd, bx), bx + bw);
      out.push(`<rect x="${bx}" y="${top}" width="${bw}" height="${barH}" fill="url(#hatch)"/>`);
      if (fx1 > bx) out.push(`<rect x="${bx}" y="${top}" width="${fx1 - bx}" height="${barH}" fill="${INK}"/>`);
      out.push(`<rect x="${bx}" y="${top}" width="${bw}" height="${barH}" fill="none" stroke="${INK}" stroke-width="${heavy}"/>`);
    } else {
      out.push(`<rect x="${bx}" y="${top}" width="${bw}" height="${barH}" fill="#fff" stroke="${INK}" stroke-width="${heavy}"/>`);
    }
    // Continuation arrows where the bar runs off this sheet.
    if (s.ef > band[1] + 1) out.push(arrow(bx + bw, mid, 1));
    if (s.es < band[0]) out.push(arrow(bx, mid, -1));
  }

  // Hold / witness / milestone markers.
  const markerAt = t.durationDays > 0 ? s.ef : s.es;
  const markerInBand = t.durationDays > 0 ? markerAt >= band[0] && markerAt <= band[1] + 1 : markerAt >= band[0] && markerAt <= band[1];
  if (t.type !== 'task' && markerInBand) {
    const mx = t.durationDays > 0 ? dayX(markerAt) : dayX(markerAt) + Math.min(dayW / 2, 12);
    const filled = t.type !== 'witness';
    out.push(diamond(mx, mid, MARKER_R, filled));
    const label = t.type === 'hold' ? 'HOLD' : t.type === 'witness' ? 'WITNESS' : t.name;
    // Labels stay inside the timeline: never across its right edge or the table/timeline divider.
    const roomRight = dayX(band[1] + 1) - (mx + LABEL_OFFSET);
    const roomLeft = mx - LABEL_OFFSET - (dayX(band[0]) + LABEL_HALO / 2 + 2);
    const w = textWidth(label, 11, true);
    const onRight = w <= roomRight || (w > roomLeft && roomRight >= roomLeft);
    const shown = fit(label, Math.max(0, onRight ? roomRight : roomLeft), 11, true);
    if (shown) labels.push(markerLabel(onRight ? mx + LABEL_OFFSET : mx - LABEL_OFFSET, mid + 4.5, shown, onRight ? 'start' : 'end'));
  }
  return { content: out, labels };
}

/** Half-width of a hold / witness / milestone diamond on the Gantt. */
const MARKER_R = 8.5;
/** White halo drawn around label glyphs; it paints over grid, bar edges and the data date line. */
const LABEL_HALO = 4;
/** Clear space kept between a diamond's tip and the outer edge of its label's halo. */
const LABEL_CLEARANCE = 4;
/** Distance from the diamond centre to the label's anchor point, on either side. */
const LABEL_OFFSET = MARKER_R + LABEL_CLEARANCE + LABEL_HALO / 2;

/** A marker label in its own group, drawn in the sheet's top layer. */
function markerLabel(x: number, y: number, s: string, anchor: 'start' | 'end'): string {
  return `<g class="marker-label">${text(x, y, s, { size: 11, weight: 700, halo: true, anchor })}</g>`;
}

interface FooterLayout {
  height: number;
  draw: (x: number, y: number) => string;
}

/** Legend items flow onto as many lines as the sheet width needs; sign-off blocks sit below. */
function layoutFooter(opts: SchedulePrintOptions, w: number, dataDate: IsoDate): FooterLayout {
  type Item = { width: number; draw: (x: number, y: number) => string };
  const label = (s: string, bold = false): Item => ({
    width: textWidth(s, 11, bold) + 6,
    draw: (x, y) => text(x, y + 4, s, { size: 11, weight: bold ? 700 : undefined }),
  });
  const swatch = (svg: (x: number, y: number) => string, s: string): Item => {
    const l = label(s);
    return { width: 34 + l.width, draw: (x, y) => svg(x, y) + l.draw(x + 34, y) };
  };
  const bar = (fill: string, stroke = 1.2) => (x: number, y: number) =>
    `<rect x="${x}" y="${y - 5}" width="28" height="11" fill="${fill}" stroke="${INK}" stroke-width="${stroke}"/>`;
  const sym = (state: Parameters<typeof timesSymbol>[0], s: string): Item => {
    const l = label(s);
    return { width: 20 + l.width, draw: (x, y) => timesSymbol(state, x + 7, y, 6.5) + l.draw(x + 20, y) };
  };
  const lines: Item[][] = [
    [
      swatch(bar(INK), 'Complete'),
      swatch((x, y) => `<rect x="${x}" y="${y - 5}" width="28" height="11" fill="url(#hatch)" stroke="${INK}"/><rect x="${x}" y="${y - 5}" width="12" height="11" fill="${INK}"/>`, 'In progress (filled = % done)'),
      swatch(bar('#fff'), 'Not started'),
      ...(opts.showCriticalPath !== false ? [swatch(bar('#fff', 2.6), 'Critical path (heavy outline)')] : []),
      swatch((x, y) => diamond(x + 14, y, 7.5, true), 'HOLD: no work past this point until released'),
      swatch((x, y) => diamond(x + 14, y, 7.5, false), 'WITNESS'),
      swatch((x, y) => `<line x1="${x + 14}" y1="${y - 8}" x2="${x + 14}" y2="${y + 8}" stroke="${INK}" stroke-width="1.6" stroke-dasharray="4 2"/>`, `Data date (${shortDate(dataDate)})`),
    ],
  ];
  if (opts.showTimes !== false) {
    lines.push([
      label('T Tools · I Information · M Materials · E Expectations · S Safety', true),
      sym('ready', 'Ready / on site / complete'),
      sym('progress', 'In progress / on order'),
      sym('needed', 'Needed, not started'),
      sym('na', 'Not applicable'),
      sym('blocked', 'Blocked or late'),
    ]);
  }
  const GAP = 24;
  const LINE = 20;
  // Flow each group onto lines that fit the width.
  const placed: Array<Array<{ item: Item; x: number }>> = [];
  for (const group of lines) {
    let line: Array<{ item: Item; x: number }> = [];
    let x = 0;
    for (const item of group) {
      if (line.length > 0 && x + item.width > w) {
        placed.push(line);
        line = [];
        x = 0;
      }
      line.push({ item, x });
      x += item.width + GAP;
    }
    placed.push(line);
  }
  const legendH = placed.length * LINE + 8;
  const signH = inch(1.0);
  const revs = newestRevisions(opts.revisions ?? [], 3);
  return {
    height: legendH + signH,
    draw: (x, y) => {
      const out: string[] = [];
      placed.forEach((line, i) => line.forEach(({ item, x: ix }) => out.push(item.draw(x + ix, y + 12 + i * LINE))));
      out.push(hline(x, x + w, y + legendH, GRID_LIGHT));
      const by = y + legendH + 22;
      const half = w / 2;
      if (opts.fieldNotes !== false) {
        out.push(text(x, by, 'FIELD NOTES', { size: 11, weight: 700, ls: 0.6 }));
        for (let i = 0; i < 3; i++) out.push(hline(x, x + half - inch(0.3), by + 20 + i * 20, GRID));
      }
      const signW = Math.min(inch(2.1), half * 0.4);
      const rx = x + half;
      const rw = half - signW - inch(0.25);
      out.push(text(rx, by, 'REVISIONS', { size: 11, weight: 700, ls: 0.6 }));
      out.push(`<rect x="${rx}" y="${by + 8}" width="${rw}" height="${signH - 36}" fill="none" stroke="${INK}" stroke-width="0.8"/>`);
      revs.forEach((r, i) => {
        out.push(
          `<text x="${rx + 9}" y="${by + 25 + i * 16}" font-size="11" fill="${INK}"><tspan font-weight="700">${esc(r.rev)}</tspan> · ${esc(fit(`${shortDate(r.date)} · ${r.note}`, rw - 40, 11))}</text>`,
        );
      });
      const sx = x + w - signW;
      out.push(hline(sx, x + w, by + 52, INK), text(sx, by + 67, 'Reviewed by / date', { size: 11, fill: MUTED }));
      return out.join('');
    },
  };
}

/** The newest `n` revisions (by date; ties keep list order), oldest first. */
export function newestRevisions(revisions: RevisionEntry[], n: number): RevisionEntry[] {
  return revisions
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.date < b.r.date ? -1 : a.r.date > b.r.date ? 1 : a.i - b.i))
    .slice(-n)
    .map(({ r }) => r);
}

function titleSize(pageW: number): number {
  return pageW < inch(12) ? 22 : pageW < inch(20) ? 32 : 40;
}

interface TextOpts {
  size: number;
  weight?: number;
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
  ls?: number;
  /** White outline behind the glyphs so grid lines never run through the text. */
  halo?: boolean;
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
    o.halo ? `stroke="#fff" stroke-width="${LABEL_HALO}" stroke-linejoin="round" paint-order="stroke"` : '',
  ].filter(Boolean);
  return `<text ${attrs.join(' ')}>${esc(s)}</text>`;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const vline = (x: number, y1: number, y2: number, c: string) => `<line x1="${r1(x)}" y1="${r1(y1)}" x2="${r1(x)}" y2="${r1(y2)}" stroke="${c}" stroke-width="1"/>`;
const hline = (x1: number, x2: number, y: number, c: string) => `<line x1="${r1(x1)}" y1="${r1(y)}" x2="${r1(x2)}" y2="${r1(y)}" stroke="${c}" stroke-width="1"/>`;
const arrow = (x: number, y: number, dir: 1 | -1) =>
  `<path d="M${x} ${y - 6} L${x + dir * 9} ${y} L${x} ${y + 6} Z" fill="${INK}"/>`;
