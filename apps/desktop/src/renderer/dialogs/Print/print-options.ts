/**
 * The Print dialog's settings as plain data, and the request each kind of print sends to the
 * main process. Kept free of React so it can be unit-tested.
 */
import { addCalendarDays, weekday, WorkCalendar, type Id, type IsoDate, type Project, type Task } from '@cx/core';
import { lookAheadWindow, type LookAheadWindow } from '@cx/render';
import type { FullSchedulePrintRequest, LookAheadPrintRequest, LookAheadWeeks, PrintKind, PrintRequest, TaskScheduleSummary } from '../../../shared/api';
import { longDate } from '../../format';

/** Which assets a schedule print covers: every asset, or the schedule's asset filter. */
export type AssetScope = 'all' | 'filter';

export interface PrintSettings {
  lookAhead: { paper: LookAheadPrintRequest['paper']; weeks: LookAheadWeeks; start: IsoDate; assets: AssetScope; showTimes: boolean };
  fullSchedule: { paper: FullSchedulePrintRequest['paper']; dayWidthIn: number | null; assets: AssetScope };
  /** Tasks chosen for test sheets. */
  testSheets: { taskIds: Id[] };
  /** Note for the revision being issued (one per dialog, whatever the kind). */
  note: string;
}

export const KIND_LABELS: Record<PrintKind, string> = {
  lookahead: 'Look-ahead',
  'full-schedule': 'Full schedule',
  'test-sheets': 'Test sheets',
};

/** Day widths offered for the full schedule; null fits the schedule to the sheet width. */
export const DAY_WIDTHS: ReadonlyArray<readonly [number | null, string]> = [
  [null, 'Fit to sheet width'],
  [0.25, '0.25 in (compact)'],
  [0.33, '0.33 in'],
  [0.42, '0.42 in (standard)'],
  [0.5, '0.5 in'],
  [0.75, '0.75 in (wide)'],
];

/** The Monday of the week holding `date` (weeks run Monday to Sunday). */
export function mondayOf(date: IsoDate): IsoDate {
  return addCalendarDays(date, -((weekday(date) + 6) % 7));
}

/**
 * Weeks a look-ahead can start on: from `before` weeks before the data-date week to `after`
 * weeks after it, as [Monday, label]. The data-date week is marked.
 */
export function lookAheadStarts(dataDate: IsoDate, before = 4, after = 12): Array<[IsoDate, string]> {
  const base = mondayOf(dataDate);
  const out: Array<[IsoDate, string]> = [];
  for (let i = -before; i <= after; i++) {
    const monday = addCalendarDays(base, i * 7);
    out.push([monday, `Week of ${longDate(monday)}${i === 0 ? ' (data date)' : ''}`]);
  }
  return out;
}

/**
 * The look-ahead window shaded on the Schedule and printed by default: `weeks` weeks from the
 * data-date week, on the project's calendar. Null when it cannot be worked out.
 */
export function currentLookAheadWindow(project: Pick<Project, 'dataDate' | 'startDate' | 'calendar'>, weeks: number): LookAheadWindow | null {
  try {
    return lookAheadWindow(project.dataDate, weeks, new WorkCalendar(project.startDate, project.calendar));
  } catch {
    return null;
  }
}

/** A task is complete once it has an actual finish or is at 100 %. */
export function isTaskComplete(task: Pick<Task, 'percentComplete' | 'actualFinish'>): boolean {
  return task.percentComplete >= 100 || task.actualFinish !== undefined;
}

/** Quick selections offered above the test-sheet task list; each replaces the selection. */
export type TestSheetQuickSelect = 'window' | 'filter' | 'open' | 'all' | 'none';

export const TEST_SHEET_QUICK_SELECTS: ReadonlyArray<readonly [TestSheetQuickSelect, string]> = [
  ['window', 'In look-ahead window'],
  ['filter', 'Current asset filter'],
  ['open', 'Not complete'],
  ['all', 'All'],
  ['none', 'Clear'],
];

export interface TestSheetContext {
  project: Pick<Project, 'tasks'>;
  /** Computed dates per task id (AppState.schedule). */
  schedule: Readonly<Record<Id, Pick<TaskScheduleSummary, 'start' | 'finish'>>>;
  /** The current look-ahead window, or null when there is none. */
  window: LookAheadWindow | null;
  /** The schedule's asset filter, or null when none is set. */
  filter: readonly Id[] | null;
}

/**
 * Tasks with checklists (`checklistTaskIds`, in schedule order) that a quick selection picks:
 * - window: not complete, with a scheduled start inside the look-ahead window (both ends included)
 * - filter: on an asset in the asset filter (nothing when no filter is set)
 * - open: not complete
 * - all / none: every task / no task
 * Tasks missing from the project are dropped; a task with no computed dates is never "in window".
 */
export function selectTestSheetTasks(rule: TestSheetQuickSelect, checklistTaskIds: readonly Id[], ctx: TestSheetContext): Id[] {
  const byId = new Map(ctx.project.tasks.map((t) => [t.id, t]));
  const tasks = checklistTaskIds.map((id) => byId.get(id)).filter((t): t is Task => t !== undefined);
  const inFilter = ctx.filter ? new Set(ctx.filter) : null;
  const pick = (t: Task): boolean => {
    switch (rule) {
      case 'window': {
        const s = ctx.schedule[t.id];
        return !isTaskComplete(t) && ctx.window !== null && s !== undefined && s.start >= ctx.window.start && s.start <= ctx.window.end;
      }
      case 'filter':
        return inFilter !== null && inFilter.has(t.assetId);
      case 'open':
        return !isTaskComplete(t);
      case 'all':
        return true;
      case 'none':
        return false;
    }
  };
  return tasks.filter(pick).map((t) => t.id);
}

/** Default test-sheet selection: the incomplete tasks that start in the look-ahead window. */
export function defaultTestSheetTasks(checklistTaskIds: readonly Id[], ctx: Omit<TestSheetContext, 'filter'>): Id[] {
  return selectTestSheetTasks('window', checklistTaskIds, { ...ctx, filter: null });
}

/**
 * The dialog's starting settings; `weeks` is the look-ahead length (default 3) and
 * `testSheetTaskIds` the tasks ticked for test sheets (see defaultTestSheetTasks).
 */
export function defaultSettings(dataDate: IsoDate, testSheetTaskIds: Id[], hasFilter: boolean, weeks: LookAheadWeeks = 3): PrintSettings {
  const assets: AssetScope = hasFilter ? 'filter' : 'all';
  return {
    lookAhead: { paper: 'tabloid', weeks, start: mondayOf(dataDate), assets, showTimes: true },
    fullSchedule: { paper: 'ansi-d', dayWidthIn: 0.42, assets },
    testSheets: { taskIds: testSheetTaskIds },
    note: '',
  };
}

/** The request for `kind`. `filter` is the schedule's asset filter (null when none is set). */
export function printRequest(kind: PrintKind, s: PrintSettings, filter: Id[] | null): PrintRequest {
  const scope = (a: AssetScope) => (a === 'filter' && filter ? filter : null);
  switch (kind) {
    case 'lookahead':
      return { kind, paper: s.lookAhead.paper, weeks: s.lookAhead.weeks, start: s.lookAhead.start, assetIds: scope(s.lookAhead.assets), showTimes: s.lookAhead.showTimes, note: s.note };
    case 'full-schedule':
      return { kind, paper: s.fullSchedule.paper, dayWidthIn: s.fullSchedule.dayWidthIn, assetIds: scope(s.fullSchedule.assets), note: s.note };
    case 'test-sheets':
      return { kind, taskIds: s.testSheets.taskIds, note: s.note };
  }
}

/** Fits a sheet of `w` × `h` px into a box, never enlarging it. */
export function fitScale(w: number, h: number, boxW: number, boxH: number): number {
  if (w <= 0 || h <= 0 || boxW <= 0 || boxH <= 0) return 1;
  return Math.min(1, boxW / w, boxH / h);
}
