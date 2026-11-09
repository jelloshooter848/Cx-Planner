/**
 * Layout for the Schedule view's Gantt, as plain functions so it can be unit-tested without
 * a DOM: the row list (asset groups and their tasks), the time scale for each zoom, header
 * ticks, bar geometry, the visible window for virtualized drawing, and keyboard row moves.
 *
 * Time is drawn in calendar days (weekends included, as in the mockup); x = 0 is the start
 * of the scale's first day. A task covers its start day through the end of its finish day.
 */
import { parseIso, formatIso, type Asset, type Id, type IsoDate, type Project, type Task } from '@cx/core';
import type { TaskScheduleSummary } from '../../../shared/api';
import type { ScheduleZoom } from '../../store';

// ---- Rows -----------------------------------------------------------------------------

export interface GroupRow {
  kind: 'group';
  /** Row key, unique in the list. */
  key: string;
  asset: Asset;
  /** 1-based position of the asset in the project, shown in the ID column. */
  number: number;
  /** Span of the asset's scheduled tasks; null when none is scheduled. */
  start: IsoDate | null;
  finish: IsoDate | null;
}

export interface TaskRow {
  kind: 'task';
  key: string;
  task: Task;
  asset: Asset;
}

export type GanttRow = GroupRow | TaskRow;

/**
 * One group row per asset (in project order) followed by its tasks (in project order).
 * `assetIds` limits the list to those assets (the asset filter); null or omitted shows all.
 * Linear in the number of tasks.
 */
export function buildRows(project: Project, schedule: Record<Id, TaskScheduleSummary>, assetIds?: ReadonlySet<Id> | null): GanttRow[] {
  const byAsset = new Map<Id, Task[]>();
  for (const t of project.tasks) {
    const list = byAsset.get(t.assetId);
    if (list) list.push(t);
    else byAsset.set(t.assetId, [t]);
  }
  const rows: GanttRow[] = [];
  project.assets.forEach((asset, i) => {
    if (assetIds && !assetIds.has(asset.id)) return;
    const tasks = byAsset.get(asset.id) ?? [];
    let start: IsoDate | null = null;
    let finish: IsoDate | null = null;
    for (const t of tasks) {
      const s = schedule[t.id];
      if (!s) continue;
      if (start === null || s.start < start) start = s.start;
      if (finish === null || s.finish > finish) finish = s.finish;
    }
    rows.push({ kind: 'group', key: `a:${asset.id}`, asset, number: i + 1, start, finish });
    for (const task of tasks) rows.push({ kind: 'task', key: `t:${task.id}`, task, asset });
  });
  return rows;
}

/** Index of the row showing `taskId`, or -1. */
export function rowIndexOfTask(rows: readonly GanttRow[], taskId: Id | null): number {
  if (!taskId) return -1;
  return rows.findIndex((r) => r.kind === 'task' && r.task.id === taskId);
}

/**
 * The task row reached from `currentId` by a keyboard move, skipping group rows:
 * `delta` rows down (positive) or up (negative), clamped to the first and last task.
 * With nothing selected, any move selects the first task (or the last, for 'end').
 */
export function moveSelection(rows: readonly GanttRow[], currentId: Id | null, move: number | 'home' | 'end'): Id | null {
  const taskRows: number[] = [];
  rows.forEach((r, i) => r.kind === 'task' && taskRows.push(i));
  if (taskRows.length === 0) return null;
  const pick = (i: number) => (rows[taskRows[Math.max(0, Math.min(taskRows.length - 1, i))]!] as TaskRow).task.id;
  if (move === 'home') return pick(0);
  if (move === 'end') return pick(taskRows.length - 1);
  const at = rowIndexOfTask(rows, currentId);
  if (at < 0) return pick(0);
  const pos = taskRows.indexOf(at);
  return pick(pos + move);
}

// ---- Time scale -----------------------------------------------------------------------

/** Pixels per calendar day at each zoom. */
export const DAY_WIDTH: Record<ScheduleZoom, number> = { day: 26, week: 8, month: 3 };

export interface TimeScale {
  zoom: ScheduleZoom;
  dayWidth: number;
  /** Day number (days since 1970-01-01) at x = 0. */
  originDay: number;
  /** Calendar days covered. */
  days: number;
  /** Total width in px. */
  width: number;
}

/** x of the start of `date` (or of a day number). */
export function xOf(scale: TimeScale, date: IsoDate | number): number {
  const day = typeof date === 'number' ? date : parseIso(date);
  return (day - scale.originDay) * scale.dayWidth;
}

/** The date at x (the day that contains it). */
export function dateAtX(scale: TimeScale, x: number): IsoDate {
  return formatIso(scale.originDay + Math.floor(x / scale.dayWidth));
}

function ymd(day: number): [number, number, number] {
  const d = new Date(day * 86_400_000);
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
}

/** Day number of the first of the month `months` after the month containing `day`. */
function monthStart(day: number, months = 0): number {
  const [y, m] = ymd(day);
  return Date.UTC(y, m + months, 1) / 86_400_000;
}

/** Monday on or before `day`. */
function mondayOnOrBefore(day: number): number {
  const wd = new Date(day * 86_400_000).getUTCDay();
  return day - ((wd + 6) % 7);
}

/**
 * The scale for a project: from the Monday (day, week zoom) or the first of the month
 * (month zoom) on or before the earliest of the project start, the data date and any task
 * start, to past the latest finish with some room to spare. It is stretched to at least
 * `minWidth` px so the timeline fills the window.
 */
export function makeScale(project: Project, schedule: Record<Id, TaskScheduleSummary>, zoom: ScheduleZoom, minWidth = 0): TimeScale {
  let first = Math.min(parseIso(project.startDate), parseIso(project.dataDate));
  let last = parseIso(project.dataDate);
  for (const t of project.tasks) {
    const s = schedule[t.id];
    if (!s) continue;
    first = Math.min(first, parseIso(s.start));
    last = Math.max(last, parseIso(s.finish));
  }
  const dayWidth = DAY_WIDTH[zoom];
  let originDay: number;
  let endDay: number; // exclusive
  if (zoom === 'month') {
    originDay = monthStart(first);
    endDay = monthStart(last, 2);
  } else {
    originDay = mondayOnOrBefore(first);
    endDay = mondayOnOrBefore(last) + (zoom === 'week' ? 21 : 14);
  }
  let days = endDay - originDay;
  if (days * dayWidth < minWidth) {
    const step = zoom === 'month' ? 31 : 7;
    days += Math.ceil((minWidth - days * dayWidth) / (step * dayWidth)) * step;
  }
  return { zoom, dayWidth, originDay, days, width: days * dayWidth };
}

// ---- Header ---------------------------------------------------------------------------

export interface Tick {
  x: number;
  width: number;
  label: string;
  /** Short label for when the full one does not fit. */
  short?: string;
}

export interface HeaderTicks {
  /** Upper row: months (day, week zoom) or years (month zoom). */
  top: Tick[];
  /** Lower row: days, weeks or months. Their left edges are the timeline's grid lines. */
  bottom: Tick[];
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function spans(scale: TimeScale, starts: number[], label: (day: number, i: number) => Tick['label'], short?: (day: number) => string): Tick[] {
  const end = scale.originDay + scale.days;
  return starts.map((d, i) => {
    const from = Math.max(d, scale.originDay);
    const to = Math.min(starts[i + 1] ?? end, end);
    return { x: xOf(scale, from), width: (to - from) * scale.dayWidth, label: label(d, i), ...(short ? { short: short(d) } : {}) };
  });
}

function monthStarts(scale: TimeScale): number[] {
  const end = scale.originDay + scale.days;
  const out: number[] = [];
  for (let d = monthStart(scale.originDay); d < end; d = monthStart(d, 1)) out.push(d);
  return out;
}

export function headerTicks(scale: TimeScale): HeaderTicks {
  const end = scale.originDay + scale.days;
  const months = monthStarts(scale);
  if (scale.zoom === 'month') {
    const years = months.filter((d, i) => i === 0 || ymd(d)[1] === 0);
    return {
      top: spans(scale, years, (d) => String(ymd(d)[0])),
      bottom: spans(scale, months, (d) => MONTH_SHORT[ymd(d)[1]]!),
    };
  }
  // Month names in full, with the year on the first month and on every January.
  const top = spans(
    scale,
    months,
    (d, i) => {
      const [y, m] = ymd(d);
      return i === 0 || m === 0 ? `${MONTH_LONG[m]} ${y}` : MONTH_LONG[m]!;
    },
    (d) => MONTH_SHORT[ymd(d)[1]]!,
  );
  const step = scale.zoom === 'week' ? 7 : 1;
  const starts: number[] = [];
  for (let d = scale.originDay; d < end; d += step) starts.push(d);
  const bottom = spans(scale, starts, (d) => {
    const [, m, day] = ymd(d);
    return scale.zoom === 'week' ? `${MONTH_SHORT[m]} ${day}` : String(day);
  });
  return { top, bottom };
}

/** Day numbers of the Saturdays and Sundays in the scale (shaded at day zoom). */
export function weekendDays(scale: TimeScale): number[] {
  const out: number[] = [];
  for (let d = scale.originDay; d < scale.originDay + scale.days; d++) {
    const wd = new Date(d * 86_400_000).getUTCDay();
    if (wd === 0 || wd === 6) out.push(d);
  }
  return out;
}

// ---- Bars -----------------------------------------------------------------------------

export type Progress = 'complete' | 'progress' | 'not-started';

export function progressOf(task: Task): Progress {
  if (task.percentComplete >= 100 || task.actualFinish) return 'complete';
  if (task.percentComplete > 0 || task.actualStart) return 'progress';
  return 'not-started';
}

export interface BarShape {
  /** A bar for work with duration; a diamond for a milestone. */
  kind: 'bar' | 'milestone';
  x0: number;
  /** Equal to x0 for a milestone. */
  x1: number;
  progress: Progress;
  /** 0–100, for the partial fill of an in-progress bar. */
  percent: number;
  critical: boolean;
  /** Holds and witness points get a diamond and a label at the finish. */
  marker: 'hold' | 'witness' | null;
}

export function barShape(task: Task, s: TaskScheduleSummary, scale: TimeScale): BarShape {
  const milestone = task.type === 'milestone' || s.es === s.ef;
  const x0 = xOf(scale, s.start);
  const x1 = milestone ? x0 : xOf(scale, parseIso(s.finish) + 1);
  return {
    kind: milestone ? 'milestone' : 'bar',
    x0,
    x1,
    progress: progressOf(task),
    percent: Math.max(0, Math.min(100, task.percentComplete)),
    critical: s.critical,
    marker: task.type === 'hold' || task.type === 'witness' ? task.type : null,
  };
}

// ---- Virtualization -------------------------------------------------------------------

/** Rows [first, last) to draw for a vertical scroll position, with `overscan` extra rows each side. */
export function visibleRows(scrollTop: number, viewportHeight: number, rowHeight: number, count: number, overscan = 8): [number, number] {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(count, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
  return [first, Math.max(first, last)];
}

/**
 * Horizontal window [x0, x1) of the timeline to draw, given how far it is scrolled past the
 * table (`scrolled`) and how much of it is in view (`visibleWidth`). Snapped outwards to
 * `snap` px so small scrolls redraw nothing.
 */
export function visibleSpan(scrolled: number, visibleWidth: number, totalWidth: number, snap = 400): [number, number] {
  const x0 = Math.max(0, Math.floor((scrolled - snap / 2) / snap) * snap);
  const x1 = Math.min(totalWidth, Math.ceil((scrolled + visibleWidth + snap / 2) / snap) * snap);
  return [x0, Math.max(x0, x1)];
}

/**
 * The scrollTop that brings row `index` fully into view (unchanged when it already is).
 * `headerHeight` is the sticky header covering the top of the viewport.
 */
export function scrollToRow(index: number, scrollTop: number, viewportHeight: number, rowHeight: number, headerHeight: number): number {
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  const visibleTop = scrollTop;
  const visibleBottom = scrollTop + viewportHeight - headerHeight;
  if (top < visibleTop) return top;
  if (bottom > visibleBottom) return bottom - (viewportHeight - headerHeight);
  return scrollTop;
}
