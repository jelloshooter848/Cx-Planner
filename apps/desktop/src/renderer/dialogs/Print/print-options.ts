/**
 * The Print dialog's settings as plain data, and the request each kind of print sends to the
 * main process. Kept free of React so it can be unit-tested.
 */
import { addCalendarDays, weekday, type Id, type IsoDate } from '@cx/core';
import type { FullSchedulePrintRequest, LookAheadPrintRequest, LookAheadWeeks, PrintKind, PrintRequest } from '../../../shared/api';
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

export function defaultSettings(dataDate: IsoDate, checklistTaskIds: Id[], hasFilter: boolean): PrintSettings {
  const assets: AssetScope = hasFilter ? 'filter' : 'all';
  return {
    lookAhead: { paper: 'tabloid', weeks: 3, start: mondayOf(dataDate), assets, showTimes: true },
    fullSchedule: { paper: 'ansi-d', dayWidthIn: 0.42, assets },
    testSheets: { taskIds: checklistTaskIds },
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
