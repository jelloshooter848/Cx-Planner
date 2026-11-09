import type { CalendarDef, IsoDate } from './model.js';

const MS_PER_DAY = 86_400_000;

export function parseIso(date: IsoDate): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY;
}

export function formatIso(dayNumber: number): IsoDate {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);
}

export function weekday(date: IsoDate): number {
  return new Date(parseIso(date) * MS_PER_DAY).getUTCDay();
}

export function addCalendarDays(date: IsoDate, days: number): IsoDate {
  return formatIso(parseIso(date) + days);
}

export const DEFAULT_CALENDAR: CalendarDef = { workWeekdays: [1, 2, 3, 4, 5], holidays: [] };

/**
 * Maps between calendar dates and working-day indexes counted from an origin.
 * Index 0 is the first working day on or after the origin. The scheduler works in
 * indexes; only the edges of the app see dates.
 */
export class WorkCalendar {
  private readonly weekdays: Set<number>;
  private readonly holidays: Set<number>;
  private readonly originDay: number;
  /** days[i] = calendar day number of working day i. Grown on demand. */
  private readonly days: number[] = [];

  constructor(origin: IsoDate, def: CalendarDef = DEFAULT_CALENDAR) {
    if (def.workWeekdays.length === 0) throw new Error('Calendar needs at least one working weekday');
    this.weekdays = new Set(def.workWeekdays);
    this.holidays = new Set(def.holidays.map(parseIso));
    this.originDay = parseIso(origin);
  }

  isWorkday(date: IsoDate): boolean {
    return this.isWorkdayNumber(parseIso(date));
  }

  private isWorkdayNumber(day: number): boolean {
    const wd = new Date(day * MS_PER_DAY).getUTCDay();
    return this.weekdays.has(wd) && !this.holidays.has(day);
  }

  private grow(index: number): void {
    let day = this.days.length === 0 ? this.originDay : this.days[this.days.length - 1]! + 1;
    while (this.days.length <= index) {
      if (this.isWorkdayNumber(day)) this.days.push(day);
      day++;
    }
  }

  /** Date of working day `index`. Negative indexes count back before the origin. */
  dateAt(index: number): IsoDate {
    if (index < 0) {
      let day = this.originDay;
      let remaining = -index;
      while (remaining > 0) {
        day--;
        if (this.isWorkdayNumber(day)) remaining--;
      }
      return formatIso(day);
    }
    this.grow(index);
    return formatIso(this.days[index]!);
  }

  /**
   * Working-day index of `date`. A non-working date maps to the next working day
   * (the moment work could start).
   */
  indexOf(date: IsoDate): number {
    const target = parseIso(date);
    if (target < this.originDay) {
      let idx = 0;
      for (let day = this.originDay - 1; day >= target; day--) if (this.isWorkdayNumber(day)) idx--;
      return idx;
    }
    // Binary search the grown table, growing as needed.
    while (this.days.length === 0 || this.days[this.days.length - 1]! < target) {
      this.grow(Math.max(16, this.days.length * 2));
    }
    let lo = 0;
    let hi = this.days.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.days[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Working days from a to b (b exclusive). */
  workdaysBetween(a: IsoDate, b: IsoDate): number {
    return this.indexOf(b) - this.indexOf(a);
  }
}
