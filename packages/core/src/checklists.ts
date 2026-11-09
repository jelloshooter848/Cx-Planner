import type { Asset, Project, Task } from './model.js';
import type { Template, TemplateTask } from './template.js';

/** A project task that has a test-sheet checklist, with where the checklist came from. */
export interface TaskChecklist {
  task: Task;
  asset: Asset;
  template: Template;
  templateTask: TemplateTask;
}

/**
 * The project's tasks that print a test sheet: those created from a template task with at
 * least one checklist item. The checklist is read from the template snapshot stored in the
 * project (decision D4), found by the asset's template id and the task's template key.
 * Tasks typed in by hand, or whose template snapshot is missing, have no checklist.
 * Returned in schedule order: assets in project order, tasks in project order.
 */
export function taskChecklists(project: Project, templates: readonly Template[]): TaskChecklist[] {
  const byId = new Map(templates.map((t) => [t.id, t]));
  const assets = new Map(project.assets.map((a, i) => [a.id, { asset: a, order: i }]));
  const out: Array<TaskChecklist & { order: number; index: number }> = [];
  project.tasks.forEach((task, index) => {
    const entry = assets.get(task.assetId);
    if (!entry || !task.templateKey || !entry.asset.templateId) return;
    const template = byId.get(entry.asset.templateId);
    const templateTask = template?.tasks.find((tt) => tt.key === task.templateKey);
    if (!template || !templateTask || templateTask.checklist.length === 0) return;
    out.push({ task, asset: entry.asset, template, templateTask, order: entry.order, index });
  });
  return out.sort((a, b) => a.order - b.order || a.index - b.index).map(({ task, asset, template, templateTask }) => ({ task, asset, template, templateTask }));
}
