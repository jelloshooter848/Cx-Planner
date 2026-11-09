/**
 * Reading and writing the task panel's text fields. Pure functions, unit-tested in
 * test/task-fields.test.ts; TaskPanel.tsx and the grid's inline editors use them.
 */
import { firstDownstreamMilestone, formatIso, parseIso, type Id, type IsoDate, type Project, type Task, type TaskType } from '@cx/core';
import type { TaskScheduleSummary } from '../../../shared/api';
import { shortDate } from '../../format';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** A whole number in [min, max]. A trailing unit ("4 d", "4 days", "50%") is allowed. */
export function parseWholeNumber(text: string, what: string, min: number, max = Infinity, unit: RegExp = /^$/): Parsed<number> {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(.*?)\s*$/.exec(text);
  if (!m || !unit.test(m[2]!)) return fail(`${what} must be a whole number`);
  const n = Number(m[1]);
  if (!Number.isInteger(n)) return fail(`${what} must be a whole number`);
  if (n < min || n > max) return fail(max === Infinity ? `${what} must be ${min} or more` : `${what} must be between ${min} and ${max}`);
  return { ok: true, value: n };
}

/** Duration field: working days, 0 or more ("4", "4d", "4 days"). */
export const parseDuration = (text: string) => parseWholeNumber(text, 'Duration', 0, 10_000, /^(d|days?)?$/i);
/** % complete field: 0 to 100 ("50", "50%"). */
export const parsePercent = (text: string) => parseWholeNumber(text, '% complete', 0, 100, /^%?$/);

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function makeDate(y: number, m: number, d: number): IsoDate | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // Reject days past the end of the month (2026-02-30), which parseIso would roll over.
  return formatIso(parseIso(iso)) === iso ? iso : null;
}

/**
 * A month and day with no year: the year (that of `ref`, the one before or the one after)
 * that puts the date closest to `ref`, so "Jan 4" typed against Dec 28 means the coming January.
 */
function nearestDate(m: number, d: number, ref: IsoDate): IsoDate | null {
  const refYear = Number(ref.slice(0, 4));
  const refDay = parseIso(ref);
  let best: IsoDate | null = null;
  let bestGap = Infinity;
  for (const y of [refYear, refYear - 1, refYear + 1]) {
    const date = makeDate(y, m, d);
    if (!date) continue;
    const gap = Math.abs(parseIso(date) - refDay);
    if (gap < bestGap) {
      best = date;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * A date typed in the Start field: "2026-11-10", "Nov 10", "Nov 10, 2026", "November 10 2026",
 * "11/10" or "11/10/2026" (month first). Without a year, the date nearest `ref` is used.
 */
export function parseDateInput(text: string, ref: IsoDate): Parsed<IsoDate> {
  const t = text.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  const bad = fail(`"${text.trim()}" is not a date; write e.g. ${shortDate(ref)} or ${ref}`);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return wrap(makeDate(Number(m[1]), Number(m[2]), Number(m[3])), bad);
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(t);
  if (m) {
    if (m[3] === undefined) return wrap(nearestDate(Number(m[1]), Number(m[2]), ref), bad);
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return wrap(makeDate(y, Number(m[1]), Number(m[2])), bad);
  }
  m = /^([a-z]{3,9})\.? (\d{1,2})(?: (\d{4}))?$/.exec(t);
  if (m) {
    const word = m[1]!;
    const month = MONTHS.findIndex((name) => name.startsWith(word)) + 1;
    if (month === 0) return bad;
    const day = Number(m[2]);
    return wrap(m[3] === undefined ? nearestDate(month, day, ref) : makeDate(Number(m[3]), month, day), bad);
  }
  return bad;
}

/** An actual-date cell or field: a date (see parseDateInput), or empty / "—" / "-" to clear it (null). */
export function parseActualDate(text: string, ref: IsoDate): Parsed<IsoDate | null> {
  const t = text.trim();
  if (t === '' || t === '—' || t === '-') return { ok: true, value: null };
  return parseDateInput(t, ref);
}

function wrap(date: IsoDate | null, bad: { ok: false; error: string }): Parsed<IsoDate> {
  return date ? { ok: true, value: date } : bad;
}

export const TASK_TYPE_LABELS: Record<TaskType, string> = { task: 'Task', hold: 'Hold', witness: 'Witness', milestone: 'Milestone' };

/**
 * The patch for changing a task's type. Milestones take no time, so becoming one sets the
 * duration to 0; a milestone that becomes something else gets 1 day so its bar shows.
 */
export function typeChangePatch(task: Pick<Task, 'type' | 'durationDays'>, type: TaskType): { type: TaskType; durationDays?: number } {
  if (type === 'milestone' && task.durationDays !== 0) return { type, durationDays: 0 };
  if (task.type === 'milestone' && type !== 'milestone' && task.durationDays === 0) return { type, durationDays: 1 };
  return { type };
}

/** "Energization" -> "energization", but "ATS cutover" stays as written. */
function inSentence(name: string): string {
  return /^[A-Z][a-z]/.test(name) ? name[0]!.toLowerCase() + name.slice(1) : name;
}

const days = (n: number) => `${n} ${Math.abs(n) === 1 ? 'day' : 'days'}`;

export type FloatNote =
  | { kind: 'critical'; float: number; text: string }
  | { kind: 'float'; float: number; text: string }
  | { kind: 'done'; text: string };

/**
 * The float line under the panel's fields. Critical tasks get the callout of 01-Main:
 * "Critical path. 0 days of float. A slip here moves energization on Nov 18." naming the
 * first milestone downstream (with its asset tag when it is another asset's), or the
 * project finish when no milestone follows. Null when the task has no computed schedule.
 */
export function floatNote(
  project: Project,
  task: Task,
  schedule: Record<Id, TaskScheduleSummary>,
  projectFinish: IsoDate | null,
): FloatNote | null {
  const s = schedule[task.id];
  if (!s) return null;
  if (task.actualFinish || task.percentComplete >= 100) return { kind: 'done', text: 'Complete.' };
  if (!s.critical) return { kind: 'float', float: s.totalFloat, text: `Float: ${days(s.totalFloat)}` };
  const m = firstDownstreamMilestone(project, task.id, (id) => schedule[id]?.es);
  const ms = m ? schedule[m.id] : undefined;
  let moves: string;
  if (m && ms) {
    const tag = m.assetId !== task.assetId ? project.assets.find((a) => a.id === m.assetId)?.tag : undefined;
    moves = `${tag ? `${tag} ` : ''}${inSentence(m.name)} on ${shortDate(ms.start)}`;
  } else {
    moves = projectFinish ? `the project finish on ${shortDate(projectFinish)}` : 'the project finish';
  }
  return { kind: 'critical', float: s.totalFloat, text: `${days(s.totalFloat)} of float. A slip here moves ${moves}.` };
}
