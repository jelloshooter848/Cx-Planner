import { formatIso, parseIso } from './calendar.js';
import type { IsoDate } from './model.js';

/**
 * US federal holidays, for the "add US federal holidays" helper in Project settings.
 * Pure date arithmetic, no time zones: dates are ISO calendar dates.
 */

export interface Holiday {
  /** The day off: the holiday itself, or the weekday it is observed on. */
  date: IsoDate;
  name: string;
  /** The holiday's own date, when it is observed on another day (it fell on a weekend). */
  actual?: IsoDate;
}

const MS_PER_DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number): IsoDate => `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
const dow = (date: IsoDate) => new Date(parseIso(date) * MS_PER_DAY).getUTCDay();

/** The nth (1-based) weekday (0 = Sunday) of a month; n = -1 means the last one. */
export function nthWeekday(year: number, month: number, weekday: number, n: number): IsoDate {
  if (n === -1) {
    const nextMonth = month === 12 ? iso(year + 1, 1, 1) : iso(year, month + 1, 1);
    const last = parseIso(nextMonth) - 1;
    const back = (dow(formatIso(last)) - weekday + 7) % 7;
    return formatIso(last - back);
  }
  const first = iso(year, month, 1);
  const ahead = (weekday - dow(first) + 7) % 7;
  return formatIso(parseIso(first) + ahead + (n - 1) * 7);
}

/**
 * The weekday a fixed-date federal holiday is observed on: a Saturday holiday is observed
 * the Friday before, a Sunday holiday the Monday after (5 U.S.C. 6103 and the OPM rule).
 */
export function observedDate(date: IsoDate): IsoDate {
  const wd = dow(date);
  if (wd === 6) return formatIso(parseIso(date) - 1);
  if (wd === 0) return formatIso(parseIso(date) + 1);
  return date;
}

/** Every federal holiday whose own date is in `year`, with its observed date. */
function holidaysOf(year: number): Holiday[] {
  const fixed = (m: number, d: number, name: string): Holiday => {
    const actual = iso(year, m, d);
    const date = observedDate(actual);
    return date === actual ? { date, name } : { date, name, actual };
  };
  const list: Holiday[] = [
    fixed(1, 1, "New Year's Day"),
    { date: nthWeekday(year, 1, 1, 3), name: 'Birthday of Martin Luther King, Jr.' },
    { date: nthWeekday(year, 2, 1, 3), name: "Washington's Birthday" },
    { date: nthWeekday(year, 5, 1, -1), name: 'Memorial Day' },
  ];
  if (year >= 2021) list.push(fixed(6, 19, 'Juneteenth National Independence Day'));
  list.push(
    fixed(7, 4, 'Independence Day'),
    { date: nthWeekday(year, 9, 1, 1), name: 'Labor Day' },
    { date: nthWeekday(year, 10, 1, 2), name: 'Columbus Day' },
    fixed(11, 11, 'Veterans Day'),
    { date: nthWeekday(year, 11, 4, 4), name: 'Thanksgiving Day' },
    fixed(12, 25, 'Christmas Day'),
  );
  return list;
}

/** Years the helper covers (the current Monday-holiday rules date from 1971). */
export const FEDERAL_HOLIDAY_YEARS = { min: 1971, max: 9998 } as const;

/**
 * The US federal holidays observed in calendar year `year`, in date order: the days off
 * that fall in that year. When New Year's Day falls on a Saturday it is observed on
 * December 31 of the year before, so that day belongs to the earlier year's list (e.g.
 * 2027 includes Fri 2027-12-31 for New Year's Day 2028, and 2028 has no New Year's day off).
 */
export function usFederalHolidays(year: number): Holiday[] {
  if (!Number.isInteger(year) || year < FEDERAL_HOLIDAY_YEARS.min || year > FEDERAL_HOLIDAY_YEARS.max) {
    throw new RangeError(`Federal holidays are available for ${FEDERAL_HOLIDAY_YEARS.min} to ${FEDERAL_HOLIDAY_YEARS.max}`);
  }
  const prefix = `${String(year).padStart(4, '0')}-`;
  return [...holidaysOf(year), ...holidaysOf(year + 1).slice(0, 1)].filter((h) => h.date.startsWith(prefix)).sort((a, b) => a.date.localeCompare(b.date));
}

/** The name of the US federal holiday observed on `date`, or null. */
export function federalHolidayName(date: IsoDate): string | null {
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(date);
  const year = m ? Number(m[1]) : NaN;
  if (!(year >= FEDERAL_HOLIDAY_YEARS.min && year <= FEDERAL_HOLIDAY_YEARS.max)) return null;
  return usFederalHolidays(year).find((h) => h.date === date)?.name ?? null;
}

/** `holidays` with `add` merged in: no duplicates, in date order. */
export function mergeHolidays(holidays: readonly IsoDate[], add: readonly IsoDate[]): IsoDate[] {
  return [...new Set([...holidays, ...add])].sort();
}
