import { WorkCalendar } from './calendar.js';
import type { Dependency, Id, IsoDate, Project, Task } from './model.js';

/**
 * Scheduled times are working-day indexes from the project start.
 * A task occupies days [es, ef): it starts at the beginning of day `es`
 * and finishes at the end of day `ef - 1`. Milestones have es === ef.
 */
export interface ScheduledTask {
  id: Id;
  es: number;
  ef: number;
  ls: number;
  lf: number;
  /** Total float in working days. */
  totalFloat: number;
  critical: boolean;
  start: IsoDate;
  /** Last working day of the task (inclusive). Equal to start for milestones. */
  finish: IsoDate;
}

export interface ScheduleResult {
  calendar: WorkCalendar;
  tasks: Map<Id, ScheduledTask>;
  /** Working-day index at which the last task finishes. */
  projectFinishIndex: number;
  projectFinish: IsoDate;
  dataDateIndex: number;
}

export class ScheduleCycleError extends Error {
  constructor(public readonly taskIds: Id[]) {
    super(`Dependency loop between tasks: ${taskIds.join(', ')}`);
    this.name = 'ScheduleCycleError';
  }
}

export function topologicalOrder(tasks: Task[], deps: Dependency[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const indegree = new Map<Id, number>(tasks.map((t) => [t.id, 0]));
  const out = new Map<Id, Id[]>();
  for (const d of deps) {
    if (!byId.has(d.predecessorId) || !byId.has(d.successorId)) {
      throw new Error(`Dependency ${d.predecessorId} -> ${d.successorId} names an unknown task`);
    }
    indegree.set(d.successorId, indegree.get(d.successorId)! + 1);
    (out.get(d.predecessorId) ?? out.set(d.predecessorId, []).get(d.predecessorId)!).push(d.successorId);
  }
  // Keep input order among ready tasks so results are stable.
  const ready = tasks.filter((t) => indegree.get(t.id) === 0).map((t) => t.id);
  const order: Task[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(byId.get(id)!);
    for (const s of out.get(id) ?? []) {
      const n = indegree.get(s)! - 1;
      indegree.set(s, n);
      if (n === 0) ready.push(s);
    }
  }
  if (order.length !== tasks.length) {
    throw new ScheduleCycleError(tasks.filter((t) => indegree.get(t.id)! > 0).map((t) => t.id));
  }
  return order;
}

function remainingDays(t: Task): number {
  return Math.ceil(t.durationDays * (1 - clampPct(t.percentComplete) / 100));
}

function clampPct(p: number): number {
  return Math.min(100, Math.max(0, p));
}

/**
 * Critical path method: forward pass for early dates, backward pass for late dates.
 * Progress is honoured: finished tasks are pinned to their actual dates, started tasks
 * keep their actual start and finish their remaining work from the data date, and
 * unstarted work cannot be scheduled before the data date.
 */
export function computeSchedule(project: Project): ScheduleResult {
  const cal = new WorkCalendar(project.startDate, project.calendar);
  const dataIdx = cal.indexOf(project.dataDate);
  const order = topologicalOrder(project.tasks, project.dependencies);
  const preds = new Map<Id, Dependency[]>();
  const succs = new Map<Id, Dependency[]>();
  for (const d of project.dependencies) {
    (preds.get(d.successorId) ?? preds.set(d.successorId, []).get(d.successorId)!).push(d);
    (succs.get(d.predecessorId) ?? succs.set(d.predecessorId, []).get(d.predecessorId)!).push(d);
  }
  const es = new Map<Id, number>();
  const ef = new Map<Id, number>();

  for (const t of order) {
    const dur = t.durationDays;
    if (t.actualStart) {
      const s = cal.indexOf(t.actualStart);
      es.set(t.id, s);
      if (t.actualFinish) {
        ef.set(t.id, dur === 0 ? s : cal.indexOf(t.actualFinish) + 1);
      } else {
        ef.set(t.id, Math.max(s + dur, dataIdx + remainingDays(t)));
      }
      continue;
    }
    let start = Math.max(0, dataIdx);
    if (t.startNoEarlierThan) start = Math.max(start, cal.indexOf(t.startNoEarlierThan));
    for (const d of preds.get(t.id) ?? []) {
      const pEs = es.get(d.predecessorId)!;
      const pEf = ef.get(d.predecessorId)!;
      switch (d.type) {
        case 'FS': start = Math.max(start, pEf + d.lagDays); break;
        case 'SS': start = Math.max(start, pEs + d.lagDays); break;
        case 'FF': start = Math.max(start, pEf + d.lagDays - dur); break;
        case 'SF': start = Math.max(start, pEs + d.lagDays - dur); break;
      }
    }
    es.set(t.id, start);
    ef.set(t.id, start + dur);
  }

  const finishIdx = Math.max(0, ...ef.values());
  const ls = new Map<Id, number>();
  const lf = new Map<Id, number>();
  for (const t of [...order].reverse()) {
    const dur = t.durationDays;
    let late = finishIdx;
    for (const d of succs.get(t.id) ?? []) {
      const sLs = ls.get(d.successorId)!;
      const sLf = lf.get(d.successorId)!;
      switch (d.type) {
        case 'FS': late = Math.min(late, sLs - d.lagDays); break;
        case 'SS': late = Math.min(late, sLs - d.lagDays + dur); break;
        case 'FF': late = Math.min(late, sLf - d.lagDays); break;
        case 'SF': late = Math.min(late, sLf - d.lagDays + dur); break;
      }
    }
    lf.set(t.id, late);
    ls.set(t.id, late - dur);
  }

  const result = new Map<Id, ScheduledTask>();
  for (const t of project.tasks) {
    const e = es.get(t.id)!;
    const f = ef.get(t.id)!;
    const l = ls.get(t.id)!;
    const totalFloat = l - e;
    const done = clampPct(t.percentComplete) >= 100 || !!t.actualFinish;
    result.set(t.id, {
      id: t.id,
      es: e,
      ef: f,
      ls: l,
      lf: lf.get(t.id)!,
      totalFloat,
      critical: !done && totalFloat <= 0,
      start: cal.dateAt(e),
      finish: cal.dateAt(f > e ? f - 1 : e),
    });
  }
  return {
    calendar: cal,
    tasks: result,
    projectFinishIndex: finishIdx,
    projectFinish: cal.dateAt(Math.max(0, finishIdx - 1)),
    dataDateIndex: dataIdx,
  };
}
