import type { DependencyType, Id, TaskType } from './model.js';
import { computeSchedule } from './schedule.js';
import {
  instantiateTemplate,
  validateTemplate,
  type ChecklistItem,
  type Template,
  type TemplatePredecessor,
  type TemplateProblem,
  type TemplateTask,
} from './template.js';

/**
 * Pure helpers for the template editor. Each returns a new template (or list) and never
 * changes its input. Tasks are addressed by their stable key; the editor shows them by row
 * number (1-based position), which is also how predecessors are typed ("3", "2SS+1").
 */

/** Moves the item at `from` to position `to` (both clamped to the list). Returns a new array. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items];
  if (from < 0 || from >= out.length) return out;
  const target = Math.max(0, Math.min(out.length - 1, to));
  const [item] = out.splice(from, 1);
  out.splice(target, 0, item as T);
  return out;
}

/** Eight random hex characters. */
function randomSuffix(): string {
  return globalThis.crypto.randomUUID().slice(0, 8);
}

/**
 * A new task key, "task-<random>", not used by any task of the template. Keys are random so
 * a deleted task's key is never handed out again: re-apply matches project tasks to template
 * tasks by key, so a reused key would turn an asset's old task into the new, unrelated step.
 * `suffix` is for tests.
 */
export function newTemplateTaskKey(template: Pick<Template, 'tasks'>, suffix: () => string = randomSuffix): string {
  const used = new Set(template.tasks.map((t) => t.key));
  let key: string;
  do key = `task-${suffix()}`;
  while (used.has(key));
  return key;
}

/**
 * A new checklist item id, "<prefix>-<random>", not used in the list. Random for the same
 * reason as task keys: results recorded against a deleted item must not attach to a new one.
 */
export function newChecklistItemId(items: readonly ChecklistItem[], prefix: string, suffix: () => string = randomSuffix): string {
  const used = new Set(items.map((i) => i.id));
  let id: string;
  do id = `${prefix}-${suffix()}`;
  while (used.has(id));
  return id;
}

/** An empty custom template with no tasks. */
export function blankTemplate(id: Id, name: string): Template {
  return { id, name, version: 1, kind: 'custom', assetDescription: '', stages: [], tasks: [], requiredDocs: [] };
}

/**
 * Adds a task after the task at row index `afterIndex` (at the end when omitted or out of
 * range). With no `predecessors` given, the new task follows the task before it
 * (finish-to-start), like a new row in the mockup. Returns the template and the new key.
 */
export function addTemplateTask(
  template: Template,
  fields: Partial<Omit<TemplateTask, 'key'>> = {},
  afterIndex?: number,
): { template: Template; key: string } {
  const key = newTemplateTaskKey(template);
  const at = afterIndex === undefined || afterIndex < 0 || afterIndex >= template.tasks.length ? template.tasks.length : afterIndex + 1;
  const before = template.tasks[at - 1];
  const type: TaskType = fields.type ?? 'task';
  const task: TemplateTask = {
    key,
    name: fields.name ?? 'New task',
    durationDays: fields.durationDays ?? (type === 'milestone' ? 0 : 1),
    type,
    trade: fields.trade ?? before?.trade ?? '',
    predecessors: fields.predecessors ?? (before ? [{ key: before.key, type: 'FS', lagDays: 0 }] : []),
    checklist: fields.checklist ?? [],
    requiredCerts: fields.requiredCerts ?? [],
    ...(fields.testForm !== undefined ? { testForm: fields.testForm } : {}),
    ...(fields.noticeLeadDays !== undefined ? { noticeLeadDays: fields.noticeLeadDays } : {}),
  };
  const tasks = [...template.tasks];
  tasks.splice(at, 0, task);
  return { template: { ...template, tasks }, key };
}

/**
 * Removes a task. Links that pointed at it are bridged: each task that followed it now
 * follows the removed task's own predecessors (finish-to-start, no lag) unless it already
 * follows them, so the chain stays connected.
 */
export function removeTemplateTask(template: Template, key: string): Template {
  const removed = template.tasks.find((t) => t.key === key);
  if (!removed) return template;
  const tasks = template.tasks
    .filter((t) => t.key !== key)
    .map((t) => {
      if (!t.predecessors.some((p) => p.key === key)) return t;
      const kept = t.predecessors.filter((p) => p.key !== key);
      const have = new Set(kept.map((p) => p.key));
      const bridged: TemplatePredecessor[] = removed.predecessors
        .filter((p) => p.key !== t.key && !have.has(p.key))
        .map((p) => ({ key: p.key, type: 'FS', lagDays: 0 }));
      return { ...t, predecessors: [...kept, ...bridged] };
    });
  return { ...template, tasks };
}

/** Moves a task to row index `toIndex` (clamped). Links are kept. */
export function moveTemplateTask(template: Template, key: string, toIndex: number): Template {
  const from = template.tasks.findIndex((t) => t.key === key);
  if (from < 0) return template;
  return { ...template, tasks: moveItem(template.tasks, from, toIndex) };
}

/**
 * Changes fields of one task. Setting the type to milestone also sets the duration to 0.
 * `noticeLeadDays: undefined` or `testForm: ''` clears those fields.
 */
export function updateTemplateTask(template: Template, key: string, patch: Partial<Omit<TemplateTask, 'key'>>): Template {
  return {
    ...template,
    tasks: template.tasks.map((t) => {
      if (t.key !== key) return t;
      const next: TemplateTask = { ...t, ...patch };
      if (patch.type === 'milestone') next.durationDays = 0;
      if ('noticeLeadDays' in patch && patch.noticeLeadDays === undefined) delete next.noticeLeadDays;
      if ('testForm' in patch && (patch.testForm === undefined || patch.testForm.trim() === '')) delete next.testForm;
      return next;
    }),
  };
}

const DEP_TYPES: readonly DependencyType[] = ['FS', 'SS', 'FF', 'SF'];

/**
 * A task's predecessors as row numbers: "3", "2, 3SS+1", "4FF-2". Finish-to-start with no
 * lag is just the number. Predecessors whose key is not in the template are left out.
 */
export function formatTemplatePredecessors(template: Template, task: TemplateTask): string {
  const row = new Map(template.tasks.map((t, i) => [t.key, i + 1]));
  return task.predecessors
    .flatMap((p) => {
      const n = row.get(p.key);
      if (n === undefined) return [];
      const lag = p.lagDays === 0 ? '' : p.lagDays > 0 ? `+${p.lagDays}` : String(p.lagDays);
      return [p.type === 'FS' && lag === '' ? String(n) : `${n}${p.type}${lag}`];
    })
    .join(', ');
}

export type ParsedTemplatePredecessors = { ok: true; predecessors: TemplatePredecessor[] } | { ok: false; message: string };

/**
 * Reads predecessors typed as row numbers, separated by commas or spaces: "3", "2, 3SS+1",
 * "4 FF -2". The type defaults to FS and the lag to 0. Refuses unknown rows, the task's own
 * row and a row listed twice. An empty string means no predecessors.
 */
export function parseTemplatePredecessors(template: Template, forKey: string, text: string): ParsedTemplatePredecessors {
  const parts = text
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  const predecessors: TemplatePredecessor[] = [];
  for (const part of parts) {
    const m = /^(\d+)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+)\s*d?)?$/i.exec(part);
    if (!m) return { ok: false, message: `"${part}" is not a row number like 3, 3SS or 3FS+2` };
    const row = Number(m[1]);
    const task = template.tasks[row - 1];
    if (!task) return { ok: false, message: `There is no task ${row}` };
    if (task.key === forKey) return { ok: false, message: 'A task cannot follow itself' };
    if (predecessors.some((p) => p.key === task.key)) return { ok: false, message: `Task ${row} is listed twice` };
    const type = (m[2]?.toUpperCase() ?? 'FS') as DependencyType;
    if (!DEP_TYPES.includes(type)) return { ok: false, message: `Unknown link type in "${part}"` };
    const lag = m[4] === undefined ? 0 : Number(m[4]) * (m[3] === '-' ? -1 : 1);
    predecessors.push({ key: task.key, type, lagDays: lag });
  }
  return { ok: true, predecessors };
}

/** One row of the template preview: where the task falls when the template is laid out alone. */
export interface TemplatePreviewRow {
  key: string;
  name: string;
  type: TaskType;
  /** Working-day index (0 = the first day); the task occupies [start, finish). Milestones have start === finish. */
  start: number;
  finish: number;
  critical: boolean;
}

export type TemplatePreview =
  | { ok: true; rows: TemplatePreviewRow[]; /** Working days from first start to last finish. */ spanDays: number }
  | { ok: false; problems: TemplateProblem[] };

/**
 * The schedule a template generates on its own ("Preview of the schedule it generates"):
 * instantiated as one asset and scheduled on a plain Monday-Friday calendar. Rows are in
 * template order, positioned in working days from the earliest start. Never throws: a
 * template that cannot be laid out comes back as problems.
 */
export function previewTemplate(template: Template): TemplatePreview {
  const problems = validateTemplate(template);
  if (problems.length > 0) return { ok: false, problems };
  if (template.tasks.length === 0) return { ok: true, rows: [], spanDays: 0 };
  try {
    return layoutPreview(template);
  } catch (e) {
    const message = `The schedule could not be worked out: ${e instanceof Error ? e.message : String(e)}`;
    return { ok: false, problems: [{ code: 'unschedulable', message }] };
  }
}

function layoutPreview(template: Template): TemplatePreview {
  const origin = '2001-01-01'; // A Monday; any date works with a plain Monday-Friday calendar.
  const { asset, tasks, dependencies } = instantiateTemplate(
    template,
    { asset: { id: '_', tag: '_', description: '' }, groupNumber: 1 },
    (key) => key,
  );
  const r = computeSchedule({
    id: '_',
    name: '_',
    startDate: origin,
    dataDate: origin,
    calendar: { workWeekdays: [1, 2, 3, 4, 5], holidays: [] },
    assets: [asset],
    tasks,
    dependencies,
  });
  const scheduled = template.tasks.map((t) => {
    const s = r.tasks.get(t.key);
    if (!s) throw new Error(`task "${t.name}" was not scheduled`);
    return { t, s };
  });
  const first = Math.min(...scheduled.map(({ s }) => s.es));
  const rows = scheduled.map(({ t, s }) => ({
    key: t.key,
    name: t.name,
    type: t.type,
    start: s.es - first,
    finish: s.ef - first,
    critical: s.critical,
  }));
  return { ok: true, rows, spanDays: r.projectFinishIndex - first };
}
