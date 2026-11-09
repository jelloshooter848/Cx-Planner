import { describe, expect, it } from 'vitest';
import { riversideProject } from '@cx/fixtures';
import { scheduleView } from '../src/main/session.js';
import { buildRows } from '../src/renderer/views/Schedule/gantt-layout.js';
import { isProgressField, nextProgressCell } from '../src/renderer/views/Schedule/progress-grid.js';

const riverside = riversideProject();
const rows = buildRows(riverside, scheduleView(riverside).schedule);
const taskIds = rows.flatMap((r) => (r.kind === 'task' ? [r.task.id] : []));

describe('progress mode cell moves', () => {
  it('goes down the same column, skipping asset rows', () => {
    // The last task of the first asset is followed by the second asset's group row.
    const lastOfFirst = rows.findIndex((r, i) => r.kind === 'task' && rows[i + 1]?.kind === 'group');
    const from = (rows[lastOfFirst] as { task: { id: string } }).task.id;
    const to = taskIds[taskIds.indexOf(from) + 1]!;
    expect(nextProgressCell(rows, { id: from, field: 'astart' }, 'down')).toEqual({ id: to, field: 'astart' });
  });

  it('goes across the row with Tab and wraps to the next task', () => {
    const [a, b] = taskIds;
    expect(nextProgressCell(rows, { id: a!, field: 'pct' }, 'next')).toEqual({ id: a, field: 'astart' });
    expect(nextProgressCell(rows, { id: a!, field: 'afinish' }, 'next')).toEqual({ id: b, field: 'pct' });
    expect(nextProgressCell(rows, { id: b!, field: 'pct' }, 'prev')).toEqual({ id: a, field: 'afinish' });
  });

  it('stops at the ends and for tasks not shown', () => {
    const last = taskIds[taskIds.length - 1]!;
    expect(nextProgressCell(rows, { id: taskIds[0]!, field: 'pct' }, 'prev')).toBeNull();
    expect(nextProgressCell(rows, { id: last, field: 'pct' }, 'down')).toBeNull();
    expect(nextProgressCell(rows, { id: last, field: 'afinish' }, 'next')).toBeNull();
    expect(nextProgressCell(rows, { id: 'nope', field: 'pct' }, 'down')).toBeNull();
  });

  it('knows the progress fields', () => {
    expect(['pct', 'astart', 'afinish', 'name', 'dur'].map(isProgressField)).toEqual([true, true, true, false, false]);
  });
});
