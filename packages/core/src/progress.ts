import type { Id, Project, Task } from './model.js';

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
