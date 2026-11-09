import { addCalendarDays, weekday, type IsoDate } from '@cx/core';
import { longDate, shortDate } from './text.js';

/** Inclusive date window of a look-ahead print. */
export interface LookAheadWindow {
  start: IsoDate;
  end: IsoDate;
}

/** Anything that can say whether a date is worked, e.g. a `WorkCalendar`. */
export interface WorkdayCalendar {
  isWorkday(date: IsoDate): boolean;
}

/**
 * The window a `weeks`-week look-ahead covers: from the Monday of the week holding the data
 * date (weeks run Monday to Sunday) to the Friday of the last week.
 *
 * Holidays on the edges are trimmed so the window starts and ends on working days: a Monday
 * holiday moves the start to the next working day of that week, and a Friday holiday pulls the
 * end back to the last working day of that week. An edge week with no working days at all keeps
 * its plain Monday/Friday.
 */
export function lookAheadWindow(dataDate: IsoDate, weeks: number, calendar: WorkdayCalendar): LookAheadWindow {
  if (!Number.isInteger(weeks) || weeks < 1) throw new Error(`Look-ahead needs a whole number of weeks ≥ 1, got ${weeks}`);
  const monday = addCalendarDays(dataDate, -((weekday(dataDate) + 6) % 7));
  const friday = addCalendarDays(monday, (weeks - 1) * 7 + 4);
  let start = monday;
  for (let i = 0; i < 5; i++) {
    const d = addCalendarDays(monday, i);
    if (calendar.isWorkday(d)) {
      start = d;
      break;
    }
  }
  let end = friday;
  for (let i = 0; i < 5; i++) {
    const d = addCalendarDays(friday, -i);
    if (calendar.isWorkday(d)) {
      end = d;
      break;
    }
  }
  return { start, end };
}

/**
 * A date range for a sheet title, e.g. "Nov 2 – Nov 20, 2026". The year is written once when
 * both ends share it, on both ends otherwise ("Dec 28, 2026 – Jan 15, 2027").
 */
export function formatDateRange(range: LookAheadWindow): string {
  const sameYear = range.start.slice(0, 4) === range.end.slice(0, 4);
  return sameYear ? `${shortDate(range.start)} – ${longDate(range.end)}` : `${longDate(range.start)} – ${longDate(range.end)}`;
}

/**
 * Sheet title for a look-ahead, e.g. "3-Week Look-Ahead: Nov 2 – Nov 20, 2026"
 * (dates as in formatDateRange).
 */
export function lookAheadTitle(window: LookAheadWindow, weeks: number): string {
  return `${weeks}-Week Look-Ahead: ${formatDateRange(window)}`;
}

/**
 * Sheet title for the full schedule, with the date range of the printed tasks, e.g.
 * "Full Commissioning Schedule: Nov 2, 2026 – Jan 20, 2027". No range (nothing to print)
 * leaves the bare title.
 */
export function fullScheduleTitle(range: LookAheadWindow | null): string {
  return range ? `Full Commissioning Schedule: ${formatDateRange(range)}` : 'Full Commissioning Schedule';
}
