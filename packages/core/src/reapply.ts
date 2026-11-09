import type { Asset, Dependency, DependencyType, Id, Project, Task } from './model.js';
import { TemplateInvalidError, validateTemplate, type Template, type TemplateTask } from './template.js';

/**
 * Re-applying a template to assets that were already created from it (decision D4: the
 * project holds a snapshot, so bringing a changed template in is an explicit action).
 *
 * Tasks are matched to template tasks by `templateKey`. The rules:
 * - Progress is never lost. A task with an actual start, an actual finish or any percent
 *   complete is never removed; when its template task is gone it stays and is reported
 *   as a conflict. Actual dates, percent complete, readiness, notes and start-no-earlier
 *   dates are never touched.
 * - Matched tasks take the template's name, type, duration and responsible trade.
 *   Checklists, test forms, certifications and notice lead times are not copied onto
 *   tasks: they are read from the template snapshot by key, so they follow the asset's
 *   new template id and version.
 * - Template tasks the asset lacks are added in template order, each placed after the
 *   asset's task for the nearest earlier template task.
 * - Tasks whose key is no longer in the template and that have no progress are deleted,
 *   with their links.
 * - Links between two template tasks of the same asset are rebuilt from the template
 *   (added, changed or removed). Links touching user-added tasks (no key, or a key the
 *   template does not have) and links to tasks of other assets are kept as they are.
 *
 * `planReapply` describes the change for a preview; `reapplyTemplate` makes it. The edit
 * command is `reapplyTemplate` in commands.ts, which also renumbers codes and checks for
 * loops.
 */

export type ReapplyField = 'name' | 'type' | 'durationDays' | 'responsible';

export interface ReapplyFieldChange {
  field: ReapplyField;
  /** Undefined when the task had no value (only possible for responsible). */
  from: string | number | undefined;
  to: string | number;
}

/** A template link, by template task key. */
export interface ReapplyLink {
  predecessorKey: string;
  successorKey: string;
  type: DependencyType;
  lagDays: number;
}

export interface ReapplyAssetPlan {
  assetId: Id;
  /** Template tasks the asset does not have yet, in template order. */
  added: TemplateTask[];
  /** Matched tasks whose template-driven fields change. */
  updated: { taskId: Id; changes: ReapplyFieldChange[] }[];
  /** Tasks deleted because the template no longer has them and they have no progress. */
  removed: { taskId: Id; reason: string }[];
  /** Tasks left as they are although the template disagrees, with the reason. */
  conflicts: { taskId: Id; message: string }[];
  /** Changes to links between the asset's template tasks. */
  links: {
    added: ReapplyLink[];
    changed: { predecessorId: Id; successorId: Id; type: DependencyType; lagDays: number }[];
    /** Template links the template no longer has. Links of removed tasks are not listed. */
    removed: Dependency[];
  };
  /** True when the asset's template id or version changes. */
  versionChanged: boolean;
}

/** True when re-applying would change nothing on the asset. */
export function isEmptyReapplyPlan(p: ReapplyAssetPlan): boolean {
  return (
    !p.versionChanged &&
    p.added.length === 0 &&
    p.updated.length === 0 &&
    p.removed.length === 0 &&
    p.links.added.length === 0 &&
    p.links.changed.length === 0 &&
    p.links.removed.length === 0
  );
}

/** A task with any recorded progress. */
export function hasProgress(t: Task): boolean {
  return t.actualStart !== undefined || t.actualFinish !== undefined || t.percentComplete > 0;
}

export class UnknownAssetError extends Error {
  constructor(public readonly assetId: Id) {
    super(`No asset with id "${assetId}"`);
    this.name = 'UnknownAssetError';
  }
}

/**
 * Works out what re-applying `template` to each listed asset would do, one plan per
 * asset in the order given (an id listed twice is planned once). Throws TemplateInvalidError when the template has problems
 * and UnknownAssetError for an asset id the project does not have.
 */
export function planReapply(project: Project, assetIds: Id[], template: Template): ReapplyAssetPlan[] {
  const problems = validateTemplate(template);
  if (problems.length > 0) throw new TemplateInvalidError(problems);
  return [...new Set(assetIds)].map((id) => {
    const asset = project.assets.find((a) => a.id === id);
    if (!asset) throw new UnknownAssetError(id);
    return planAsset(project, asset, template);
  });
}

function planAsset(project: Project, asset: Asset, template: Template): ReapplyAssetPlan {
  const byKey = new Map(template.tasks.map((t) => [t.key, t]));
  const assetTasks = project.tasks.filter((t) => t.assetId === asset.id);
  const matched = matchTasks(assetTasks, byKey);

  const plan: ReapplyAssetPlan = {
    assetId: asset.id,
    added: [],
    updated: [],
    removed: [],
    conflicts: [],
    links: { added: [], changed: [], removed: [] },
    versionChanged: asset.templateId !== template.id || asset.templateVersion !== template.version,
  };

  for (const task of assetTasks) {
    const key = task.templateKey;
    if (key === undefined) continue; // Added by the user; left alone.
    const tt = byKey.get(key);
    if (tt) {
      if (matched.get(key) !== task) {
        plan.conflicts.push({
          taskId: task.id,
          message: `${task.code} ${task.name} uses template step "${key}" as well as ${matched.get(key)!.code}; it was left as it is`,
        });
        continue;
      }
      const changes = fieldChanges(task, tt);
      if (changes.length > 0) plan.updated.push({ taskId: task.id, changes });
    } else if (hasProgress(task)) {
      plan.conflicts.push({
        taskId: task.id,
        message: `${task.code} ${task.name} is no longer in ${template.name} but has progress, so it was kept`,
      });
    } else {
      plan.removed.push({ taskId: task.id, reason: `No longer in ${template.name}` });
    }
  }

  plan.added = template.tasks.filter((t) => !matched.has(t.key));

  // Links between the asset's template tasks follow the template.
  const keyOf = new Map<Id, string>();
  for (const [key, task] of matched) keyOf.set(task.id, key);
  const wanted = new Map<string, ReapplyLink>();
  for (const tt of template.tasks) {
    for (const p of tt.predecessors) {
      wanted.set(linkKey(p.key, tt.key), { predecessorKey: p.key, successorKey: tt.key, type: p.type, lagDays: p.lagDays });
    }
  }
  const present = new Set<string>();
  for (const d of project.dependencies) {
    const pk = keyOf.get(d.predecessorId);
    const sk = keyOf.get(d.successorId);
    if (pk === undefined || sk === undefined) continue;
    const k = linkKey(pk, sk);
    const w = wanted.get(k);
    if (!w || present.has(k)) {
      plan.links.removed.push(d);
      continue;
    }
    present.add(k);
    if (w.type !== d.type || w.lagDays !== d.lagDays) {
      plan.links.changed.push({ predecessorId: d.predecessorId, successorId: d.successorId, type: w.type, lagDays: w.lagDays });
    }
  }
  for (const [k, w] of wanted) if (!present.has(k)) plan.links.added.push(w);
  return plan;
}

/** The first task of the asset for each template key the template has. */
function matchTasks(assetTasks: Task[], byKey: Map<string, TemplateTask>): Map<string, Task> {
  const matched = new Map<string, Task>();
  for (const t of assetTasks) {
    if (t.templateKey !== undefined && byKey.has(t.templateKey) && !matched.has(t.templateKey)) {
      matched.set(t.templateKey, t);
    }
  }
  return matched;
}

function fieldChanges(task: Task, tt: TemplateTask): ReapplyFieldChange[] {
  const changes: ReapplyFieldChange[] = [];
  if (task.name !== tt.name) changes.push({ field: 'name', from: task.name, to: tt.name });
  if (task.type !== tt.type) changes.push({ field: 'type', from: task.type, to: tt.type });
  if (task.durationDays !== tt.durationDays) changes.push({ field: 'durationDays', from: task.durationDays, to: tt.durationDays });
  if (task.responsible !== tt.trade) changes.push({ field: 'responsible', from: task.responsible, to: tt.trade });
  return changes;
}

function linkKey(pred: string, succ: string): string {
  return JSON.stringify([pred, succ]);
}

export interface ReapplyResult {
  /** New tasks have an empty code; renumber the assets' groups afterwards. */
  project: Project;
  plans: ReapplyAssetPlan[];
}

/**
 * Re-applies `template` to the listed assets and returns the new project (the input is
 * not changed) with the plan that was carried out. New task ids are
 * "<asset id>:<template key>", made unique with a "-2", "-3" ... suffix when taken.
 * Throws like `planReapply`.
 */
export function reapplyTemplate(project: Project, assetIds: Id[], template: Template): ReapplyResult {
  const plans = planReapply(project, assetIds, template);
  const byKey = new Map(template.tasks.map((t) => [t.key, t]));
  const usedIds = new Set(project.tasks.map((t) => t.id));

  let assets = project.assets;
  let tasks = project.tasks;
  let dependencies = project.dependencies;

  for (const plan of plans) {
    const asset = assets.find((a) => a.id === plan.assetId)!;
    if (plan.versionChanged) {
      assets = assets.map((a) => (a === asset ? { ...a, templateId: template.id, templateVersion: template.version } : a));
    }

    // Removed tasks and their links.
    const removed = new Set(plan.removed.map((r) => r.taskId));
    if (removed.size > 0) {
      tasks = tasks.filter((t) => !removed.has(t.id));
      dependencies = dependencies.filter((d) => !removed.has(d.predecessorId) && !removed.has(d.successorId));
    }

    // Field updates.
    const updates = new Map(plan.updated.map((u) => [u.taskId, u.changes]));
    if (updates.size > 0) {
      tasks = tasks.map((t) => {
        const changes = updates.get(t.id);
        if (!changes) return t;
        const next = { ...t } as Record<string, unknown>;
        for (const c of changes) next[c.field] = c.to;
        return next as unknown as Task;
      });
    }

    // New tasks, in template order, after the asset's task for the nearest earlier template task.
    const idOfKey = new Map<string, Id>();
    for (const [key, t] of matchTasks(tasks.filter((t) => t.assetId === asset.id), byKey)) idOfKey.set(key, t.id);
    const addedKeys = new Set(plan.added.map((t) => t.key));
    if (addedKeys.size > 0) {
      const snet = tasks.find((t) => t.assetId === asset.id && t.templateKey !== undefined && t.startNoEarlierThan !== undefined)
        ?.startNoEarlierThan;
      const work = [...tasks];
      let previous: Id | undefined;
      for (const tt of template.tasks) {
        if (!addedKeys.has(tt.key)) {
          previous = idOfKey.get(tt.key) ?? previous;
          continue;
        }
        const id = uniqueId(`${asset.id}:${tt.key}`, usedIds);
        usedIds.add(id);
        idOfKey.set(tt.key, id);
        const task: Task = {
          id,
          assetId: asset.id,
          code: '',
          name: tt.name,
          type: tt.type,
          durationDays: tt.durationDays,
          percentComplete: 0,
          responsible: tt.trade,
          templateKey: tt.key,
        };
        // Like instantiateTemplate: hold back tasks nothing else holds back.
        if (snet !== undefined && !tt.predecessors.some((p) => (p.type === 'FS' || p.type === 'SS') && p.lagDays >= 0)) {
          task.startNoEarlierThan = snet;
        }
        const at = previous !== undefined ? work.findIndex((t) => t.id === previous) + 1 : firstIndexOfAsset(project, work, asset.id);
        work.splice(at, 0, task);
        previous = id;
      }
      tasks = work;
    }

    // Links between template tasks.
    const droppedLinks = new Set(plan.links.removed);
    const changed = new Map(plan.links.changed.map((c) => [linkKey(c.predecessorId, c.successorId), c]));
    if (droppedLinks.size > 0 || changed.size > 0) {
      dependencies = dependencies
        .filter((d) => !droppedLinks.has(d))
        .map((d) => {
          const c = changed.get(linkKey(d.predecessorId, d.successorId));
          return c ? { ...d, type: c.type, lagDays: c.lagDays } : d;
        });
    }
    if (plan.links.added.length > 0) {
      dependencies = [
        ...dependencies,
        ...plan.links.added.map((l) => ({
          predecessorId: idOfKey.get(l.predecessorKey)!,
          successorId: idOfKey.get(l.successorKey)!,
          type: l.type,
          lagDays: l.lagDays,
        })),
      ];
    }
  }

  return { project: { ...project, assets, tasks, dependencies }, plans };
}

/**
 * Where an asset's first task goes: before its first existing task, or after the tasks
 * of the assets listed before it when it has none.
 */
function firstIndexOfAsset(project: Project, tasks: Task[], assetId: Id): number {
  const first = tasks.findIndex((t) => t.assetId === assetId);
  if (first >= 0) return first;
  const order = new Map(project.assets.map((a, i) => [a.id, i]));
  const mine = order.get(assetId)!;
  let at = 0;
  tasks.forEach((t, i) => {
    const o = order.get(t.assetId);
    if (o !== undefined && o < mine) at = i + 1;
  });
  return at;
}

function uniqueId(base: string, used: Set<Id>): Id {
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
