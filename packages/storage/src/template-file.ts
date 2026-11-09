import { validateTemplate } from '@cx/core';
import type { ChecklistItem, DependencyType, Template, TemplatePredecessor, TemplateTask, TaskType } from '@cx/core';

/** Marks a JSON file as one exported template. */
export const TEMPLATE_FILE_FORMAT = 'cx-template';
/** Bump when the file layout changes in a way older apps cannot read. */
export const TEMPLATE_FILE_VERSION = 1;

export interface TemplateFile {
  format: typeof TEMPLATE_FILE_FORMAT;
  version: typeof TEMPLATE_FILE_VERSION;
  template: Template;
}

/** A template file that cannot be imported. `problems` holds one plain-language line each. */
export class TemplateImportError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Template file cannot be imported: ${problems.join('; ')}`);
    this.name = 'TemplateImportError';
  }
}

/** The JSON text of an exported template file. */
export function templateToFile(template: Template): string {
  const file: TemplateFile = { format: TEMPLATE_FILE_FORMAT, version: TEMPLATE_FILE_VERSION, template };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * Reads an exported template file. Checks the wrapper, the shape of every field and then
 * the template's own rules (validateTemplate). Unknown fields are dropped. Throws
 * TemplateImportError listing everything that is wrong.
 */
export function templateFromFile(json: string): Template {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    throw new TemplateImportError([`The file is not valid JSON (${(e as Error).message})`]);
  }
  if (!isObject(data) || data.format !== TEMPLATE_FILE_FORMAT) {
    throw new TemplateImportError(['The file is not a Cx Planner template (format should be "cx-template")']);
  }
  if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) {
    throw new TemplateImportError(['The template file has no valid format version']);
  }
  if (data.version > TEMPLATE_FILE_VERSION) {
    throw new TemplateImportError([`The template file was made by a newer version of Cx Planner (format version ${data.version})`]);
  }
  const problems: string[] = [];
  const template = readTemplate(data.template, problems);
  if (!template || problems.length > 0) throw new TemplateImportError(problems);
  const rules = validateTemplate(template);
  if (rules.length > 0) throw new TemplateImportError(rules.map((p) => p.message));
  return template;
}

const TASK_TYPES: readonly TaskType[] = ['task', 'hold', 'witness', 'milestone'];
const DEPENDENCY_TYPES: readonly DependencyType[] = ['FS', 'SS', 'FF', 'SF'];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(o: Record<string, unknown>, field: string, where: string, problems: string[]): string {
  const v = o[field];
  if (typeof v !== 'string') {
    problems.push(`${where}: ${field} must be text`);
    return '';
  }
  return v;
}

function num(o: Record<string, unknown>, field: string, where: string, problems: string[]): number {
  const v = o[field];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    problems.push(`${where}: ${field} must be a number`);
    return 0;
  }
  return v;
}

function list(o: Record<string, unknown>, field: string, where: string, problems: string[]): unknown[] {
  const v = o[field];
  if (!Array.isArray(v)) {
    problems.push(`${where}: ${field} must be a list`);
    return [];
  }
  return v;
}

function strList(o: Record<string, unknown>, field: string, where: string, problems: string[]): string[] {
  return list(o, field, where, problems).flatMap((v, i) => {
    if (typeof v === 'string') return [v];
    problems.push(`${where}: ${field} item ${i + 1} must be text`);
    return [];
  });
}

function oneOf<T extends string>(o: Record<string, unknown>, field: string, allowed: readonly T[], where: string, problems: string[]): T {
  const v = o[field];
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    problems.push(`${where}: ${field} must be one of ${allowed.join(', ')}`);
    return allowed[0]!;
  }
  return v as T;
}

function readTemplate(v: unknown, problems: string[]): Template | undefined {
  if (!isObject(v)) {
    problems.push('The file has no template');
    return undefined;
  }
  const where = 'Template';
  const t: Template = {
    id: str(v, 'id', where, problems),
    name: str(v, 'name', where, problems),
    version: num(v, 'version', where, problems),
    // Imports are always stored as custom, so a file without a kind is fine.
    kind: v.kind === undefined ? 'custom' : oneOf(v, 'kind', ['starter', 'custom'], where, problems),
    assetDescription: str(v, 'assetDescription', where, problems),
    stages: strList(v, 'stages', where, problems),
    tasks: list(v, 'tasks', where, problems).flatMap((task, i) => {
      const read = readTask(task, `Task ${i + 1}`, problems);
      return read ? [read] : [];
    }),
    requiredDocs: strList(v, 'requiredDocs', where, problems),
  };
  if (t.id.trim() === '' && typeof v.id === 'string') problems.push('Template: id must not be empty');
  if (t.name.trim() === '' && typeof v.name === 'string') problems.push('Template: name must not be empty');
  t.name = t.name.trim();
  return t;
}

function readTask(v: unknown, where: string, problems: string[]): TemplateTask | undefined {
  if (!isObject(v)) {
    problems.push(`${where} must be an object`);
    return undefined;
  }
  const label = typeof v.name === 'string' && v.name !== '' ? `${where} ("${v.name}")` : where;
  const task: TemplateTask = {
    key: str(v, 'key', label, problems),
    name: str(v, 'name', label, problems),
    durationDays: num(v, 'durationDays', label, problems),
    type: oneOf(v, 'type', TASK_TYPES, label, problems),
    trade: str(v, 'trade', label, problems),
    predecessors: list(v, 'predecessors', label, problems).flatMap((p, i) => {
      const read = readPredecessor(p, `${label} predecessor ${i + 1}`, problems);
      return read ? [read] : [];
    }),
    checklist: list(v, 'checklist', label, problems).flatMap((c, i) => {
      const read = readChecklistItem(c, `${label} checklist item ${i + 1}`, problems);
      return read ? [read] : [];
    }),
    requiredCerts: strList(v, 'requiredCerts', label, problems),
  };
  if (v.testForm !== undefined) task.testForm = str(v, 'testForm', label, problems);
  if (v.noticeLeadDays !== undefined) task.noticeLeadDays = num(v, 'noticeLeadDays', label, problems);
  return task;
}

function readPredecessor(v: unknown, where: string, problems: string[]): TemplatePredecessor | undefined {
  if (!isObject(v)) {
    problems.push(`${where} must be an object`);
    return undefined;
  }
  return {
    key: str(v, 'key', where, problems),
    type: oneOf(v, 'type', DEPENDENCY_TYPES, where, problems),
    lagDays: num(v, 'lagDays', where, problems),
  };
}

function readChecklistItem(v: unknown, where: string, problems: string[]): ChecklistItem | undefined {
  if (!isObject(v)) {
    problems.push(`${where} must be an object`);
    return undefined;
  }
  const item: ChecklistItem = { id: str(v, 'id', where, problems), text: str(v, 'text', where, problems) };
  // Older files have no acceptance; an empty one is the same as none.
  if (v.acceptance !== undefined) {
    const acceptance = str(v, 'acceptance', where, problems).trim();
    if (acceptance !== '') item.acceptance = acceptance;
  }
  return item;
}
