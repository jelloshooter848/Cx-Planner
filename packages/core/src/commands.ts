import { formatIso, parseIso } from './calendar.js';
import type {
  Asset,
  CalendarDef,
  Dependency,
  DependencyType,
  Id,
  IsoDate,
  Project,
  Readiness,
  ReadinessState,
  Task,
  TaskType,
} from './model.js';
import { TIMES_KEYS } from './model.js';
import { ScheduleCycleError, topologicalOrder } from './schedule.js';
import { instantiateTemplate, TemplateInvalidError, templateEndpoints, type InstantiatedAsset, type Template } from './template.js';
import { isEmptyReapplyPlan, reapplyTemplate as reapply, UnknownAssetError } from './reapply.js';

/**
 * Edit commands. Every change the desktop app makes to a project goes through
 * `applyCommand`, which returns a new project (the input is never changed), the command
 * that undoes the edit, and a one-line summary for the undo menu and the change log.
 *
 * Commands are plain JSON data so they can be stored in the change log and replayed.
 * In patches, `null` clears an optional field and a missing key leaves it alone.
 *
 * Task codes ("1.1, 1.2 ...") are derived: the group number is the asset's position in
 * `project.assets` plus one, and the task number is the task's position among its
 * asset's tasks in `project.tasks`. Commands that add, remove or move tasks or assets
 * renumber the groups they touch. Undo restores the original exactly when the project's
 * codes already follow that rule (see `renumberTasks`).
 *
 * TODO(desktop open path): call `renumberTasks` on every project loaded from ProjectStore
 * (or imported) before the first edit, so undo of add/remove/move is exact.
 *
 * Commands arriving over IPC are plain JSON. `applyCommand` checks the shape of every
 * command (unknown kinds, unknown fields and wrongly typed values are refused with
 * CommandError rather than stored), and checks ids and values for ordinary edits.
 *
 * Undo commands (`restoreAsset`, `restoreTask`, `restoreAssets`, and `updateAsset` / `updateTask` with
 * `restore: true`) put back data the project held a moment ago, which may predate the
 * value checks (e.g. a file whose percent complete is 150). They still get the shape
 * checks (required keys, field types, task and link types, readiness records) but skip
 * range and business rules. They are meant to come only from the main process's own undo
 * stack; the IPC handler must refuse them from the renderer (`isInternalCommand` says
 * which commands those are).
 *
 * An edit that would change nothing (an empty patch, no project-info fields, a move to
 * the task's current place) is refused with CommandError('no-change'), so it never makes
 * an empty undo step or change-log entry. Callers that may send such edits should catch
 * that code and skip saving.
 */

// ---------------------------------------------------------------------------------------
// Types

export type CommandErrorCode =
  | 'unknown-asset'
  | 'unknown-task'
  | 'unknown-dependency'
  | 'duplicate-id'
  | 'duplicate-tag'
  | 'duplicate-dependency'
  | 'self-link'
  | 'cycle'
  | 'invalid-duration'
  | 'milestone-duration'
  | 'invalid-percent'
  | 'invalid-date'
  | 'finish-before-start'
  | 'finish-without-start'
  | 'invalid-lag'
  | 'invalid-type'
  | 'invalid-index'
  | 'invalid-calendar'
  | 'invalid-template'
  | 'other-template'
  | 'invalid-field'
  | 'empty-name'
  | 'empty-batch'
  | 'no-change'
  | 'unknown-command';

/** Thrown by `applyCommand` when an edit is not allowed. The project is left unchanged. */
export class CommandError extends Error {
  constructor(
    public readonly code: CommandErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

type OptionalKeys<T> = { [K in keyof T]-?: Record<never, never> extends Pick<T, K> ? K : never }[keyof T];
type RequiredKeys<T> = Exclude<keyof T, OptionalKeys<T>>;

/** Partial update. For optional fields, `null` removes the field. */
export type Patch<T> = { [K in RequiredKeys<T>]?: T[K] } & {
  [K in OptionalKeys<T>]?: Exclude<T[K], undefined> | null;
};

export type AssetPatch = Patch<Omit<Asset, 'id'>>;
/** Tasks keep their id; move them with `moveTask`; codes are derived. */
export type TaskPatch = Patch<Omit<Task, 'id' | 'assetId' | 'code'>>;
export type DependencyPatch = Partial<Pick<Dependency, 'type' | 'lagDays'>>;

/** One asset to create in the add-assets dialog. */
export interface NewAssetInput {
  /** Defaults to an id made from the tag. */
  id?: Id;
  tag: string;
  description: string;
  location?: string;
  system?: string;
  /** Start no earlier than this date (see InstantiateInput.startNoEarlierThan). */
  startNoEarlierThan?: IsoDate;
}

/** Fields of a new task. Type defaults to 'task', duration to 1 day (0 for milestones), percent to 0. */
export type NewTaskFields = Pick<Task, 'name'> & Partial<Omit<Task, 'id' | 'assetId' | 'code' | 'name'>>;

/** An item together with its position in a project array, so undo can put it back. */
export interface Positioned<T> {
  item: T;
  index: number;
}

export type Command =
  | {
      kind: 'addAssetsFromTemplate';
      template: Template;
      assets: NewAssetInput[];
      /**
       * Link each new asset's first task finish-to-start after the previous new asset's
       * last task (see `templateEndpoints`), so the assets are worked one after another.
       */
      followPrevious?: boolean;
    }
  | { kind: 'removeAsset'; id: Id }
  /** Undo of removeAsset: puts an asset, its tasks and links back where they were. */
  | {
      kind: 'restoreAsset';
      asset: Asset;
      index: number;
      tasks: Positioned<Task>[];
      dependencies: Positioned<Dependency>[];
    }
  /**
   * Re-applies a template to assets made from it (see reapply.ts for the rules: progress
   * is never lost, user-added tasks and links to other assets are kept). Undone by
   * `restoreAssets`.
   */
  | {
      kind: 'reapplyTemplate';
      assetIds: Id[];
      template: Template;
      /**
       * Required to re-apply to an asset made from a different template (another template
       * id), which replaces its whole template plan; refused otherwise.
       */
      allowOtherTemplate?: true;
    }
  /**
   * Undo of reapplyTemplate: a snapshot of some assets. Each listed asset (which must
   * exist) is replaced, every task of those assets and every link touching one is taken
   * out, and the snapshot's tasks and links go back at their recorded positions in
   * project.tasks and project.dependencies, codes as recorded. Its inverse is a snapshot
   * of the state it replaced.
   */
  | {
      kind: 'restoreAssets';
      assets: Asset[];
      tasks: Positioned<Task>[];
      dependencies: Positioned<Dependency>[];
      /** For the undo menu and the change log. */
      summary?: string;
    }
  | {
      kind: 'updateAsset';
      id: Id;
      patch: AssetPatch;
      /** Set only by undo: the patch puts back earlier values, so range checks are skipped (shape is still checked). */
      restore?: true;
    }
  | {
      kind: 'addTask';
      assetId: Id;
      /** Insert after this task of the same asset; at the end of the group when omitted. */
      afterTaskId?: Id;
      /** Defaults to a generated id. */
      id?: Id;
      task: NewTaskFields;
    }
  /** Removes the task and every link to or from it. */
  | { kind: 'removeTask'; id: Id }
  /** Undo of removeTask. */
  | { kind: 'restoreTask'; task: Task; index: number; dependencies: Positioned<Dependency>[] }
  | {
      kind: 'updateTask';
      id: Id;
      patch: TaskPatch;
      /**
       * Set only by undo: the patch puts back values the task had a moment ago, so range
       * and business rules are skipped (unknown keys, wrong types and unknown task types
       * are still refused). Without it, only the fields the patch touches are checked.
       */
      restore?: true;
    }
  | {
      kind: 'moveTask';
      id: Id;
      toAssetId: Id;
      /** Position among the target asset's other tasks (0 = first). */
      toIndex: number;
      /**
       * Undo only: the exact position in project.tasks the task came from, so the array
       * order is restored exactly. It must agree with toIndex (the same number of the
       * target asset's tasks before it); otherwise the command is refused.
       */
      restoreArrayIndex?: number;
    }
  | {
      kind: 'link';
      predecessorId: Id;
      successorId: Id;
      type: DependencyType;
      lagDays: number;
      /** Position in project.dependencies; appended when omitted. Set by undo. */
      index?: number;
    }
  | { kind: 'unlink'; predecessorId: Id; successorId: Id }
  | { kind: 'updateDependency'; predecessorId: Id; successorId: Id; patch: DependencyPatch }
  | { kind: 'setDataDate'; date: IsoDate }
  | { kind: 'updateProjectInfo'; name?: string; subtitle?: string | null; startDate?: IsoDate }
  | { kind: 'setCalendar'; calendar: CalendarDef }
  /** Several commands applied in order as one undoable step. */
  | { kind: 'batch'; commands: Command[]; summary?: string };

export type CommandKind = Command['kind'];

export interface CommandResult {
  project: Project;
  /** Applying this to `project` gives back the project the command was applied to. */
  inverse: Command;
  /** Plain-language description, e.g. "Linked 1.3 → 1.4 (FS)". */
  summary: string;
}

// ---------------------------------------------------------------------------------------
// Apply

/** Applies one edit. Throws CommandError (and changes nothing) when the edit is invalid. */
export function applyCommand(project: Project, cmd: Command): CommandResult {
  if (typeof cmd !== 'object' || cmd === null || Array.isArray(cmd)) {
    throw new CommandError('unknown-command', 'A command must be an object');
  }
  switch (cmd.kind) {
    case 'addAssetsFromTemplate': return addAssetsFromTemplate(project, cmd);
    case 'removeAsset': return removeAsset(project, cmd.id);
    case 'restoreAsset': return restoreAsset(project, cmd);
    case 'reapplyTemplate': return reapplyTemplateCommand(project, cmd);
    case 'restoreAssets': return restoreAssets(project, cmd);
    case 'updateAsset': return updateAsset(project, cmd.id, cmd.patch, cmd.restore === true);
    case 'addTask': return addTask(project, cmd);
    case 'removeTask': return removeTask(project, cmd.id);
    case 'restoreTask': return restoreTask(project, cmd);
    case 'updateTask': return updateTask(project, cmd.id, cmd.patch, cmd.restore === true);
    case 'moveTask': return moveTask(project, cmd);
    case 'link': return link(project, cmd);
    case 'unlink': return unlink(project, cmd.predecessorId, cmd.successorId);
    case 'updateDependency': return updateDependency(project, cmd);
    case 'setDataDate': return setDataDate(project, cmd.date);
    case 'updateProjectInfo': return updateProjectInfo(project, cmd);
    case 'setCalendar': return setCalendar(project, cmd.calendar);
    case 'batch': return batch(project, cmd.commands, cmd.summary);
    default:
      throw new CommandError('unknown-command', `Unknown command "${String((cmd as { kind?: unknown }).kind)}"`);
  }
}

/**
 * True for commands only the main process may issue: undo commands that put back earlier
 * data and skip range checks (`restoreAsset`, `restoreTask`, `restoreAssets`, and
 * `updateAsset` / `updateTask` with `restore: true`), or a batch holding one. The IPC
 * handler must refuse these from the renderer. Takes unchecked input.
 */
export function isInternalCommand(cmd: unknown): boolean {
  if (!isPlainObject(cmd)) return false;
  switch (cmd.kind) {
    case 'restoreAsset':
    case 'restoreTask':
    case 'restoreAssets':
      return true;
    case 'updateAsset':
    case 'updateTask':
      return cmd.restore !== undefined;
    case 'batch':
      return Array.isArray(cmd.commands) && cmd.commands.some(isInternalCommand);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------------------
// Assets

function addAssetsFromTemplate(
  project: Project,
  cmd: Extract<Command, { kind: 'addAssetsFromTemplate' }>,
): CommandResult {
  checkTemplateShape(cmd.template);
  if (!Array.isArray(cmd.assets)) throw new CommandError('invalid-field', 'Assets must be a list');
  if (cmd.assets.length === 0) throw new CommandError('empty-batch', 'No assets to add');
  for (const input of cmd.assets) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new CommandError('invalid-field', 'Each new asset must be an object');
    }
    checkFields(input, NEW_ASSET_FIELDS);
    if (typeof input.tag !== 'string') throw new CommandError('invalid-field', 'Each new asset needs a tag');
    if (typeof input.description !== 'string') throw new CommandError('invalid-field', 'Each new asset needs a description');
  }
  if (cmd.followPrevious !== undefined && typeof cmd.followPrevious !== 'boolean') {
    throw new CommandError('invalid-field', 'followPrevious must be true or false');
  }
  const assetIds = new Set(project.assets.map((a) => a.id));
  const taskIds = new Set(project.tasks.map((t) => t.id));
  const tagsUsed = new Set(project.assets.map((a) => tagKey(a.tag)));
  const assets = [...project.assets];
  const tasks = [...project.tasks];
  const dependencies = [...project.dependencies];
  let previous: InstantiatedAsset | null = null;
  for (const input of cmd.assets) {
    if (input.tag.trim() === '') throw new CommandError('empty-name', 'Each new asset needs a tag');
    if (tagsUsed.has(tagKey(input.tag))) throw new CommandError('duplicate-tag', `Tag "${input.tag.trim()}" is already used`);
    tagsUsed.add(tagKey(input.tag));
    let id: Id;
    if (input.id !== undefined) {
      if (assetIds.has(input.id)) throw new CommandError('duplicate-id', `Asset id "${input.id}" is already used`);
      id = input.id;
    } else {
      id = uniqueId(slug(input.tag), assetIds);
    }
    assetIds.add(id);
    if (input.startNoEarlierThan !== undefined) checkDate(input.startNoEarlierThan, 'Start no earlier than');
    const asset: Omit<Asset, 'templateId' | 'templateVersion'> = { id, tag: input.tag, description: input.description };
    if (input.location !== undefined) asset.location = input.location;
    if (input.system !== undefined) asset.system = input.system;
    let made;
    try {
      made = instantiateTemplate(
        cmd.template,
        {
          asset,
          groupNumber: assets.length + 1,
          ...(input.startNoEarlierThan !== undefined ? { startNoEarlierThan: input.startNoEarlierThan } : {}),
        },
        (key) => {
          const tid = uniqueId(`${id}:${key}`, taskIds);
          taskIds.add(tid);
          return tid;
        },
      );
    } catch (e) {
      if (e instanceof TemplateInvalidError) throw new CommandError('invalid-template', e.message);
      throw e;
    }
    assets.push(made.asset);
    tasks.push(...made.tasks);
    dependencies.push(...made.dependencies);
    if (cmd.followPrevious === true && previous) {
      const ends = templateEndpoints(cmd.template);
      const pred = ends && previous.tasks.find((t) => t.templateKey === ends.last);
      const succ = ends && made.tasks.find((t) => t.templateKey === ends.first);
      if (pred && succ) dependencies.push({ predecessorId: pred.id, successorId: succ.id, type: 'FS', lagDays: 0 });
    }
    previous = made;
  }
  const added = assets.slice(project.assets.length);
  const tags = added.map((a) => a.tag).join(', ');
  const summary = `Added ${plural(added.length, 'asset')} from ${cmd.template.name}: ${tags}`;
  return {
    project: { ...project, assets, tasks, dependencies },
    inverse: {
      kind: 'batch',
      commands: added.map((a): Command => ({ kind: 'removeAsset', id: a.id })).reverse(),
      summary: undoSummary(summary),
    },
    summary,
  };
}

function removeAsset(project: Project, id: Id): CommandResult {
  const index = project.assets.findIndex((a) => a.id === id);
  const asset = project.assets[index];
  if (!asset) throw new CommandError('unknown-asset', `No asset with id "${id}"`);
  const removedTasks: Positioned<Task>[] = [];
  const tasks: Task[] = [];
  project.tasks.forEach((t, i) => (t.assetId === id ? removedTasks.push({ item: t, index: i }) : tasks.push(t)));
  const gone = new Set(removedTasks.map((r) => r.item.id));
  const removedDeps: Positioned<Dependency>[] = [];
  const dependencies: Dependency[] = [];
  project.dependencies.forEach((d, i) =>
    gone.has(d.predecessorId) || gone.has(d.successorId) ? removedDeps.push({ item: d, index: i }) : dependencies.push(d),
  );
  const assets = project.assets.filter((a) => a.id !== id);
  const next = renumber({ ...project, assets, tasks, dependencies }, assets.slice(index).map((a) => a.id));
  return {
    project: next,
    inverse: { kind: 'restoreAsset', asset, index, tasks: removedTasks, dependencies: removedDeps },
    summary: `Removed asset ${asset.tag}${removedTasks.length ? ` and ${plural(removedTasks.length, 'task')}` : ''}`,
  };
}

function restoreAsset(project: Project, cmd: Extract<Command, { kind: 'restoreAsset' }>): CommandResult {
  checkAssetShape(cmd.asset);
  if (project.assets.some((a) => a.id === cmd.asset.id)) {
    throw new CommandError('duplicate-id', `Asset id "${cmd.asset.id}" is already used`);
  }
  checkIndex(cmd.index, project.assets.length, 'Asset position');
  checkPositionedList(cmd.tasks, 'Tasks');
  checkPositionedList(cmd.dependencies, 'Links');
  const taskIds = new Set(project.tasks.map((t) => t.id));
  for (const { item } of cmd.tasks) {
    checkTaskShape(item);
    if (taskIds.has(item.id)) throw new CommandError('duplicate-id', `Task id "${item.id}" is already used`);
    if (item.assetId !== cmd.asset.id) throw new CommandError('unknown-asset', `Task "${item.id}" belongs to another asset`);
    // No range checks: this puts back data the project held a moment ago.
  }
  for (const { item } of cmd.dependencies) checkDependencyShape(item);
  const assets = [...project.assets];
  assets.splice(cmd.index, 0, cmd.asset);
  const tasks = insertPositioned(project.tasks, cmd.tasks);
  const dependencies = insertPositioned(project.dependencies, cmd.dependencies);
  checkDependencies(tasks, dependencies);
  const next = renumber({ ...project, assets, tasks, dependencies }, assets.slice(cmd.index).map((a) => a.id));
  return {
    project: next,
    inverse: { kind: 'removeAsset', id: cmd.asset.id },
    summary: `Restored asset ${cmd.asset.tag}`,
  };
}

function reapplyTemplateCommand(project: Project, cmd: Extract<Command, { kind: 'reapplyTemplate' }>): CommandResult {
  if (!Array.isArray(cmd.assetIds) || cmd.assetIds.some((id) => typeof id !== 'string')) {
    throw new CommandError('invalid-field', 'Asset ids must be a list of strings');
  }
  if (cmd.assetIds.length === 0) throw new CommandError('empty-batch', 'No assets to re-apply the template to');
  if (new Set(cmd.assetIds).size !== cmd.assetIds.length) {
    throw new CommandError('invalid-field', 'An asset is listed more than once');
  }
  if (cmd.allowOtherTemplate !== undefined && cmd.allowOtherTemplate !== true) {
    throw new CommandError('invalid-field', 'allowOtherTemplate must be true when set');
  }
  checkTemplateShape(cmd.template);
  let result;
  try {
    result = reapply(project, cmd.assetIds, cmd.template);
  } catch (e) {
    if (e instanceof TemplateInvalidError) throw new CommandError('invalid-template', e.message);
    if (e instanceof UnknownAssetError) throw new CommandError('unknown-asset', e.message);
    throw e;
  }
  const { plans } = result;
  const tags = cmd.assetIds.map((id) => project.assets.find((a) => a.id === id)!.tag).join(', ');
  const other = plans.filter((p) => p.templateMismatch);
  if (other.length > 0 && cmd.allowOtherTemplate !== true) {
    const otherTags = other.map((p) => project.assets.find((a) => a.id === p.assetId)!.tag).join(', ');
    throw new CommandError('other-template', `${otherTags} ${other.length === 1 ? 'was' : 'were'} made from another template than ${cmd.template.name}`);
  }
  if (plans.every(isEmptyReapplyPlan)) {
    throw new CommandError('no-change', `${tags} already match${cmd.assetIds.length === 1 ? 'es' : ''} ${cmd.template.name}`);
  }
  checkNoCycle(result.project.tasks, result.project.dependencies, `Re-applying ${cmd.template.name} would make a loop with links added by hand`);
  const next = renumber(result.project, cmd.assetIds);

  const count = (f: (p: (typeof plans)[number]) => number) => plans.reduce((n, p) => n + f(p), 0);
  const parts = [
    [count((p) => p.added.length), 'added'],
    [count((p) => p.updated.length), 'updated'],
    [count((p) => p.removed.length), 'removed'],
    [count((p) => p.conflicts.length), 'kept with conflicts'],
  ] as const;
  const detail = parts.filter(([n]) => n > 0).map(([n, what]) => `${plural(n, 'task')} ${what}`).join(', ');
  const summary = `Re-applied ${cmd.template.name} v${cmd.template.version} to ${tags}${detail ? `: ${detail}` : ''}`;
  return { project: next, inverse: { ...snapshotAssets(project, cmd.assetIds), summary: undoSummary(summary) }, summary };
}

/** The restoreAssets command that puts the listed assets back as they are in `project`. */
function snapshotAssets(
  project: Project,
  assetIds: readonly Id[],
): Extract<Command, { kind: 'restoreAssets' }> {
  const ids = new Set(assetIds);
  const assets = project.assets.filter((a) => ids.has(a.id));
  const tasks: Positioned<Task>[] = [];
  project.tasks.forEach((t, i) => ids.has(t.assetId) && tasks.push({ item: t, index: i }));
  const taskIds = new Set(tasks.map((t) => t.item.id));
  const dependencies: Positioned<Dependency>[] = [];
  project.dependencies.forEach(
    (d, i) => (taskIds.has(d.predecessorId) || taskIds.has(d.successorId)) && dependencies.push({ item: d, index: i }),
  );
  return { kind: 'restoreAssets', assets, tasks, dependencies };
}

function restoreAssets(project: Project, cmd: Extract<Command, { kind: 'restoreAssets' }>): CommandResult {
  if (!Array.isArray(cmd.assets) || cmd.assets.length === 0) {
    throw new CommandError('invalid-field', 'Assets must be a non-empty list');
  }
  if (cmd.summary !== undefined && typeof (cmd.summary as unknown) !== 'string') {
    throw new CommandError('invalid-field', 'Summary must be a string');
  }
  for (const a of cmd.assets) {
    checkAssetShape(a);
    if (!project.assets.some((x) => x.id === a.id)) throw new CommandError('unknown-asset', `No asset with id "${a.id}"`);
  }
  const ids = new Set(cmd.assets.map((a) => a.id));
  if (ids.size !== cmd.assets.length) throw new CommandError('invalid-field', 'An asset is listed more than once');
  checkPositionedList(cmd.tasks, 'Tasks');
  checkPositionedList(cmd.dependencies, 'Links');
  for (const { item } of cmd.tasks) {
    checkTaskShape(item);
    if (!ids.has(item.assetId)) throw new CommandError('unknown-asset', `Task "${item.id}" belongs to an asset not in the snapshot`);
  }
  for (const { item } of cmd.dependencies) checkDependencyShape(item);

  const before = snapshotAssets(project, [...ids]);
  const gone = new Set(before.tasks.map((t) => t.item.id));
  const keptTasks = project.tasks.filter((t) => !ids.has(t.assetId));
  const used = new Set(keptTasks.map((t) => t.id));
  for (const { item } of cmd.tasks) {
    if (used.has(item.id)) throw new CommandError('duplicate-id', `Task id "${item.id}" is already used`);
    used.add(item.id);
  }
  const assets = project.assets.map((a) => (ids.has(a.id) ? cmd.assets.find((x) => x.id === a.id)! : a));
  const tasks = insertPositioned(keptTasks, cmd.tasks);
  const dependencies = insertPositioned(
    project.dependencies.filter((d) => !gone.has(d.predecessorId) && !gone.has(d.successorId)),
    cmd.dependencies,
  );
  checkDependencies(tasks, dependencies);
  const summary = cmd.summary ?? `Restored ${plural(cmd.assets.length, 'asset')}`;
  return {
    project: { ...project, assets, tasks, dependencies },
    inverse: { ...before, summary: undoSummary(summary) },
    summary,
  };
}

function updateAsset(project: Project, id: Id, patch: AssetPatch, restore: boolean): CommandResult {
  const index = project.assets.findIndex((a) => a.id === id);
  const asset = project.assets[index];
  if (!asset) throw new CommandError('unknown-asset', `No asset with id "${id}"`);
  const { value, undo, keys } = applyPatch(asset, patch, ASSET_FIELDS);
  if (keys.length === 0) throw new CommandError('no-change', `Nothing to change on asset ${asset.tag}`);
  if (restore) checkAssetShape(value);
  else if (keys.includes('tag') && value.tag.trim() === '') {
    throw new CommandError('empty-name', 'An asset needs a tag');
  }
  const assets = [...project.assets];
  assets[index] = value;
  return {
    project: { ...project, assets },
    inverse: { kind: 'updateAsset', id, patch: undo as AssetPatch, restore: true },
    summary: `Updated asset ${asset.tag}${keys.length ? `: ${keys.map(fieldLabel).join(', ')}` : ''}`,
  };
}

// ---------------------------------------------------------------------------------------
// Tasks

function addTask(project: Project, cmd: Extract<Command, { kind: 'addTask' }>): CommandResult {
  const asset = project.assets.find((a) => a.id === cmd.assetId);
  if (!asset) throw new CommandError('unknown-asset', `No asset with id "${cmd.assetId}"`);
  const taskIds = new Set(project.tasks.map((t) => t.id));
  let id: Id;
  if (cmd.id !== undefined) {
    if (taskIds.has(cmd.id)) throw new CommandError('duplicate-id', `Task id "${cmd.id}" is already used`);
    id = cmd.id;
  } else {
    let n = 1;
    while (taskIds.has(`${asset.id}:t${n}`)) n++;
    id = `${asset.id}:t${n}`;
  }
  checkFields(cmd.task, TASK_FIELDS);
  const type = cmd.task.type ?? 'task';
  const task: Task = {
    durationDays: type === 'milestone' ? 0 : 1,
    percentComplete: 0,
    ...dropUndefined(cmd.task),
    id,
    assetId: asset.id,
    code: '',
    name: cmd.task.name,
    type,
  };
  validateTask(task);

  let at: number;
  if (cmd.afterTaskId !== undefined) {
    const after = project.tasks.findIndex((t) => t.id === cmd.afterTaskId);
    if (after < 0) throw new CommandError('unknown-task', `No task with id "${cmd.afterTaskId}"`);
    if (project.tasks[after]!.assetId !== asset.id) {
      throw new CommandError('unknown-task', `Task "${cmd.afterTaskId}" is not part of asset ${asset.tag}`);
    }
    at = after + 1;
  } else {
    at = insertIndexInGroup(project, project.tasks, asset.id, Number.POSITIVE_INFINITY);
  }
  const tasks = [...project.tasks];
  tasks.splice(at, 0, task);
  const next = renumber({ ...project, tasks }, [asset.id]);
  const added = next.tasks[at]!;
  return {
    project: next,
    inverse: { kind: 'removeTask', id },
    summary: `Added task ${added.code} ${added.name}`,
  };
}

function removeTask(project: Project, id: Id): CommandResult {
  const index = project.tasks.findIndex((t) => t.id === id);
  const task = project.tasks[index];
  if (!task) throw new CommandError('unknown-task', `No task with id "${id}"`);
  const removedDeps: Positioned<Dependency>[] = [];
  const dependencies: Dependency[] = [];
  project.dependencies.forEach((d, i) =>
    d.predecessorId === id || d.successorId === id ? removedDeps.push({ item: d, index: i }) : dependencies.push(d),
  );
  const tasks = project.tasks.filter((t) => t.id !== id);
  const next = renumber({ ...project, tasks, dependencies }, [task.assetId]);
  return {
    project: next,
    inverse: { kind: 'restoreTask', task, index, dependencies: removedDeps },
    summary: `Removed task ${task.code} ${task.name}${removedDeps.length ? ` and ${plural(removedDeps.length, 'link')}` : ''}`,
  };
}

function restoreTask(project: Project, cmd: Extract<Command, { kind: 'restoreTask' }>): CommandResult {
  checkTaskShape(cmd.task);
  checkPositionedList(cmd.dependencies, 'Links');
  for (const { item } of cmd.dependencies) checkDependencyShape(item);
  if (project.tasks.some((t) => t.id === cmd.task.id)) {
    throw new CommandError('duplicate-id', `Task id "${cmd.task.id}" is already used`);
  }
  if (!project.assets.some((a) => a.id === cmd.task.assetId)) {
    throw new CommandError('unknown-asset', `No asset with id "${cmd.task.assetId}"`);
  }
  checkIndex(cmd.index, project.tasks.length, 'Task position');
  // No range checks: this puts back a task the project held a moment ago.
  const tasks = [...project.tasks];
  tasks.splice(cmd.index, 0, cmd.task);
  const dependencies = insertPositioned(project.dependencies, cmd.dependencies);
  checkDependencies(tasks, dependencies);
  const next = renumber({ ...project, tasks, dependencies }, [cmd.task.assetId]);
  return {
    project: next,
    inverse: { kind: 'removeTask', id: cmd.task.id },
    summary: `Restored task ${next.tasks[cmd.index]!.code} ${cmd.task.name}`,
  };
}

function updateTask(project: Project, id: Id, patch: TaskPatch, restore: boolean): CommandResult {
  const index = project.tasks.findIndex((t) => t.id === id);
  const task = project.tasks[index];
  if (!task) throw new CommandError('unknown-task', `No task with id "${id}"`);
  const { value, undo, keys } = applyPatch(task, patch, TASK_FIELDS);
  if (keys.length === 0) throw new CommandError('no-change', `Nothing to change on ${task.code}`);
  if (restore) checkTaskShape(value);
  else validateTask(value, new Set(keys));
  const tasks = [...project.tasks];
  tasks[index] = value;
  return {
    project: { ...project, tasks },
    inverse: { kind: 'updateTask', id, patch: undo as TaskPatch, restore: true },
    summary: `Updated ${task.code}${keys.length ? `: ${keys.map(fieldLabel).join(', ')}` : ''}`,
  };
}

function moveTask(project: Project, cmd: Extract<Command, { kind: 'moveTask' }>): CommandResult {
  const from = project.tasks.findIndex((t) => t.id === cmd.id);
  const task = project.tasks[from];
  if (!task) throw new CommandError('unknown-task', `No task with id "${cmd.id}"`);
  if (!project.assets.some((a) => a.id === cmd.toAssetId)) {
    throw new CommandError('unknown-asset', `No asset with id "${cmd.toAssetId}"`);
  }
  const rest = project.tasks.filter((t) => t.id !== cmd.id);
  const fromGroupIndex = project.tasks.filter((t) => t.assetId === task.assetId).indexOf(task);
  const groupSize = rest.filter((t) => t.assetId === cmd.toAssetId).length;
  checkIndex(cmd.toIndex, groupSize, 'Task position');
  let at: number;
  if (cmd.restoreArrayIndex !== undefined) {
    checkIndex(cmd.restoreArrayIndex, rest.length, 'Task position');
    at = cmd.restoreArrayIndex;
    const before = rest.slice(0, at).filter((t) => t.assetId === cmd.toAssetId).length;
    if (before !== cmd.toIndex) {
      throw new CommandError('invalid-index', `Task position ${at} does not match position ${cmd.toIndex} in the asset`);
    }
  } else {
    at = insertIndexInGroup(project, rest, cmd.toAssetId, cmd.toIndex);
  }
  if (task.assetId === cmd.toAssetId && at === from) {
    throw new CommandError('no-change', `${task.code} is already in that place`);
  }
  const moved: Task = task.assetId === cmd.toAssetId ? task : { ...task, assetId: cmd.toAssetId };
  const tasks = [...rest];
  tasks.splice(at, 0, moved);
  const next = renumber({ ...project, tasks }, [task.assetId, cmd.toAssetId]);
  return {
    project: next,
    inverse: { kind: 'moveTask', id: cmd.id, toAssetId: task.assetId, toIndex: fromGroupIndex, restoreArrayIndex: from },
    summary: `Moved ${task.code} ${task.name} to ${next.tasks[at]!.code}`,
  };
}

/**
 * Index in `tasks` at which to insert so the new task becomes number `groupIndex` among
 * the asset's tasks (or the last, when groupIndex is past the end). An asset with no
 * tasks gets its first task after the tasks of the assets before it.
 */
function insertIndexInGroup(project: Project, tasks: Task[], assetId: Id, groupIndex: number): number {
  const positions: number[] = [];
  tasks.forEach((t, i) => t.assetId === assetId && positions.push(i));
  if (groupIndex < positions.length) return positions[groupIndex]!;
  if (positions.length > 0) return positions[positions.length - 1]! + 1;
  const order = new Map(project.assets.map((a, i) => [a.id, i]));
  const mine = order.get(assetId)!;
  let at = 0;
  tasks.forEach((t, i) => {
    const o = order.get(t.assetId);
    if (o !== undefined && o < mine) at = i + 1;
  });
  return at;
}

// ---------------------------------------------------------------------------------------
// Dependencies

function link(project: Project, cmd: Extract<Command, { kind: 'link' }>): CommandResult {
  const pred = findTask(project, cmd.predecessorId);
  const succ = findTask(project, cmd.successorId);
  if (pred.id === succ.id) throw new CommandError('self-link', `${pred.code} cannot follow itself`);
  if (findDependencyIndex(project, pred.id, succ.id) >= 0) {
    throw new CommandError('duplicate-dependency', `${succ.code} already follows ${pred.code}`);
  }
  checkLink(cmd.type, cmd.lagDays);
  const dep: Dependency = { predecessorId: pred.id, successorId: succ.id, type: cmd.type, lagDays: cmd.lagDays };
  const dependencies = [...project.dependencies];
  if (cmd.index !== undefined) {
    checkIndex(cmd.index, dependencies.length, 'Link position');
    dependencies.splice(cmd.index, 0, dep);
  } else {
    dependencies.push(dep);
  }
  checkNoCycle(project.tasks, dependencies, `Linking ${pred.code} → ${succ.code} would make a loop`);
  return {
    project: { ...project, dependencies },
    inverse: { kind: 'unlink', predecessorId: pred.id, successorId: succ.id },
    summary: `Linked ${pred.code} → ${succ.code} (${linkLabel(dep)})`,
  };
}

function unlink(project: Project, predecessorId: Id, successorId: Id): CommandResult {
  const index = findDependencyIndex(project, predecessorId, successorId);
  const dep = project.dependencies[index];
  if (!dep) throw new CommandError('unknown-dependency', `No link from "${predecessorId}" to "${successorId}"`);
  const dependencies = project.dependencies.filter((_, i) => i !== index);
  return {
    project: { ...project, dependencies },
    inverse: { kind: 'link', ...dep, index },
    summary: `Unlinked ${codeOf(project, predecessorId)} → ${codeOf(project, successorId)}`,
  };
}

function updateDependency(project: Project, cmd: Extract<Command, { kind: 'updateDependency' }>): CommandResult {
  const index = findDependencyIndex(project, cmd.predecessorId, cmd.successorId);
  const dep = project.dependencies[index];
  if (!dep) throw new CommandError('unknown-dependency', `No link from "${cmd.predecessorId}" to "${cmd.successorId}"`);
  if (typeof cmd.patch !== 'object' || cmd.patch === null || Array.isArray(cmd.patch)) {
    throw new CommandError('invalid-field', 'A patch must be an object');
  }
  for (const k of Object.keys(cmd.patch)) {
    if (k !== 'type' && k !== 'lagDays') throw new CommandError('invalid-field', `"${k}" cannot be changed on a link`);
  }
  if (cmd.patch.type === undefined && cmd.patch.lagDays === undefined) {
    throw new CommandError('no-change', 'Nothing to change on the link');
  }
  const value: Dependency = { ...dep, ...dropUndefined(cmd.patch) };
  checkLink(value.type, value.lagDays);
  const undo: DependencyPatch = {};
  if (cmd.patch.type !== undefined) undo.type = dep.type;
  if (cmd.patch.lagDays !== undefined) undo.lagDays = dep.lagDays;
  const dependencies = [...project.dependencies];
  dependencies[index] = value;
  return {
    project: { ...project, dependencies },
    inverse: { kind: 'updateDependency', predecessorId: dep.predecessorId, successorId: dep.successorId, patch: undo },
    summary: `Changed link ${codeOf(project, dep.predecessorId)} → ${codeOf(project, dep.successorId)} to ${linkLabel(value)}`,
  };
}

// ---------------------------------------------------------------------------------------
// Project

function setDataDate(project: Project, date: IsoDate): CommandResult {
  checkDate(date, 'Data date');
  if (date === project.dataDate) throw new CommandError('no-change', `The data date is already ${date}`);
  return {
    project: { ...project, dataDate: date },
    inverse: { kind: 'setDataDate', date: project.dataDate },
    summary: `Set data date to ${date}`,
  };
}

function updateProjectInfo(project: Project, cmd: Extract<Command, { kind: 'updateProjectInfo' }>): CommandResult {
  const next: Project = { ...project };
  const inverse: Extract<Command, { kind: 'updateProjectInfo' }> = { kind: 'updateProjectInfo' };
  const changed: string[] = [];
  if (cmd.name !== undefined && typeof cmd.name !== 'string') throw new CommandError('invalid-field', 'Name must be a string');
  if (cmd.subtitle !== undefined && cmd.subtitle !== null && typeof cmd.subtitle !== 'string') {
    throw new CommandError('invalid-field', 'Subtitle must be a string');
  }
  if (cmd.name !== undefined) {
    if (cmd.name.trim() === '') throw new CommandError('empty-name', 'The project needs a name');
    next.name = cmd.name;
    inverse.name = project.name;
    changed.push('name');
  }
  if (cmd.subtitle !== undefined) {
    if (cmd.subtitle === null) delete next.subtitle;
    else next.subtitle = cmd.subtitle;
    inverse.subtitle = project.subtitle ?? null;
    changed.push('subtitle');
  }
  if (cmd.startDate !== undefined) {
    checkDate(cmd.startDate, 'Start date');
    next.startDate = cmd.startDate;
    inverse.startDate = project.startDate;
    changed.push('start date');
  }
  if (changed.length === 0) throw new CommandError('no-change', 'Nothing to change on the project');
  return { project: next, inverse, summary: `Updated project ${changed.join(', ')}` };
}

function setCalendar(project: Project, calendar: CalendarDef): CommandResult {
  if (typeof calendar !== 'object' || calendar === null || Array.isArray(calendar)) {
    throw new CommandError('invalid-calendar', 'The calendar must be an object');
  }
  for (const k of Object.keys(calendar)) {
    if (k !== 'workWeekdays' && k !== 'holidays') throw new CommandError('invalid-field', `"${k}" is not a calendar field`);
  }
  if (!Array.isArray(calendar.workWeekdays) || !Array.isArray(calendar.holidays)) {
    throw new CommandError('invalid-calendar', 'The calendar needs a list of working weekdays and a list of holidays');
  }
  const days = calendar.workWeekdays;
  if (days.length === 0) throw new CommandError('invalid-calendar', 'The calendar needs at least one working weekday');
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6) || new Set(days).size !== days.length) {
    throw new CommandError('invalid-calendar', 'Working weekdays must be distinct whole numbers from 0 (Sunday) to 6 (Saturday)');
  }
  for (const h of calendar.holidays) checkDate(h, 'Holiday');
  return {
    project: { ...project, calendar },
    inverse: { kind: 'setCalendar', calendar: project.calendar },
    summary: 'Changed the work calendar',
  };
}

function batch(project: Project, commands: Command[], summary?: string): CommandResult {
  if (!Array.isArray(commands)) throw new CommandError('invalid-field', 'A batch needs a list of commands');
  if (commands.length === 0) throw new CommandError('empty-batch', 'Nothing to do');
  let current = project;
  const inverses: Command[] = [];
  const summaries: string[] = [];
  for (const c of commands) {
    const r = applyCommand(current, c);
    current = r.project;
    inverses.unshift(r.inverse);
    summaries.push(r.summary);
  }
  const text = summary ?? summaries.join('; ');
  return { project: current, inverse: { kind: 'batch', commands: inverses, summary: undoSummary(text) }, summary: text };
}

const UNDO_PREFIX = 'Undo: ';

/** "Undo: X" for X, and X again for "Undo: X", so redo does not stack prefixes. */
function undoSummary(text: string): string {
  return text.startsWith(UNDO_PREFIX) ? text.slice(UNDO_PREFIX.length) : `${UNDO_PREFIX}${text}`;
}

// ---------------------------------------------------------------------------------------
// Codes

/**
 * Gives every task of the listed assets (all assets when omitted) its derived code
 * "<group>.<n>". Tasks whose code is already right are kept as the same object.
 */
export function renumberTasks(project: Project, assetIds?: Iterable<Id>): Project {
  return renumber(project, assetIds ?? project.assets.map((a) => a.id));
}

function renumber(project: Project, assetIds: Iterable<Id>): Project {
  const group = new Map(project.assets.map((a, i) => [a.id, i + 1]));
  const wanted = new Set(assetIds);
  const counters = new Map<Id, number>();
  let changed = false;
  const tasks = project.tasks.map((t) => {
    const g = group.get(t.assetId);
    if (g === undefined || !wanted.has(t.assetId)) return t;
    const n = (counters.get(t.assetId) ?? 0) + 1;
    counters.set(t.assetId, n);
    const code = `${g}.${n}`;
    if (t.code === code) return t;
    changed = true;
    return { ...t, code };
  });
  return changed ? { ...project, tasks } : project;
}

// ---------------------------------------------------------------------------------------
// Predecessor field

export interface PredecessorInput {
  predecessorId: Id;
  type: DependencyType;
  lagDays: number;
}

export interface PredecessorParseError {
  /** The part of the field the problem is in. */
  text: string;
  message: string;
}

export interface ParsedPredecessors {
  predecessors: PredecessorInput[];
  /** Empty when the whole field was understood. */
  errors: PredecessorParseError[];
}

const PRED_ITEM = /^(\d+(?:\.\d+)?)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+)\s*d?)?$/i;

/**
 * Reads the edit panel's predecessor field: comma- or semicolon-separated task codes,
 * each with an optional link type and lag, e.g. "1.3", "1.3 FS", "1.2SS+2",
 * "2.4 FF-1, 1.3". The type defaults to FS and the lag to 0. A bare number such as "3"
 * means that task in the same group as `forTaskId`.
 * Throws CommandError when `forTaskId` is unknown; problems in the text are returned.
 */
export function parsePredecessors(text: string, project: Project, forTaskId: Id): ParsedPredecessors {
  const self = findTask(project, forTaskId);
  const group = self.code.split('.')[0] ?? '';
  const byCode = new Map<string, Task>();
  for (const t of project.tasks) if (!byCode.has(t.code)) byCode.set(t.code, t);
  const predecessors: PredecessorInput[] = [];
  const errors: PredecessorParseError[] = [];
  for (const raw of text.split(/[,;]/)) {
    const part = raw.trim();
    if (part === '') continue;
    const m = PRED_ITEM.exec(part);
    if (!m) {
      errors.push({ text: part, message: `"${part}" is not a predecessor; write a task code such as 1.3, 1.3 FS or 1.2 SS+2` });
      continue;
    }
    const code = m[1]!.includes('.') ? m[1]! : `${group}.${m[1]!}`;
    const pred = byCode.get(code);
    if (!pred) {
      errors.push({ text: part, message: `There is no task ${code}` });
      continue;
    }
    if (pred.id === self.id) {
      errors.push({ text: part, message: `${code} cannot follow itself` });
      continue;
    }
    if (predecessors.some((p) => p.predecessorId === pred.id)) {
      errors.push({ text: part, message: `${code} is listed more than once` });
      continue;
    }
    const lag = m[4] === undefined ? 0 : Number(m[4]) * (m[3] === '-' ? -1 : 1);
    // "1.3-0" would otherwise give -0.
    predecessors.push({ predecessorId: pred.id, type: (m[2]?.toUpperCase() ?? 'FS') as DependencyType, lagDays: lag + 0 });
  }
  return { predecessors, errors };
}

/** The predecessor field for a task, e.g. "1.3 FS, 1.2 SS+2". */
export function formatPredecessors(project: Project, taskId: Id): string {
  return project.dependencies
    .filter((d) => d.successorId === taskId)
    .map((d) => `${codeOf(project, d.predecessorId)} ${linkLabel(d)}`)
    .join(', ');
}

/**
 * The predecessor field of every task that has predecessors, keyed by task id, in one pass
 * over the dependencies. Same text as formatPredecessors; for views that show many tasks.
 */
export function predecessorLabels(project: Project): Map<Id, string> {
  const codes = new Map(project.tasks.map((t) => [t.id, t.code]));
  const out = new Map<Id, string>();
  for (const d of project.dependencies) {
    const item = `${codes.get(d.predecessorId) ?? d.predecessorId} ${linkLabel(d)}`;
    const prev = out.get(d.successorId);
    out.set(d.successorId, prev ? `${prev}, ${item}` : item);
  }
  return out;
}

/**
 * The command that makes `predecessors` the task's complete list of predecessors:
 * links that are no longer listed are removed, changed ones updated and new ones added.
 * Returns null when nothing would change. Throws CommandError('duplicate-dependency')
 * when a predecessor is listed twice.
 */
export function setPredecessorsCommand(project: Project, taskId: Id, predecessors: PredecessorInput[]): Command | null {
  const task = findTask(project, taskId);
  const current = project.dependencies.filter((d) => d.successorId === taskId);
  const wanted = new Map<Id, PredecessorInput>();
  for (const p of predecessors) {
    if (wanted.has(p.predecessorId)) {
      throw new CommandError('duplicate-dependency', `${codeOf(project, p.predecessorId)} is listed more than once`);
    }
    wanted.set(p.predecessorId, p);
  }
  const commands: Command[] = [];
  for (const d of current) {
    if (!wanted.has(d.predecessorId)) commands.push({ kind: 'unlink', predecessorId: d.predecessorId, successorId: taskId });
  }
  for (const p of predecessors) {
    const d = current.find((c) => c.predecessorId === p.predecessorId);
    if (!d) {
      commands.push({ kind: 'link', predecessorId: p.predecessorId, successorId: taskId, type: p.type, lagDays: p.lagDays });
    } else if (d.type !== p.type || d.lagDays !== p.lagDays) {
      commands.push({
        kind: 'updateDependency', predecessorId: p.predecessorId, successorId: taskId,
        patch: { type: p.type, lagDays: p.lagDays },
      });
    }
  }
  if (commands.length === 0) return null;
  const text = predecessors.map((p) => `${codeOf(project, p.predecessorId)} ${linkLabel(p)}`).join(', ');
  return {
    kind: 'batch',
    commands,
    summary: text ? `Set predecessors of ${task.code} to ${text}` : `Removed predecessors of ${task.code}`,
  };
}

// ---------------------------------------------------------------------------------------
// Helpers

const TASK_TYPES: readonly TaskType[] = ['task', 'hold', 'witness', 'milestone'];
const DEP_TYPES: readonly DependencyType[] = ['FS', 'SS', 'FF', 'SF'];

/**
 * Checks a task's values. With `touched`, only the rules involving those fields run, so
 * an edit is not refused because of an unrelated field that was already out of range.
 */
function validateTask(t: Task, touched?: ReadonlySet<string>): void {
  const label = t.code ? `${t.code}` : `"${t.name}"`;
  const check = (...fields: string[]): boolean => touched === undefined || fields.some((f) => touched.has(f));
  if (check('name') && (typeof t.name !== 'string' || t.name.trim() === '')) {
    throw new CommandError('empty-name', 'A task needs a name');
  }
  if (check('type') && !TASK_TYPES.includes(t.type)) throw new CommandError('invalid-type', `Unknown task type "${t.type}"`);
  if (check('durationDays') && (!Number.isFinite(t.durationDays) || !Number.isInteger(t.durationDays) || t.durationDays < 0)) {
    throw new CommandError('invalid-duration', `${label} duration must be a whole number of working days, 0 or more`);
  }
  if (check('type', 'durationDays') && t.type === 'milestone' && t.durationDays !== 0) {
    throw new CommandError('milestone-duration', `${label} is a milestone, so its duration must be 0`);
  }
  if (check('percentComplete') && (!Number.isFinite(t.percentComplete) || t.percentComplete < 0 || t.percentComplete > 100)) {
    throw new CommandError('invalid-percent', `${label} percent complete must be between 0 and 100`);
  }
  if (check('readiness') && t.readiness !== undefined) checkReadiness(t.readiness);
  if (check('startNoEarlierThan') && t.startNoEarlierThan !== undefined) checkDate(t.startNoEarlierThan, 'Start no earlier than');
  if (check('actualStart') && t.actualStart !== undefined) checkDate(t.actualStart, 'Actual start');
  if (check('actualStart', 'actualFinish') && t.actualFinish !== undefined) {
    checkDate(t.actualFinish, 'Actual finish');
    if (t.actualStart === undefined) {
      throw new CommandError('finish-without-start', `${label} has an actual finish but no actual start`);
    }
    if (t.actualFinish < t.actualStart) {
      throw new CommandError('finish-before-start', `${label} cannot finish (${t.actualFinish}) before it starts (${t.actualStart})`);
    }
  }
}

function checkDate(date: unknown, what: string): void {
  let ok = false;
  if (typeof date === 'string') {
    try {
      ok = formatIso(parseIso(date)) === date;
    } catch {
      ok = false;
    }
  }
  if (!ok) throw new CommandError('invalid-date', `${what} "${String(date)}" is not a valid date (YYYY-MM-DD)`);
}

function checkIndex(index: number, max: number, what: string): void {
  if (!Number.isInteger(index) || index < 0 || index > max) {
    throw new CommandError('invalid-index', `${what} ${index} is out of range (0 to ${max})`);
  }
}

function checkLink(type: DependencyType, lagDays: number): void {
  if (!DEP_TYPES.includes(type)) throw new CommandError('invalid-type', `Unknown link type "${type}"`);
  if (!Number.isInteger(lagDays)) throw new CommandError('invalid-lag', 'Lag must be a whole number of working days');
}

function checkNoCycle(tasks: Task[], dependencies: Dependency[], message: string): void {
  try {
    topologicalOrder(tasks, dependencies);
  } catch (e) {
    if (e instanceof ScheduleCycleError) throw new CommandError('cycle', message);
    throw e;
  }
}

function checkDependencies(tasks: Task[], dependencies: Dependency[]): void {
  const ids = new Set(tasks.map((t) => t.id));
  for (const d of dependencies) {
    if (!ids.has(d.predecessorId) || !ids.has(d.successorId)) {
      throw new CommandError('unknown-task', `Link ${d.predecessorId} → ${d.successorId} names an unknown task`);
    }
  }
  checkNoCycle(tasks, dependencies, 'Restoring these links would make a loop');
}

function findTask(project: Project, id: Id): Task {
  const t = project.tasks.find((x) => x.id === id);
  if (!t) throw new CommandError('unknown-task', `No task with id "${id}"`);
  return t;
}

function findDependencyIndex(project: Project, predecessorId: Id, successorId: Id): number {
  return project.dependencies.findIndex((d) => d.predecessorId === predecessorId && d.successorId === successorId);
}

function codeOf(project: Project, taskId: Id): string {
  return project.tasks.find((t) => t.id === taskId)?.code ?? taskId;
}

/** "FS", "SS+2", "FF-1". */
function linkLabel(d: { type: DependencyType; lagDays: number }): string {
  return `${d.type}${d.lagDays > 0 ? `+${d.lagDays}` : d.lagDays < 0 ? `${d.lagDays}` : ''}`;
}

/** Inserts items back at their recorded positions (ascending, so earlier inserts don't shift later ones). */
function insertPositioned<T>(list: T[], items: Positioned<T>[]): T[] {
  const out = [...list];
  for (const { item, index } of [...items].sort((a, b) => a.index - b.index)) {
    checkIndex(index, out.length, 'Position');
    out.splice(index, 0, item);
  }
  return out;
}

type FieldKind = 'string' | 'number' | 'readiness';
interface FieldSpec {
  kind: FieldKind;
  /** Optional fields may be cleared with null. */
  optional: boolean;
}

const TASK_FIELDS: Readonly<Record<string, FieldSpec>> = {
  name: { kind: 'string', optional: false },
  type: { kind: 'string', optional: false },
  durationDays: { kind: 'number', optional: false },
  percentComplete: { kind: 'number', optional: false },
  responsible: { kind: 'string', optional: true },
  startNoEarlierThan: { kind: 'string', optional: true },
  actualStart: { kind: 'string', optional: true },
  actualFinish: { kind: 'string', optional: true },
  readiness: { kind: 'readiness', optional: true },
  templateKey: { kind: 'string', optional: true },
  notes: { kind: 'string', optional: true },
};

const ASSET_FIELDS: Readonly<Record<string, FieldSpec>> = {
  tag: { kind: 'string', optional: false },
  description: { kind: 'string', optional: false },
  location: { kind: 'string', optional: true },
  system: { kind: 'string', optional: true },
  templateId: { kind: 'string', optional: true },
  templateVersion: { kind: 'number', optional: true },
};

const NEW_ASSET_FIELDS: Readonly<Record<string, FieldSpec>> = {
  id: { kind: 'string', optional: true },
  tag: { kind: 'string', optional: false },
  description: { kind: 'string', optional: false },
  location: { kind: 'string', optional: true },
  system: { kind: 'string', optional: true },
  startNoEarlierThan: { kind: 'string', optional: true },
};

const READINESS_STATES: readonly ReadinessState[] = ['ready', 'progress', 'needed', 'na', 'blocked'];

function isReadiness(v: unknown): v is Readiness {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const entries = Object.entries(v);
  return (
    entries.length === TIMES_KEYS.length &&
    entries.every(([k, s]) => (TIMES_KEYS as readonly string[]).includes(k) && READINESS_STATES.includes(s as ReadinessState))
  );
}

/** Refuses unknown keys and wrongly typed values in new-item fields (undefined is skipped). */
function checkFields(o: object, fields: Readonly<Record<string, FieldSpec>>): void {
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    const spec = Object.hasOwn(fields, k) ? fields[k] : undefined;
    if (!spec) throw new CommandError('invalid-field', `"${k}" is not a field that can be set here`);
    checkFieldType(k, v, spec);
  }
}

function checkFieldType(k: string, v: unknown, spec: FieldSpec): void {
  if (spec.kind === 'readiness' ? typeof v !== 'object' || v === null || Array.isArray(v) : typeof v !== spec.kind) {
    throw new CommandError('invalid-field', `${fieldLabel(k)} must be a ${spec.kind === 'readiness' ? 'readiness record' : spec.kind}`);
  }
}

const TASK_SHAPE: Readonly<Record<string, FieldSpec>> = {
  ...TASK_FIELDS,
  id: { kind: 'string', optional: false },
  assetId: { kind: 'string', optional: false },
  code: { kind: 'string', optional: false },
};

const ASSET_SHAPE: Readonly<Record<string, FieldSpec>> = {
  ...ASSET_FIELDS,
  id: { kind: 'string', optional: false },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Every required key present, no unknown keys, every value of the right type. */
function checkShape(o: unknown, shape: Readonly<Record<string, FieldSpec>>, what: string): asserts o is Record<string, unknown> {
  if (!isPlainObject(o)) throw new CommandError('invalid-field', `${what} must be an object`);
  checkFields(o, shape);
  for (const [k, spec] of Object.entries(shape)) {
    if (!spec.optional && o[k] === undefined) throw new CommandError('invalid-field', `${what} needs ${fieldLabel(k)}`);
  }
}

/** Structural checks for a task put back by undo: shape, task type and readiness, but no ranges. */
function checkTaskShape(t: unknown): asserts t is Task {
  checkShape(t, TASK_SHAPE, 'A task');
  if (!TASK_TYPES.includes(t.type as TaskType)) throw new CommandError('invalid-type', `Unknown task type "${String(t.type)}"`);
  if (t.readiness !== undefined) checkReadiness(t.readiness);
}

function checkAssetShape(a: unknown): asserts a is Asset {
  checkShape(a, ASSET_SHAPE, 'An asset');
}

function checkDependencyShape(d: unknown): asserts d is Dependency {
  if (!isPlainObject(d)) throw new CommandError('invalid-field', 'A link must be an object');
  for (const k of Object.keys(d)) {
    if (!['predecessorId', 'successorId', 'type', 'lagDays'].includes(k)) {
      throw new CommandError('invalid-field', `"${k}" is not a link field`);
    }
  }
  if (typeof d.predecessorId !== 'string' || typeof d.successorId !== 'string' || typeof d.lagDays !== 'number') {
    throw new CommandError('invalid-field', 'A link needs a predecessor, a successor and a lag');
  }
  if (!DEP_TYPES.includes(d.type as DependencyType)) throw new CommandError('invalid-type', `Unknown link type "${String(d.type)}"`);
}

/**
 * Structural checks for a template arriving in a command: the fields instantiating or
 * re-applying it reads, with the right types and known task and link types. Value rules
 * (keys, durations, loops) are left to validateTemplate.
 */
function checkTemplateShape(t: unknown): asserts t is Template {
  const bad = (what: string): never => {
    throw new CommandError('invalid-template', `The template ${what}`);
  };
  if (!isPlainObject(t)) bad('must be an object');
  const tpl = t as Record<string, unknown>;
  if (typeof tpl.id !== 'string') bad('needs an id');
  if (typeof tpl.name !== 'string') bad('needs a name');
  if (typeof tpl.version !== 'number') bad('needs a version number');
  if (!Array.isArray(tpl.tasks)) bad('needs a list of tasks');
  for (const task of tpl.tasks as unknown[]) {
    if (!isPlainObject(task)) bad('has a task that is not an object');
    const tt = task as Record<string, unknown>;
    if (typeof tt.key !== 'string' || typeof tt.name !== 'string' || typeof tt.trade !== 'string') {
      bad('has a task without a key, name or trade');
    }
    const label = `task "${String(tt.key)}"`;
    if (typeof tt.durationDays !== 'number') bad(`${label} has no duration`);
    if (!TASK_TYPES.includes(tt.type as TaskType)) bad(`${label} has an unknown type "${String(tt.type)}"`);
    if (tt.testForm !== undefined && typeof tt.testForm !== 'string') bad(`${label} test form must be text`);
    if (tt.noticeLeadDays !== undefined && typeof tt.noticeLeadDays !== 'number') bad(`${label} notice lead time must be a number`);
    if (!Array.isArray(tt.requiredCerts) || tt.requiredCerts.some((c) => typeof c !== 'string')) {
      bad(`${label} needs a list of certifications`);
    }
    if (
      !Array.isArray(tt.checklist) ||
      tt.checklist.some(
        (c) => !isPlainObject(c) || typeof c.id !== 'string' || typeof c.text !== 'string' || (c.acceptance !== undefined && typeof c.acceptance !== 'string'),
      )
    ) {
      bad(`${label} needs a checklist of { id, text, acceptance? } items`);
    }
    if (!Array.isArray(tt.predecessors)) bad(`${label} needs a list of predecessors`);
    for (const p of tt.predecessors as unknown[]) {
      if (!isPlainObject(p) || typeof p.key !== 'string' || typeof p.lagDays !== 'number') {
        bad(`${label} has a predecessor without a key or lag`);
      }
      const pred = p as Record<string, unknown>;
      if (!DEP_TYPES.includes(pred.type as DependencyType)) bad(`${label} has an unknown link type "${String(pred.type)}"`);
    }
  }
}

function checkPositionedList(list: unknown, what: string): void {
  if (!Array.isArray(list) || list.some((p) => !isPlainObject(p) || !('item' in p))) {
    throw new CommandError('invalid-field', `${what} must be a list of { item, index }`);
  }
}

function checkReadiness(v: unknown): void {
  if (!isReadiness(v)) {
    throw new CommandError('invalid-field', `Readiness needs a state (${READINESS_STATES.join(', ')}) for each of ${TIMES_KEYS.join(', ')}`);
  }
}

/**
 * Applies a patch (null clears a field) and returns the patch that undoes it. Only the
 * listed fields may be patched, with values of the right type; anything else is refused.
 */
function applyPatch<T extends object>(
  value: T,
  patch: object,
  fields: Readonly<Record<string, FieldSpec>>,
): { value: T; undo: Record<string, unknown>; keys: string[] } {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new CommandError('invalid-field', 'A patch must be an object');
  }
  const next = { ...value } as Record<string, unknown>;
  const before = value as Record<string, unknown>;
  const undo: Record<string, unknown> = {};
  const keys: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const spec = Object.hasOwn(fields, k) ? fields[k] : undefined;
    if (!spec) throw new CommandError('invalid-field', `"${k}" cannot be changed here`);
    if (v === null) {
      if (!spec.optional) throw new CommandError('invalid-field', `${fieldLabel(k)} cannot be cleared`);
    } else {
      checkFieldType(k, v, spec);
    }
    undo[k] = k in before && before[k] !== undefined ? before[k] : null;
    if (v === null) delete next[k];
    else next[k] = v;
    keys.push(k);
  }
  return { value: next as T, undo, keys };
}

function dropUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

const FIELD_LABELS: Record<string, string> = {
  durationDays: 'duration',
  percentComplete: '% complete',
  startNoEarlierThan: 'start no earlier than',
  actualStart: 'actual start',
  actualFinish: 'actual finish',
  templateKey: 'template key',
  templateId: 'template',
  templateVersion: 'template version',
};

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * How tags are compared for duplicates: trimmed, case-insensitive. "PNL-1a" and "PNL-1A"
 * name the same piece of equipment.
 */
export function tagKey(tag: string): string {
  return tag.trim().toUpperCase();
}

function slug(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'asset';
}

function uniqueId(base: string, used: Set<Id>): Id {
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
