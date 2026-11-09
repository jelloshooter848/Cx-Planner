/**
 * Checks on everything the renderer sends. The renderer is treated as untrusted: values
 * are checked for shape here, then by the domain code (applyCommand, WorkspaceStore) for
 * meaning. Each function returns the checked value or throws InputError.
 */
import { formatIso, isInternalCommand, parseIso, type Command, type Template } from '@cx/core';
import { PAPER, type PaperId } from '@cx/render';
import { templateFromFile, TEMPLATE_FILE_FORMAT, TEMPLATE_FILE_VERSION, TemplateImportError } from '@cx/storage';
import { FULL_SCHEDULE_PAPERS, LOOK_AHEAD_PAPERS, LOOK_AHEAD_WEEKS, type NewProjectInput, type PrintRequest } from '../shared/api.js';
import { InputError } from './session.js';

const MAX_NAME = 200;
const MAX_ID = 200;
const MAX_PATH = 4096;
const MAX_BATCH_DEPTH = 8;
const MAX_BATCH_COMMANDS = 10_000;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function checkId(v: unknown, what = 'id'): string {
  if (typeof v !== 'string' || v.trim() === '' || v.length > MAX_ID) throw new InputError(`Invalid ${what}`);
  return v;
}

export function checkName(v: unknown, what = 'name'): string {
  if (typeof v !== 'string' || v.trim() === '') throw new InputError(`The ${what} can't be empty`);
  if (v.length > MAX_NAME) throw new InputError(`The ${what} is too long (at most ${MAX_NAME} characters)`);
  return v.trim();
}

/** A short description of unsaved work, or null. */
export function checkUnsavedWork(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v !== 'string' || v.trim() === '' || v.length > MAX_NAME + 40) throw new InputError('Invalid unsaved-work description');
  return v.trim();
}

export function checkPath(v: unknown): string {
  if (typeof v !== 'string' || v === '' || v.length > MAX_PATH || v.includes('\0')) throw new InputError('Invalid file path');
  return v;
}

export function checkDate(v: unknown, what = 'date'): string {
  if (typeof v !== 'string') throw new InputError(`Invalid ${what}`);
  let day: number;
  try {
    day = parseIso(v);
  } catch {
    throw new InputError(`Invalid ${what} "${v}", expected YYYY-MM-DD`);
  }
  // parseIso accepts 2026-02-31 (rolling over); a real date round-trips.
  if (formatIso(day) !== v) throw new InputError(`Invalid ${what} "${v}"`);
  return v;
}

export function checkNewProject(v: unknown): NewProjectInput {
  if (!isObject(v)) throw new InputError('Invalid new-project details');
  return { name: checkName(v.name, 'project name'), startDate: checkDate(v.startDate, 'start date') };
}

export function checkPaper(v: unknown): PaperId {
  if (typeof v !== 'string' || !Object.hasOwn(PAPER, v)) throw new InputError('Unknown paper size');
  return v as PaperId;
}

/**
 * An edit from the renderer. Refuses the undo-only forms (restoreAsset, restoreTask,
 * restoreAssets, the `restore` flag, moveTask.restoreArrayIndex, link.index): they skip the
 * value checks and are meant only for the main process's own undo stack. Core's
 * isInternalCommand is checked as well, so undo-only kinds added there later are refused
 * too. applyCommand checks the rest.
 */
export function checkCommand(v: unknown): Command {
  let count = 0;
  const visit = (c: unknown, depth: number): void => {
    if (++count > MAX_BATCH_COMMANDS) throw new InputError('Too many commands in one edit');
    if (!isObject(c) || typeof c.kind !== 'string') throw new InputError('An edit must be an object with a kind');
    switch (c.kind) {
      case 'restoreAsset':
      case 'restoreTask':
      case 'restoreAssets':
        throw new InputError(`${c.kind} is used only by undo`);
      case 'updateAsset':
      case 'updateTask':
        if ('restore' in c) throw new InputError('The restore flag is used only by undo');
        break;
      case 'moveTask':
        if ('restoreArrayIndex' in c) throw new InputError('restoreArrayIndex is used only by undo');
        break;
      case 'link':
        if ('index' in c) throw new InputError('A link position is set only by undo');
        break;
      case 'batch':
        if (depth >= MAX_BATCH_DEPTH) throw new InputError('Edits are nested too deeply');
        if (!Array.isArray(c.commands)) throw new InputError('A batch needs a list of commands');
        for (const sub of c.commands) visit(sub, depth + 1);
        break;
    }
  };
  visit(v, 0);
  if (isInternalCommand(v)) throw new InputError('That edit is used only by undo');
  return v as Command;
}

/**
 * A template from the template editor. Read through the same checks as an imported file,
 * which checks every field's type and drops unknown fields; the workspace then applies the
 * template rules on save.
 */
export function checkTemplate(v: unknown): Template {
  if (!isObject(v)) throw new InputError('Invalid template');
  try {
    return templateFromFile(JSON.stringify({ format: TEMPLATE_FILE_FORMAT, version: TEMPLATE_FILE_VERSION, template: v }));
  } catch (e) {
    if (e instanceof TemplateImportError) throw new InputError(e.problems.join('\n'), 'invalid-template');
    throw e;
  }
}

const MAX_NOTE = 200;
const MAX_IDS = 100_000;
/** Day widths the full schedule accepts, in inches (the dialog offers a few in between). */
export const DAY_WIDTH_RANGE = { min: 0.1, max: 2 } as const;

function checkIds(v: unknown, what: string): string[] {
  if (!Array.isArray(v) || v.length > MAX_IDS) throw new InputError(`Invalid ${what}`);
  return v.map((id) => checkId(id, what));
}

function checkOneOf<T extends string | number>(v: unknown, options: readonly T[], what: string): T {
  if (!(options as readonly unknown[]).includes(v)) throw new InputError(`Invalid ${what}`);
  return v as T;
}

/** A print from the Print dialog. Unknown fields are dropped. */
export function checkPrintRequest(v: unknown): PrintRequest {
  if (!isObject(v)) throw new InputError('Invalid print request');
  if (typeof v.note !== 'string' || v.note.length > MAX_NOTE) throw new InputError(`The revision note is too long (at most ${MAX_NOTE} characters)`);
  const note = v.note.trim();
  const assetIds = () => (v.assetIds === null ? null : checkIds(v.assetIds, 'asset id'));
  switch (v.kind) {
    case 'lookahead':
      if (typeof v.showTimes !== 'boolean') throw new InputError('Invalid TIMES setting');
      return {
        kind: 'lookahead',
        paper: checkOneOf(v.paper, LOOK_AHEAD_PAPERS, 'paper size for a look-ahead'),
        weeks: checkOneOf(v.weeks, LOOK_AHEAD_WEEKS, 'number of weeks'),
        start: checkDate(v.start, 'look-ahead start'),
        assetIds: assetIds(),
        showTimes: v.showTimes,
        note,
      };
    case 'full-schedule': {
      const w = v.dayWidthIn;
      if (w !== null && (typeof w !== 'number' || !Number.isFinite(w) || w < DAY_WIDTH_RANGE.min || w > DAY_WIDTH_RANGE.max)) {
        throw new InputError(`The day width must be between ${DAY_WIDTH_RANGE.min} and ${DAY_WIDTH_RANGE.max} inches`);
      }
      return { kind: 'full-schedule', paper: checkOneOf(v.paper, FULL_SCHEDULE_PAPERS, 'paper size for the full schedule'), dayWidthIn: w, assetIds: assetIds(), note };
    }
    case 'test-sheets':
      return { kind: 'test-sheets', taskIds: checkIds(v.taskIds, 'task id'), note };
    default:
      throw new InputError('Unknown kind of print');
  }
}
