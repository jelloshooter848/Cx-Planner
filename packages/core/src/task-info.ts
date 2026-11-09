import type { Asset, Id, Project, Task } from './model.js';
import type { Template, TemplateTask } from './template.js';

/**
 * Read-only facts about one task for the edit panel and similar views. Nothing here is
 * stored: each answer is worked out from the project and its computed schedule.
 */

/**
 * The first milestone downstream of `taskId`: of the milestones reachable through its
 * successor links (any link type, any depth, not the task itself), the one that starts
 * earliest by `startIndex` (the scheduled working-day index, e.g. ScheduledTask.es).
 * Ties keep project order. Milestones without a scheduled start are skipped. Returns
 * null when nothing downstream is a milestone.
 */
export function firstDownstreamMilestone(project: Project, taskId: Id, startIndex: (id: Id) => number | undefined): Task | null {
  const succs = new Map<Id, Id[]>();
  for (const d of project.dependencies) {
    (succs.get(d.predecessorId) ?? succs.set(d.predecessorId, []).get(d.predecessorId)!).push(d.successorId);
  }
  const seen = new Set<Id>([taskId]);
  const queue = [...(succs.get(taskId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(succs.get(id) ?? []));
  }
  seen.delete(taskId);
  let best: Task | null = null;
  let bestStart = Infinity;
  for (const t of project.tasks) {
    if (t.type !== 'milestone' || !seen.has(t.id)) continue;
    const s = startIndex(t.id);
    if (s === undefined) continue;
    if (s < bestStart) {
      best = t;
      bestStart = s;
    }
  }
  return best;
}

export interface TaskTemplateLink {
  template: Template;
  templateTask: TemplateTask;
}

/**
 * The template task a project task was created from, found through the asset's template
 * id and the task's template key in `templates` (normally the project's own template
 * snapshots, decision D4). Null for tasks added by hand, assets not made from a template,
 * or a template or key that is no longer there.
 */
export function templateTaskFor(templates: readonly Template[], asset: Asset | undefined, task: Task): TaskTemplateLink | null {
  if (!asset?.templateId || !task.templateKey) return null;
  const template = templates.find((t) => t.id === asset.templateId);
  const templateTask = template?.tasks.find((t) => t.key === task.templateKey);
  return template && templateTask ? { template, templateTask } : null;
}
