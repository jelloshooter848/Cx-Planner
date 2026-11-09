/**
 * Moving between the editable cells of the grid's progress mode, for fast weekly entry:
 * Enter goes down to the same column of the next task, Tab goes across the row and on to
 * the next task's first cell, Shift+Tab goes back. Group rows are skipped. Pure; unit-tested.
 */
import type { Id } from '@cx/core';
import type { GanttRow } from './gantt-layout';

/** The progress-mode cells, left to right: % complete, actual start, actual finish. */
export const PROGRESS_FIELDS = ['pct', 'astart', 'afinish'] as const;
export type ProgressField = (typeof PROGRESS_FIELDS)[number];

export type CellMove = 'down' | 'next' | 'prev';

export interface Cell {
  id: Id;
  field: ProgressField;
}

export function isProgressField(field: string): field is ProgressField {
  return (PROGRESS_FIELDS as readonly string[]).includes(field);
}

/** The cell after `from` in direction `move`, or null at the end of the list (or when `from` is not shown). */
export function nextProgressCell(rows: readonly GanttRow[], from: Cell, move: CellMove): Cell | null {
  const ids: Id[] = [];
  for (const r of rows) if (r.kind === 'task') ids.push(r.task.id);
  const row = ids.indexOf(from.id);
  if (row < 0) return null;
  const col = PROGRESS_FIELDS.indexOf(from.field);
  const n = PROGRESS_FIELDS.length;
  let pos: number;
  if (move === 'down') pos = (row + 1) * n + col;
  else pos = row * n + col + (move === 'next' ? 1 : -1);
  if (pos < 0 || pos >= ids.length * n) return null;
  return { id: ids[Math.floor(pos / n)]!, field: PROGRESS_FIELDS[pos % n]! };
}
