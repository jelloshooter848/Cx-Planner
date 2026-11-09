import { formatIso, parseIso } from './calendar.js';
import type { Command, TaskPatch } from './commands.js';
import type { Id, IsoDate, Project, Task } from './model.js';

/**
 * Progress entry rules: how a change to a task's % complete or actual dates fills in or
 * clears the other progress fields. The task panel and the grid's progress mode both ask
 * `planProgress` what an edit means, then send the resulting patch as one `updateTask`
 * command, so the whole change is one undo step and one change-log entry.
 *
 * The rules:
 * - Setting 100% needs an actual finish. When the change does not bring one, the answer is
 *   `needs-finish` with a default (the data date) for the UI to ask about.
 * - Setting an actual finish sets 100%.
 * - Any progress (% > 0 or an actual finish) needs an actual start. When there is none it
 *   defaults to the computed start, no later than the data date or the actual finish (the
 *   data date when the task has no computed schedule). A milestone's start defaults to its
 *   finish.
 * - An actual finish before the actual start is refused.
 * - Lowering % below 100 reopens a finished task: its actual finish is cleared.
 * - Clearing the actual start resets the task to not started: % goes to 0 and the actual
 *   finish is cleared.
 * - Clearing the actual finish of a 100% task is refused; lower % complete instead.
 * - A milestone is either 0% or 100%. Setting a milestone to 0% clears both actual dates.
 * - Actual dates after the data date are allowed (docs/DECISIONS.md D14).
 */

/** The progress fields an edit sets. `null` clears an actual date; a missing key leaves it alone. */
export interface ProgressChange {
  percentComplete?: number;
  actualStart?: IsoDate | null;
  actualFinish?: IsoDate | null;
}

export interface ProgressContext {
  /** The project's data date: the default actual finish. */
  dataDate: IsoDate;
  /** The task's computed start (ScheduledTask.start), the default actual start; null when the schedule cannot be computed. */
  computedStart?: IsoDate | null;
}

export type ProgressErrorCode =
  | 'invalid-percent'
  | 'invalid-date'
  | 'finish-before-start'
  | 'finish-below-100'
  | 'milestone-percent'
  | 'clear-finish-at-100';

export type ProgressOutcome =
  /** The patch to send (only the fields that change; empty when nothing changes). */
  | { kind: 'patch'; patch: TaskPatch }
  /**
   * 100% was asked for without an actual finish: ask for one (default `finish`) and, when
   * `start` is not null, for the actual start too (the task has none yet). Then call
   * `planProgress` again with both in the change.
   */
  | { kind: 'needs-finish'; finish: IsoDate; start: IsoDate | null }
  | { kind: 'error'; code: ProgressErrorCode; message: string };

type ProgressTask = Pick<Task, 'type' | 'percentComplete' | 'actualStart' | 'actualFinish'>;

function isIsoDate(d: unknown): d is IsoDate {
  if (typeof d !== 'string') return false;
  try {
    return formatIso(parseIso(d)) === d;
  } catch {
    return false;
  }
}

const err = (code: ProgressErrorCode, message: string): ProgressOutcome => ({ kind: 'error', code, message });
const minDate = (a: IsoDate, b: IsoDate): IsoDate => (a < b ? a : b);

/** The actual start to fill in for a task that has progress but no actual start. */
export function defaultActualStart(task: Pick<Task, 'type'>, ctx: ProgressContext, finish: IsoDate | null): IsoDate {
  if (finish && task.type === 'milestone') return finish;
  // Progress is reported as of the data date, so the work started no later than that,
  // even when the schedule has the task starting after it.
  const start = minDate(ctx.computedStart ?? ctx.dataDate, ctx.dataDate);
  return finish ? minDate(start, finish) : start;
}

/** The actual finish to offer when a task is marked 100%: the data date, or the actual start if that is later. */
export function defaultActualFinish(task: Pick<Task, 'actualStart'>, ctx: ProgressContext): IsoDate {
  return task.actualStart && task.actualStart > ctx.dataDate ? task.actualStart : ctx.dataDate;
}

/** Works out what a progress edit means for the task. Pure; see the rules above. */
export function planProgress(task: ProgressTask, change: ProgressChange, ctx: ProgressContext): ProgressOutcome {
  const { percentComplete: p, actualStart: s, actualFinish: f } = change;
  if (p !== undefined && (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 100)) {
    return err('invalid-percent', '% complete must be between 0 and 100');
  }
  if (s != null && !isIsoDate(s)) return err('invalid-date', `Actual start "${String(s)}" is not a valid date`);
  if (f != null && !isIsoDate(f)) return err('invalid-date', `Actual finish "${String(f)}" is not a valid date`);
  if (f != null && p !== undefined && p < 100) return err('finish-below-100', 'A task with an actual finish is 100% complete');

  let pct = task.percentComplete;
  let start: IsoDate | null = task.actualStart ?? null;
  let finish: IsoDate | null = task.actualFinish ?? null;

  if (p !== undefined) {
    pct = p;
    if (p < 100 && f === undefined) finish = null;
    // A milestone at 0% has not happened: it has no actual start either.
    if (p === 0 && task.type === 'milestone' && s === undefined) start = null;
  }
  if (s !== undefined) {
    start = s;
    if (s === null) {
      finish = null;
      if (p === undefined) pct = 0;
    }
  }
  if (f !== undefined) {
    if (f === null) {
      if (pct >= 100 && p === undefined) {
        return err('clear-finish-at-100', 'The task is 100% complete, so it needs an actual finish. Lower % complete to reopen it.');
      }
      finish = null;
    } else {
      finish = f;
      pct = 100;
    }
  }

  if (task.type === 'milestone' && pct > 0 && pct < 100) {
    return err('milestone-percent', 'A milestone is either 0% or 100% complete');
  }
  if (pct >= 100 && finish === null) {
    const defaultFinish = defaultActualFinish({ actualStart: start ?? undefined }, ctx);
    return {
      kind: 'needs-finish',
      finish: defaultFinish,
      start: start === null && task.type !== 'milestone' ? defaultActualStart(task, ctx, defaultFinish) : null,
    };
  }
  if ((pct > 0 || finish !== null) && start === null) start = defaultActualStart(task, ctx, finish);
  if (start !== null && finish !== null && finish < start) {
    return err('finish-before-start', `Actual finish (${finish}) cannot be before the actual start (${start})`);
  }

  const patch: TaskPatch = {};
  if (pct !== task.percentComplete) patch.percentComplete = pct;
  if (start !== (task.actualStart ?? null)) patch.actualStart = start;
  if (finish !== (task.actualFinish ?? null)) patch.actualFinish = finish;
  return { kind: 'patch', patch };
}

/** The `updateTask` command for a planned progress patch, or null when it changes nothing. */
export function progressCommand(taskId: Id, patch: TaskPatch): Command | null {
  return Object.keys(patch).length === 0 ? null : { kind: 'updateTask', id: taskId, patch };
}

/**
 * Percent complete of a set of tasks, weighted by duration: a 4-day task at 50% counts as
 * much as two 2-day tasks at 50%. When every task is 0 days long (milestones, holds), each
 * counts equally. Returns 0 for no tasks. Not rounded.
 */
export function weightedPercent(tasks: readonly Pick<Task, 'durationDays' | 'percentComplete'>[]): number {
  if (tasks.length === 0) return 0;
  let days = 0;
  let done = 0;
  for (const t of tasks) {
    const d = Math.max(0, t.durationDays);
    days += d;
    done += d * clampPercent(t.percentComplete);
  }
  if (days > 0) return done / days;
  return tasks.reduce((n, t) => n + clampPercent(t.percentComplete), 0) / tasks.length;
}

/** Duration-weighted percent complete of every asset of the project (0 for an asset with no tasks). */
export function assetProgress(project: Pick<Project, 'assets' | 'tasks'>): Map<Id, number> {
  const byAsset = new Map<Id, Task[]>(project.assets.map((a) => [a.id, []]));
  for (const t of project.tasks) byAsset.get(t.assetId)?.push(t);
  return new Map([...byAsset].map(([id, tasks]) => [id, weightedPercent(tasks)]));
}

function clampPercent(p: number): number {
  return Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0;
}
