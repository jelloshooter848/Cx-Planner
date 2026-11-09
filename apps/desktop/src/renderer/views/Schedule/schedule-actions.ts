/**
 * What the Schedule toolbar's edit buttons do, as plain functions of the project and the
 * selection: each returns the command to send and a label for the button's tooltip, or the
 * reason the button is disabled. Kept free of React so it can be unit-tested.
 *
 * Tasks have no outline levels inside an asset, so Indent and Outdent move the selected task
 * between the assets in view: Indent moves it into the asset above (as its last task),
 * Outdent into the asset below (as its first task). Alt+Up / Alt+Down reorder a task inside
 * its asset (moveTaskAction).
 */
import type { Command, Id, Project, Task } from '@cx/core';

export type ToolAction = { ok: true; command: Command; label: string } | { ok: false; reason: string };

/** Name given to a task made with Add task (the user renames it in the panel or grid). */
export const NEW_TASK_NAME = 'New task';

const findTask = (project: Project, id: Id | null | undefined): Task | undefined => (id ? project.tasks.find((t) => t.id === id) : undefined);

/**
 * Add task: a 1-day task right after the selected task, in its asset. With no task selected
 * it goes at the end of the first asset in view that has no tasks, or of the only asset in
 * view. `newId` is the new task's id; `assetsInView` as for shiftAction.
 */
export function addTaskAction(project: Project, selectedId: Id | null, newId: Id, assetsInView: readonly Id[] | null = null): ToolAction {
  const task = findTask(project, selectedId);
  if (task) {
    return {
      ok: true,
      command: { kind: 'addTask', assetId: task.assetId, afterTaskId: task.id, id: newId, task: { name: NEW_TASK_NAME } },
      label: `Add a task after ${task.code}`,
    };
  }
  const shown = assetsInView ? new Set(assetsInView) : null;
  const inView = project.assets.filter((a) => !shown || shown.has(a.id));
  const asset = inView.find((a) => !project.tasks.some((t) => t.assetId === a.id)) ?? (inView.length === 1 ? inView[0] : undefined);
  if (!asset) return { ok: false, reason: 'Select a task to add a new one after it' };
  return {
    ok: true,
    command: { kind: 'addTask', assetId: asset.id, id: newId, task: { name: NEW_TASK_NAME } },
    label: `Add a task to ${asset.tag}`,
  };
}

/** True when `to` can be reached from `from` by following links forward. */
function follows(project: Project, from: Id, to: Id): boolean {
  const next = new Map<Id, Id[]>();
  for (const d of project.dependencies) next.set(d.predecessorId, [...(next.get(d.predecessorId) ?? []), d.successorId]);
  const seen = new Set<Id>([from]);
  const stack = [from];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    for (const n of next.get(id) ?? []) {
      if (n === to) return true;
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return false;
}

/**
 * Link tasks: the first selected task finish-to-start before the second (Ctrl+click, or
 * Cmd+click on a Mac, picks the second). Disabled when the link exists or would make a loop.
 */
export function linkAction(project: Project, selectedIds: readonly Id[], mac = false): ToolAction {
  if (selectedIds.length !== 2) {
    const gesture = mac ? 'Cmd+click' : 'Ctrl+click';
    return { ok: false, reason: selectedIds.length < 2 ? `Select a task, then ${gesture} a second task to link them` : 'Select exactly two tasks to link them' };
  }
  const pred = findTask(project, selectedIds[0]);
  const succ = findTask(project, selectedIds[1]);
  if (!pred || !succ) return { ok: false, reason: 'Select two tasks to link them' };
  if (project.dependencies.some((d) => d.predecessorId === pred.id && d.successorId === succ.id)) {
    return { ok: false, reason: `${succ.code} already follows ${pred.code}` };
  }
  if (project.dependencies.some((d) => d.predecessorId === succ.id && d.successorId === pred.id)) {
    return { ok: false, reason: `${pred.code} already follows ${succ.code}` };
  }
  if (follows(project, succ.id, pred.id)) {
    return { ok: false, reason: `Linking would make a loop: ${pred.code} already comes after ${succ.code}` };
  }
  return {
    ok: true,
    command: { kind: 'link', predecessorId: pred.id, successorId: succ.id, type: 'FS', lagDays: 0 },
    label: `Link ${pred.code} → ${succ.code} (finish-to-start)`,
  };
}

/**
 * Indent ('indent') or Outdent ('outdent') the selected task: move it into the asset above
 * or below it among `assetsInView` (asset ids in Gantt order; null = every asset).
 */
export function shiftAction(project: Project, selectedId: Id | null, assetsInView: readonly Id[] | null, dir: 'indent' | 'outdent'): ToolAction {
  const task = findTask(project, selectedId);
  if (!task) return { ok: false, reason: `Select a task to move it into the asset ${dir === 'indent' ? 'above' : 'below'}` };
  const shown = assetsInView ? new Set(assetsInView) : null;
  const order = project.assets.filter((a) => a.id === task.assetId || !shown || shown.has(a.id));
  const here = order.findIndex((a) => a.id === task.assetId);
  const target = order[dir === 'indent' ? here - 1 : here + 1];
  if (!target) return { ok: false, reason: `${task.code} is in the ${dir === 'indent' ? 'first' : 'last'} asset in view` };
  const size = project.tasks.filter((t) => t.assetId === target.id).length;
  return {
    ok: true,
    command: { kind: 'moveTask', id: task.id, toAssetId: target.id, toIndex: dir === 'indent' ? size : 0 },
    label: `Move ${task.code} into ${target.tag} (${dir === 'indent' ? 'above' : 'below'})`,
  };
}

/** Moves the selected task one place up (-1) or down (+1) inside its asset. */
export function moveTaskAction(project: Project, selectedId: Id | null, delta: -1 | 1): ToolAction {
  const task = findTask(project, selectedId);
  if (!task) return { ok: false, reason: 'Select a task to move it' };
  const group = project.tasks.filter((t) => t.assetId === task.assetId);
  const at = group.indexOf(task) + delta;
  if (at < 0 || at >= group.length) return { ok: false, reason: `${task.code} is already ${delta < 0 ? 'first' : 'last'} in its asset` };
  return { ok: true, command: { kind: 'moveTask', id: task.id, toAssetId: task.assetId, toIndex: at }, label: `Move ${task.code} ${delta < 0 ? 'up' : 'down'}` };
}
