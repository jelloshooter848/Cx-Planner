import { computeSchedule } from './schedule.js';
import type { Asset, Dependency, DependencyType, Id, IsoDate, Task, TaskType } from './model.js';

/**
 * A reusable plan for one kind of asset: its tasks, links, test-sheet checklists and
 * turnover documents. The library lives in the workspace; applying a template copies a
 * snapshot into the project (decision D4), so instantiated tasks only remember the
 * template id, version and each task's key.
 */
export interface Template {
  id: Id;
  name: string;
  /** Bumped on every saved change. Assets record the version they were created from. */
  version: number;
  kind: 'starter' | 'custom';
  /** What the template is for, e.g. "Low-voltage switchgear lineup". */
  assetDescription: string;
  /** Install stages in order, e.g. Delivered, Set, Terminated, Tested, Energized, Turned over. */
  stages: string[];
  /** In display order. Instantiated task codes follow this order. */
  tasks: TemplateTask[];
  /** Turnover documents each asset needs. */
  requiredDocs: string[];
}

export interface TemplatePredecessor {
  /** Key of another task in the same template. */
  key: string;
  type: DependencyType;
  /** Working days; may be negative (lead). */
  lagDays: number;
}

export interface ChecklistItem {
  id: string;
  /** One line on the printed test sheet. */
  text: string;
}

export interface TemplateTask {
  /** Stable within the template; survives renames and reordering. */
  key: string;
  name: string;
  /** Working days. Milestones are 0. */
  durationDays: number;
  type: TaskType;
  /** Responsible role, e.g. "Electrical", "Test tech", "Cx agent". */
  trade: string;
  predecessors: TemplatePredecessor[];
  /** Items on the printed test sheet. */
  checklist: ChecklistItem[];
  /** Test or form type, e.g. "Insulation resistance". */
  testForm?: string;
  /** Certifications the assigned person must hold. */
  requiredCerts: string[];
  /** Working days of notice an inspection needs (holds and witness points). */
  noticeLeadDays?: number;
}

export type TemplateProblemCode =
  | 'duplicate-key'
  | 'empty-key'
  | 'unknown-predecessor'
  | 'self-predecessor'
  | 'duplicate-predecessor'
  | 'cycle'
  | 'negative-duration'
  | 'invalid-duration'
  | 'milestone-duration'
  | 'invalid-lag'
  | 'negative-notice'
  | 'duplicate-checklist-id'
  | 'invalid-version';

export interface TemplateProblem {
  code: TemplateProblemCode;
  /** Plain-language description for the template editor. */
  message: string;
  /** The task the problem belongs to, when there is one. */
  taskKey?: string;
}

/** Lists everything wrong with a template. An empty list means it can be instantiated. */
export function validateTemplate(t: Template): TemplateProblem[] {
  const problems: TemplateProblem[] = [];
  if (!Number.isInteger(t.version) || t.version < 1) {
    problems.push({ code: 'invalid-version', message: `Template version must be a whole number of 1 or more, got ${t.version}` });
  }

  const keys = new Set<string>();
  for (const task of t.tasks) {
    if (task.key.trim() === '') {
      problems.push({ code: 'empty-key', message: `Task "${task.name}" has no key`, taskKey: task.key });
    } else if (keys.has(task.key)) {
      problems.push({ code: 'duplicate-key', message: `Task key "${task.key}" is used more than once`, taskKey: task.key });
    }
    keys.add(task.key);
  }

  for (const task of t.tasks) {
    const label = `"${task.name}"`;
    if (!Number.isFinite(task.durationDays)) {
      problems.push({ code: 'invalid-duration', message: `${label} has no valid duration`, taskKey: task.key });
    } else if (task.durationDays < 0) {
      problems.push({ code: 'negative-duration', message: `${label} has a negative duration`, taskKey: task.key });
    } else if (!Number.isInteger(task.durationDays)) {
      problems.push({ code: 'invalid-duration', message: `${label} duration must be whole working days`, taskKey: task.key });
    }
    if (task.type === 'milestone' && task.durationDays > 0) {
      problems.push({ code: 'milestone-duration', message: `${label} is a milestone but lasts ${task.durationDays} days`, taskKey: task.key });
    }
    if (task.noticeLeadDays !== undefined && !(task.noticeLeadDays >= 0)) {
      problems.push({ code: 'negative-notice', message: `${label} has a negative notice lead time`, taskKey: task.key });
    }
    const seenPreds = new Set<string>();
    for (const p of task.predecessors) {
      if (p.key === task.key) {
        problems.push({ code: 'self-predecessor', message: `${label} cannot follow itself`, taskKey: task.key });
      } else if (!keys.has(p.key)) {
        problems.push({ code: 'unknown-predecessor', message: `${label} follows unknown task "${p.key}"`, taskKey: task.key });
      } else if (seenPreds.has(p.key)) {
        problems.push({ code: 'duplicate-predecessor', message: `${label} lists "${p.key}" as a predecessor more than once`, taskKey: task.key });
      }
      seenPreds.add(p.key);
      if (!Number.isInteger(p.lagDays)) {
        problems.push({ code: 'invalid-lag', message: `${label} lag on "${p.key}" must be whole working days`, taskKey: task.key });
      }
    }
    const checklistIds = new Set<string>();
    for (const item of task.checklist) {
      if (checklistIds.has(item.id)) {
        problems.push({ code: 'duplicate-checklist-id', message: `${label} checklist item id "${item.id}" is used more than once`, taskKey: task.key });
      }
      checklistIds.add(item.id);
    }
  }

  const cycle = findCycleKeys(t.tasks);
  if (cycle.length > 0) {
    problems.push({ code: 'cycle', message: `Predecessor loop between tasks: ${cycle.join(', ')}` });
  }
  return problems;
}

/**
 * Keys of tasks caught in (or downstream of) a predecessor loop, in template order.
 * Self-links and unknown keys are reported separately and ignored here.
 */
function findCycleKeys(tasks: TemplateTask[]): string[] {
  const keys = new Set(tasks.map((t) => t.key));
  const indegree = new Map<string, number>([...keys].map((k) => [k, 0]));
  const out = new Map<string, string[]>();
  for (const task of tasks) {
    for (const p of new Set(task.predecessors.map((x) => x.key))) {
      if (p === task.key || !keys.has(p)) continue;
      indegree.set(task.key, (indegree.get(task.key) ?? 0) + 1);
      const list = out.get(p) ?? [];
      list.push(task.key);
      out.set(p, list);
    }
  }
  const ready = [...keys].filter((k) => indegree.get(k) === 0);
  while (ready.length > 0) {
    const k = ready.pop()!;
    for (const s of out.get(k) ?? []) {
      const n = indegree.get(s)! - 1;
      indegree.set(s, n);
      if (n === 0) ready.push(s);
    }
  }
  return [...keys].filter((k) => indegree.get(k)! > 0);
}

export class TemplateInvalidError extends Error {
  constructor(public readonly problems: TemplateProblem[]) {
    super(`Template is not valid: ${problems.map((p) => p.message).join('; ')}`);
    this.name = 'TemplateInvalidError';
  }
}

export interface InstantiateInput {
  /** The new asset. Its template id and version are filled in from the template. */
  asset: Omit<Asset, 'templateId' | 'templateVersion'>;
  /** Group number in the schedule; task codes become "<groupNumber>.<n>". */
  groupNumber: number;
  /** Applied to the template's starting tasks (those with no predecessors). */
  startNoEarlierThan?: IsoDate;
}

export interface InstantiatedAsset {
  asset: Asset;
  /** In template order. */
  tasks: Task[];
  dependencies: Dependency[];
}

/**
 * Creates one asset's tasks and links from a template. `makeId` is called once per
 * template task key and must return a project-unique task id.
 * Throws TemplateInvalidError when the template has problems.
 */
export function instantiateTemplate(
  template: Template,
  input: InstantiateInput,
  makeId: (key: string) => Id,
): InstantiatedAsset {
  const problems = validateTemplate(template);
  if (problems.length > 0) throw new TemplateInvalidError(problems);

  const asset: Asset = { ...input.asset, templateId: template.id, templateVersion: template.version };
  const ids = new Map<string, Id>();
  for (const tt of template.tasks) ids.set(tt.key, makeId(tt.key));

  const tasks: Task[] = template.tasks.map((tt, i) => {
    const task: Task = {
      id: ids.get(tt.key)!,
      assetId: asset.id,
      code: `${input.groupNumber}.${i + 1}`,
      name: tt.name,
      type: tt.type,
      durationDays: tt.durationDays,
      percentComplete: 0,
      responsible: tt.trade,
      templateKey: tt.key,
    };
    if (input.startNoEarlierThan !== undefined && tt.predecessors.length === 0) {
      task.startNoEarlierThan = input.startNoEarlierThan;
    }
    return task;
  });

  const dependencies: Dependency[] = template.tasks.flatMap((tt) =>
    tt.predecessors.map((p) => ({
      predecessorId: ids.get(p.key)!,
      successorId: ids.get(tt.key)!,
      type: p.type,
      lagDays: p.lagDays,
    })),
  );

  return { asset, tasks, dependencies };
}

/**
 * Working days from the start of the first task to the finish of the last when the
 * template is laid out on its own (the "12 working days" in the template editor).
 * Throws TemplateInvalidError when the template has problems.
 */
export function templateSpanDays(template: Template): number {
  if (template.tasks.length === 0) return 0;
  const origin = '2001-01-01'; // A Monday; any date works with a plain Monday-Friday calendar.
  const { asset, tasks, dependencies } = instantiateTemplate(
    template,
    { asset: { id: '_', tag: '_', description: '' }, groupNumber: 1 },
    (key) => key,
  );
  const r = computeSchedule({
    id: '_', name: '_', startDate: origin, dataDate: origin,
    calendar: { workWeekdays: [1, 2, 3, 4, 5], holidays: [] },
    assets: [asset], tasks, dependencies,
  });
  const starts = [...r.tasks.values()].map((t) => t.es);
  return r.projectFinishIndex - Math.min(...starts);
}
