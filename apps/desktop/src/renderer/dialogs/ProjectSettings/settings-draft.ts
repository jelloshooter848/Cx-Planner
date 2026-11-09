/**
 * The Project settings dialog's form state and the edit it turns into. Kept free of React
 * so it can be unit-tested.
 */
import {
  federalHolidayName,
  mergeHolidays,
  parseIso,
  usFederalHolidays,
  weekday,
  type CalendarDef,
  type Command,
  type IsoDate,
  type Project,
} from '@cx/core';

export interface SettingsDraft {
  name: string;
  subtitle: string;
  startDate: IsoDate;
  /** 0 = Sunday ... 6 = Saturday, sorted. */
  workWeekdays: number[];
  /** Sorted, no duplicates. */
  holidays: IsoDate[];
}

/** Weekday checkboxes in the order shown (Monday first), with 0 = Sunday numbering. */
export const WEEKDAYS: readonly { day: number; short: string; long: string }[] = [
  { day: 1, short: 'Mon', long: 'Monday' },
  { day: 2, short: 'Tue', long: 'Tuesday' },
  { day: 3, short: 'Wed', long: 'Wednesday' },
  { day: 4, short: 'Thu', long: 'Thursday' },
  { day: 5, short: 'Fri', long: 'Friday' },
  { day: 6, short: 'Sat', long: 'Saturday' },
  { day: 0, short: 'Sun', long: 'Sunday' },
];

export function draftFrom(project: Project): SettingsDraft {
  return {
    name: project.name,
    subtitle: project.subtitle ?? '',
    startDate: project.startDate,
    workWeekdays: [...project.calendar.workWeekdays].sort((a, b) => a - b),
    holidays: mergeHolidays(project.calendar.holidays, []),
  };
}

export function toggleWeekday(draft: SettingsDraft, day: number, on: boolean): SettingsDraft {
  const set = new Set(draft.workWeekdays);
  if (on) set.add(day);
  else set.delete(day);
  return { ...draft, workWeekdays: [...set].sort((a, b) => a - b) };
}

export const isIsoDate = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  try {
    // Rejects dates like 2026-02-30 that Date.UTC would roll over.
    return new Date(parseIso(s) * 86_400_000).toISOString().slice(0, 10) === s;
  } catch {
    return false;
  }
};

export function addHolidays(draft: SettingsDraft, dates: readonly IsoDate[]): SettingsDraft {
  return { ...draft, holidays: mergeHolidays(draft.holidays, dates) };
}

export function removeHoliday(draft: SettingsDraft, date: IsoDate): SettingsDraft {
  return { ...draft, holidays: draft.holidays.filter((d) => d !== date) };
}

/** The federal holidays of `year` the draft does not have yet. */
export function missingFederalHolidays(draft: SettingsDraft, year: number): IsoDate[] {
  const have = new Set(draft.holidays);
  return usFederalHolidays(year)
    .map((h) => h.date)
    .filter((d) => !have.has(d));
}

/** Years offered by the federal-holiday helper: the start year and the next few. */
export function holidayYears(startDate: IsoDate, count = 4): number[] {
  const y = Number(startDate.slice(0, 4));
  const first = Number.isInteger(y) && y >= 1971 && y <= 9990 ? y : new Date().getFullYear();
  return Array.from({ length: count }, (_, i) => first + i);
}

export interface HolidayRow {
  date: IsoDate;
  /** The US federal holiday observed that day, if any. */
  name: string | null;
  /** True when the date is not a working weekday anyway (the holiday changes nothing). */
  offDay: boolean;
  /** True when the stored text is not a real date (a damaged file); the row can still be removed. */
  invalid: boolean;
}

/** One row per holiday. A malformed stored date gives an `invalid` row rather than throwing. */
export function holidayRows(draft: SettingsDraft): HolidayRow[] {
  const work = new Set(draft.workWeekdays);
  return draft.holidays.map((date) =>
    isIsoDate(date)
      ? { date, name: federalHolidayName(date), offDay: !work.has(weekday(date)), invalid: false }
      : { date, name: null, offDay: false, invalid: true },
  );
}

/** Why the draft cannot be saved, or null. */
export function draftProblem(draft: SettingsDraft): string | null {
  if (draft.name.trim() === '') return 'The project needs a name.';
  if (!isIsoDate(draft.startDate)) return 'Enter a start date.';
  if (draft.workWeekdays.length === 0) return 'Choose at least one working day.';
  return null;
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Whether the draft differs from `project` at all, even in ways that cannot be saved yet
 * (an emptied name, a cleared start date): what Cancel asks about before discarding.
 */
export function draftChanged(project: Project, draft: SettingsDraft): boolean {
  const before = draftFrom(project);
  return (
    draft.name.trim() !== project.name.trim() ||
    draft.subtitle.trim() !== before.subtitle.trim() ||
    draft.startDate !== project.startDate ||
    !sameList(
      [...draft.workWeekdays].sort((a, b) => a - b),
      before.workWeekdays,
    ) ||
    !sameList(mergeHolidays(draft.holidays, []), before.holidays)
  );
}

/**
 * The edit that turns `project` into the draft: updateProjectInfo for changed fields,
 * setCalendar when the calendar changed, both in one batch (one undo step) when both
 * changed. Null when nothing changed. An empty subtitle clears it.
 */
export function settingsCommand(project: Project, draft: SettingsDraft): Command | null {
  const before = draftFrom(project);
  const info: Extract<Command, { kind: 'updateProjectInfo' }> = { kind: 'updateProjectInfo' };
  const name = draft.name.trim();
  if (name !== project.name) info.name = name;
  const subtitle = draft.subtitle.trim();
  // Compared trimmed on both sides, so stray spaces in a stored subtitle are not a change.
  if (subtitle !== before.subtitle.trim()) info.subtitle = subtitle === '' ? null : subtitle;
  if (draft.startDate !== project.startDate) info.startDate = draft.startDate;
  const commands: Command[] = [];
  if (Object.keys(info).length > 1) commands.push(info);
  const calendar: CalendarDef = {
    workWeekdays: [...draft.workWeekdays].sort((a, b) => a - b),
    holidays: mergeHolidays(draft.holidays, []),
  };
  if (!sameList(calendar.workWeekdays, before.workWeekdays) || !sameList(calendar.holidays, before.holidays))
    commands.push({ kind: 'setCalendar', calendar });
  if (commands.length === 0) return null;
  if (commands.length === 1) return commands[0]!;
  return { kind: 'batch', commands, summary: 'Changed project settings' };
}
