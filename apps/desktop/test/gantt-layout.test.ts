import { describe, expect, it } from 'vitest';
import { largeProject, riversideProject } from '@cx/fixtures';
import type { Project } from '@cx/core';
import { scheduleView } from '../src/main/session.js';
import {
  barShape,
  buildRows,
  DAY_WIDTH,
  dateAtX,
  headerTicks,
  makeScale,
  moveSelection,
  progressOf,
  rowIndexOfTask,
  scrollToRow,
  visibleRows,
  visibleSpan,
  weekendDays,
  xOf,
  type TaskRow,
} from '../src/renderer/views/Schedule/gantt-layout.js';

const riverside = riversideProject();
const sched = scheduleView(riverside).schedule;
const task = (p: Project, code: string) => p.tasks.find((t) => t.code === code)!;

describe('gantt rows', () => {
  it('puts a group row before each asset and its tasks, in project order', () => {
    const rows = buildRows(riverside, sched);
    expect(rows).toHaveLength(riverside.assets.length + riverside.tasks.length);
    const groups = rows.filter((r) => r.kind === 'group');
    expect(groups.map((g) => g.asset.tag)).toEqual(['SWGR-1A', 'XFMR-1A', 'UPS-1A', 'GEN-1']);
    expect(groups.map((g) => g.number)).toEqual([1, 2, 3, 4]);
    expect(rows[0]!.kind).toBe('group');
    expect(rows.slice(1, 7).map((r) => (r as TaskRow).task.code)).toEqual(['1.1', '1.2', '1.3', '1.4', '1.5', '1.6']);
    expect(rows[7]!.kind).toBe('group');
  });

  it('spans each group over its scheduled tasks', () => {
    const g = buildRows(riverside, sched)[0]!;
    expect(g.kind === 'group' && [g.start, g.finish]).toEqual([sched['t1.1']!.start, sched['t1.6']!.finish]);
    const none = buildRows(riverside, {})[0]!;
    expect(none.kind === 'group' && [none.start, none.finish]).toEqual([null, null]);
  });

  it('filters by asset and keeps the asset numbers', () => {
    const rows = buildRows(riverside, sched, new Set(['ups-1a']));
    expect(rows).toHaveLength(5);
    expect(rows[0]!.kind === 'group' && rows[0]!.number).toBe(3);
  });

  it('builds 1000+ rows quickly', () => {
    const big = largeProject(220);
    const s = scheduleView(big).schedule;
    const t0 = performance.now();
    const rows = buildRows(big, s);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(rows.length).toBe(big.assets.length + big.tasks.length);
    expect(big.tasks.length).toBeGreaterThan(1000);
  });
});

describe('gantt selection moves', () => {
  const rows = buildRows(riverside, sched);
  it('steps over group rows and clamps at the ends', () => {
    expect(moveSelection(rows, 't1.6', 1)).toBe('t2.1');
    expect(moveSelection(rows, 't2.1', -1)).toBe('t1.6');
    expect(moveSelection(rows, 't1.1', -1)).toBe('t1.1');
    expect(moveSelection(rows, 't4.4', 5)).toBe('t4.4');
    expect(moveSelection(rows, 't1.1', 7)).toBe('t2.2');
  });
  it('starts at the first task with nothing (or a deleted task) selected', () => {
    expect(moveSelection(rows, null, 1)).toBe('t1.1');
    expect(moveSelection(rows, 'gone', -1)).toBe('t1.1');
    expect(moveSelection(rows, null, 'end')).toBe('t4.4');
    expect(moveSelection(rows, 't3.1', 'home')).toBe('t1.1');
    expect(moveSelection([], null, 1)).toBeNull();
  });
  it('finds the row of a task', () => {
    expect(rowIndexOfTask(rows, 't1.1')).toBe(1);
    expect(rowIndexOfTask(rows, 't2.1')).toBe(8);
    expect(rowIndexOfTask(rows, null)).toBe(-1);
  });
});

describe('gantt time scale', () => {
  it('starts on a Monday at day and week zoom and on the 1st at month zoom', () => {
    const week = makeScale(riverside, sched, 'week');
    expect(dateAtX(week, 0)).toBe('2026-11-02');
    expect(week.dayWidth).toBe(DAY_WIDTH.week);
    const month = makeScale({ ...riverside, startDate: '2026-11-04', dataDate: '2026-11-06' }, sched, 'month');
    expect(dateAtX(month, 0)).toBe('2026-11-01');
    const late = makeScale({ ...riverside, startDate: '2026-11-05' }, {}, 'day');
    expect(dateAtX(late, 0)).toBe('2026-11-02');
  });

  it('covers the last finish with room to spare and fills the minimum width', () => {
    const week = makeScale(riverside, sched, 'week');
    const lastFinish = Object.values(sched).reduce((m, s) => (s.finish > m ? s.finish : m), '');
    expect(xOf(week, lastFinish)).toBeLessThan(week.width - 7 * week.dayWidth);
    expect(week.days % 7).toBe(0);
    const wide = makeScale(riverside, sched, 'week', 5000);
    expect(wide.width).toBeGreaterThanOrEqual(5000);
    expect(wide.days % 7).toBe(0);
  });

  it('zooms: day is wider than week, week wider than month', () => {
    const w = (z: 'day' | 'week' | 'month') => makeScale(riverside, sched, z).dayWidth;
    expect(w('day')).toBeGreaterThan(w('week'));
    expect(w('week')).toBeGreaterThan(w('month'));
  });

  it('maps dates to x and back', () => {
    const s = makeScale(riverside, sched, 'day');
    expect(xOf(s, '2026-11-02')).toBe(0);
    expect(xOf(s, '2026-11-09')).toBe(7 * DAY_WIDTH.day);
    expect(dateAtX(s, 7 * DAY_WIDTH.day + 3)).toBe('2026-11-09');
  });

  it('labels weeks under months, and months under years', () => {
    const week = headerTicks(makeScale(riverside, sched, 'week'));
    expect(week.top[0]!.label).toBe('November 2026');
    expect(week.top[1]!.label).toBe('December');
    expect(week.bottom.slice(0, 3).map((t) => t.label)).toEqual(['Nov 2', 'Nov 9', 'Nov 16']);
    expect(week.bottom[1]!.x).toBe(7 * DAY_WIDTH.week);
    // December starts on a Tuesday, partway through the Nov 30 week.
    expect(week.top[1]!.x).toBe(29 * DAY_WIDTH.week);

    const day = headerTicks(makeScale(riverside, sched, 'day'));
    expect(day.bottom.slice(0, 3).map((t) => t.label)).toEqual(['2', '3', '4']);

    const month = headerTicks(makeScale(riverside, sched, 'month', 2000));
    expect(month.top.map((t) => t.label).slice(0, 2)).toEqual(['2026', '2027']);
    expect(month.bottom.slice(0, 3).map((t) => t.label)).toEqual(['Nov', 'Dec', 'Jan']);
    expect(month.bottom[1]!.x).toBe(30 * DAY_WIDTH.month);
  });

  it('lists weekend days', () => {
    const s = makeScale(riverside, sched, 'day');
    expect(weekendDays(s).slice(0, 2).map((d) => xOf(s, d) / s.dayWidth)).toEqual([5, 6]);
  });
});

describe('gantt bars', () => {
  const scale = makeScale(riverside, sched, 'day');
  it('spans the start day to the end of the finish day', () => {
    const b = barShape(task(riverside, '1.4'), sched['t1.4']!, scale);
    expect(b.kind).toBe('bar');
    expect(b.x0).toBe(xOf(scale, sched['t1.4']!.start));
    expect(b.x1 - b.x0).toBe(4 * scale.dayWidth);
    expect(b.critical).toBe(true);
  });

  it('shows progress, holds, witness points and milestones', () => {
    expect(progressOf(task(riverside, '1.1'))).toBe('complete');
    expect(progressOf(task(riverside, '1.3'))).toBe('progress');
    expect(progressOf(task(riverside, '1.4'))).toBe('not-started');
    expect(barShape(task(riverside, '1.3'), sched['t1.3']!, scale).percent).toBe(50);
    expect(barShape(task(riverside, '1.5'), sched['t1.5']!, scale).marker).toBe('hold');
    expect(barShape(task(riverside, '3.3'), sched['t3.3']!, scale).marker).toBe('witness');
    const m = barShape(task(riverside, '1.6'), sched['t1.6']!, scale);
    expect(m.kind).toBe('milestone');
    expect(m.x1).toBe(m.x0);
  });
});

describe('gantt virtualization', () => {
  it('draws only the rows in view plus overscan', () => {
    expect(visibleRows(0, 310, 31, 1000, 5)).toEqual([0, 15]);
    expect(visibleRows(3100, 310, 31, 1000, 5)).toEqual([95, 115]);
    expect(visibleRows(30_900, 310, 31, 1000, 5)).toEqual([991, 1000]);
    expect(visibleRows(0, 310, 31, 0)).toEqual([0, 0]);
  });

  it('draws a snapped horizontal window', () => {
    expect(visibleSpan(0, 800, 10_000)).toEqual([0, 1200]);
    expect(visibleSpan(1000, 800, 10_000)).toEqual([800, 2000]);
    expect(visibleSpan(9500, 800, 10_000)).toEqual([9200, 10_000]);
    // A small scroll keeps the same window.
    expect(visibleSpan(1150, 800, 10_000)).toEqual(visibleSpan(1050, 800, 10_000));
  });

  it('scrolls just enough to show a row under the sticky header', () => {
    // Viewport 400 px with a 54 px header: 346 px of rows.
    expect(scrollToRow(2, 0, 400, 31, 54)).toBe(0);
    expect(scrollToRow(20, 0, 400, 31, 54)).toBe(21 * 31 - 346);
    expect(scrollToRow(3, 500, 400, 31, 54)).toBe(93);
  });
});
