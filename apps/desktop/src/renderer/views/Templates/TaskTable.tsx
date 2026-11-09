import type { KeyboardEvent } from 'react';
import { formatTemplatePredecessors, moveTemplateTask, removeTemplateTask, type Template } from '@cx/core';
import { TaskTypeSymbol, taskTypeLabel } from '../../components/Symbols';
import { plural } from '../../format';

/**
 * The template's task table (#, Task, Dur, Pred, Type, Trade, Sheet) with row actions to
 * reorder and remove. Click a row (or focus it and press Enter) to edit it in the right
 * panel; Alt+↑/↓ moves the focused row.
 */
export function TaskTable({
  template,
  selectedKey,
  problemKeys,
  onSelect,
  onChange,
  onAdd,
  onRemoved,
}: {
  template: Template;
  selectedKey: string | null;
  /** Tasks with a problem get a "!" mark. */
  problemKeys: ReadonlySet<string>;
  onSelect: (key: string | null) => void;
  onChange: (t: Template) => void;
  onAdd: () => void;
  /** Told after a row is removed, e.g. 'Removed task 3 "Megger feeders"'. */
  onRemoved?: (what: string) => void;
}) {
  const move = (key: string, to: number) => {
    onChange(moveTemplateTask(template, key, to));
    // Keep focus on the moved row so repeated Alt+arrow presses keep moving it.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-task-row="${CSS.escape(key)}"]`)?.focus());
  };
  const remove = (key: string, index: number) => {
    const name = template.tasks[index]?.name.trim();
    onChange(removeTemplateTask(template, key));
    if (selectedKey === key) onSelect(template.tasks[index + 1]?.key ?? template.tasks[index - 1]?.key ?? null);
    onRemoved?.(`Removed task ${index + 1}${name ? ` "${name}"` : ''}`);
  };
  const onRowKey = (e: KeyboardEvent, key: string, i: number) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(key);
    } else if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      move(key, i - 1);
    } else if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      move(key, i + 1);
    } else if (!e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const next = template.tasks[i + (e.key === 'ArrowUp' ? -1 : 1)];
      if (next) {
        onSelect(next.key);
        document.querySelector<HTMLElement>(`[data-task-row="${CSS.escape(next.key)}"]`)?.focus();
      }
    } else if (e.key === 'Delete') {
      e.preventDefault();
      remove(key, i);
    }
  };

  return (
    <div className="panel tpl-tasks">
      {/* role=grid: rows are focusable, arrow-navigable and selectable (aria-selected). */}
      <table className="grid tpl-grid" role="grid" aria-label="Template tasks">
        <thead>
          <tr>
            <th className="col-num">#</th>
            <th>Task</th>
            <th className="col-dur">Dur</th>
            <th className="col-pred">Pred</th>
            <th className="col-type">Type</th>
            <th className="col-trade">Trade</th>
            <th className="col-sheet">Sheet</th>
            <th className="col-actions">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {template.tasks.map((t, i) => {
            const preds = formatTemplatePredecessors(template, t);
            const selected = t.key === selectedKey;
            return (
              <tr
                key={t.key}
                data-task-row={t.key}
                className={selected ? 'is-selected' : undefined}
                aria-selected={selected}
                tabIndex={0}
                onClick={() => onSelect(t.key)}
                onKeyDown={(e) => onRowKey(e, t.key, i)}
              >
                <td className="col-num">{i + 1}</td>
                <td className="tpl-task-name">
                  {problemKeys.has(t.key) && (
                    <span className="conflict-mark" aria-label="Has a problem" title="This task has a problem (see the list below)">
                      !
                    </span>
                  )}
                  {t.name || <span className="muted">(no name)</span>}
                </td>
                <td className="col-dur">{Number.isFinite(t.durationDays) ? t.durationDays : '?'}</td>
                <td className="col-pred">{preds || '—'}</td>
                <td className="col-type">
                  <span className="type-cell">
                    <TaskTypeSymbol type={t.type} />
                    {taskTypeLabel(t.type)}
                  </span>
                </td>
                <td className="col-trade" title={t.trade || undefined}>
                  {t.trade || '—'}
                </td>
                <td className="col-sheet">{t.checklist.length > 0 ? plural(t.checklist.length, 'item') : '—'}</td>
                <td className="col-actions">
                  <span className="row-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Move task ${i + 1} up`}
                      title="Move up (Alt+↑)"
                      disabled={i === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        move(t.key, i - 1);
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Move task ${i + 1} down`}
                      title="Move down (Alt+↓)"
                      disabled={i === template.tasks.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        move(t.key, i + 1);
                      }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove task ${i + 1}`}
                      title="Remove (Delete)"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(t.key, i);
                      }}
                    >
                      ×
                    </button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {template.tasks.length === 0 && <p className="hint pad">No tasks yet. Add the first one.</p>}
      <div className="tpl-tasks-foot">
        <button type="button" className="btn" onClick={onAdd}>
          Add task
        </button>
      </div>
    </div>
  );
}
