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
  /**
   * What counts as a pass, e.g. "Per mfr. torque table". Printed in the test sheet's
   * Acceptance column. Optional; absent (not empty) when there is none.
   */
  acceptance?: string;
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
  | 'invalid-notice'
  | 'duplicate-checklist-id'
  | 'invalid-version'
  /** Passed validation but could not be scheduled (reported by previewTemplate only). */
  | 'unschedulable';

export interface TemplateProblem {
  code: TemplateProblemCode;
  /** Plain-language description for the template editor. */
  message: string;
  /** The task the problem belongs to, when there is one. */
  taskKey?: string;
}

/**
 * Lists everything wrong with a template. An empty list means it can be instantiated.
 * Expects a value of the Template shape (strings, numbers and arrays where the type says
 * so); data read from a template file must have its shape checked before it gets here.
 */
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
    if (task.noticeLeadDays !== undefined) {
      if (!Number.isFinite(task.noticeLeadDays)) {
        problems.push({ code: 'invalid-notice', message: `${label} has no valid notice lead time`, taskKey: task.key });
      } else if (task.noticeLeadDays < 0) {
        problems.push({ code: 'negative-notice', message: `${label} has a negative notice lead time`, taskKey: task.key });
      } else if (!Number.isInteger(task.noticeLeadDays)) {
        problems.push({ code: 'invalid-notice', message: `${label} notice lead time must be whole working days`, taskKey: task.key });
      }
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
 * Keys of tasks that are part of a predecessor loop (a strongly connected group of two
 * or more tasks), in template order. Tasks that merely follow a loop are not included.
 * Self-links and unknown keys are reported separately and ignored here.
 */
function findCycleKeys(tasks: TemplateTask[]): string[] {
  const keys = new Set(tasks.map((t) => t.key));
  const out = new Map<string, string[]>();
  for (const task of tasks) {
    for (const p of new Set(task.predecessors.map((x) => x.key))) {
      if (p === task.key || !keys.has(p)) continue;
      const list = out.get(p) ?? [];
      list.push(task.key);
      out.set(p, list);
    }
  }

  // Tarjan's strongly connected components, iterative so long chains cannot overflow the stack.
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const inLoop = new Set<string>();
  let next = 0;
  for (const root of keys) {
    if (index.has(root)) continue;
    const work: { key: string; i: number }[] = [{ key: root, i: 0 }];
    index.set(root, next); low.set(root, next); next++;
    stack.push(root); onStack.add(root);
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const succ = out.get(frame.key) ?? [];
      if (frame.i < succ.length) {
        const s = succ[frame.i++]!;
        if (!index.has(s)) {
          index.set(s, next); low.set(s, next); next++;
          stack.push(s); onStack.add(s);
          work.push({ key: s, i: 0 });
        } else if (onStack.has(s)) {
          low.set(frame.key, Math.min(low.get(frame.key)!, index.get(s)!));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.key, Math.min(low.get(parent.key)!, low.get(frame.key)!));
      if (low.get(frame.key) === index.get(frame.key)) {
        const component: string[] = [];
        let k: string;
        do {
          k = stack.pop()!;
          onStack.delete(k);
          component.push(k);
        } while (k !== frame.key);
        if (component.length > 1) for (const c of component) inLoop.add(c);
      }
    }
  }
  return [...keys].filter((k) => inLoop.has(k));
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
  /** Group number in the schedule (a whole number of 1 or more); task codes become "<groupNumber>.<n>". */
  groupNumber: number;
  /**
   * Applied to every task that nothing else holds back to this date: tasks with no
   * predecessors, and tasks whose links are all finish-to-finish, start-to-finish or
   * negative-lag, which could otherwise be scheduled before it.
   */
  startNoEarlierThan?: IsoDate;
  // Follow-ups for the add-assets dialog (mockup 05): an "After task" link from an
  // existing project task to the new tasks, and an option to leave out hold and witness
  // tasks with their links bridged across. Neither is supported here yet.
}

export interface InstantiatedAsset {
  asset: Asset;
  /** In template order. */
  tasks: Task[];
  dependencies: Dependency[];
}

/**
 * A link that, with a non-negative lag, keeps its successor from starting before its
 * predecessor starts. Start-no-earlier-than on the chain's first task then carries through.
 */
function holdsStartBack(p: TemplatePredecessor): boolean {
  return (p.type === 'FS' || p.type === 'SS') && p.lagDays >= 0;
}

/**
 * Creates one asset's tasks and links from a template. `makeId` is called once per
 * template task key and must return a project-unique task id.
 * Throws TemplateInvalidError when the template has problems, RangeError when the group
 * number is not a whole number of 1 or more, and Error when makeId repeats an id.
 */
export function instantiateTemplate(
  template: Template,
  input: InstantiateInput,
  makeId: (key: string) => Id,
): InstantiatedAsset {
  const problems = validateTemplate(template);
  if (problems.length > 0) throw new TemplateInvalidError(problems);

  if (!Number.isInteger(input.groupNumber) || input.groupNumber < 1) {
    throw new RangeError(`Group number must be a whole number of 1 or more, got ${input.groupNumber}`);
  }

  const asset: Asset = { ...input.asset, templateId: template.id, templateVersion: template.version };
  const ids = new Map<string, Id>();
  const used = new Set<Id>();
  for (const tt of template.tasks) {
    const id = makeId(tt.key);
    if (used.has(id)) throw new Error(`makeId returned task id "${id}" more than once`);
    used.add(id);
    ids.set(tt.key, id);
  }

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
    if (input.startNoEarlierThan !== undefined && !tt.predecessors.some(holdsStartBack)) {
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
 * The keys of a template's first and last tasks, used to chain assets one after another:
 * the first task in template order that has no predecessors, and the last task in
 * template order that no other task follows. Null for a template with no tasks.
 */
export function templateEndpoints(template: Template): { first: string; last: string } | null {
  const tasks = template.tasks;
  if (tasks.length === 0) return null;
  const followed = new Set(tasks.flatMap((t) => t.predecessors.map((p) => p.key)));
  const first = tasks.find((t) => t.predecessors.length === 0) ?? tasks[0]!;
  const last = [...tasks].reverse().find((t) => !followed.has(t.key)) ?? tasks[tasks.length - 1]!;
  return { first: first.key, last: last.key };
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
