import { describe, expect, it } from 'vitest';
import type { Task } from '@cx/core';
import {
  currentLookAheadWindow,
  DAY_WIDTHS,
  defaultSettings,
  defaultTestSheetTasks,
  fitScale,
  isTaskComplete,
  lookAheadStarts,
  mondayOf,
  printRequest,
  selectTestSheetTasks,
  type TestSheetContext,
} from '../src/renderer/dialogs/Print/print-options.js';

describe('print dialog options', () => {
  it('starts look-aheads on Mondays around the data date', () => {
    expect(mondayOf('2026-11-06')).toBe('2026-11-02');
    expect(mondayOf('2026-11-08')).toBe('2026-11-02'); // Sunday ends the week
    expect(mondayOf('2026-11-09')).toBe('2026-11-09');
    const starts = lookAheadStarts('2026-11-06', 1, 2);
    expect(starts).toEqual([
      ['2026-10-26', 'Week of Oct 26, 2026'],
      ['2026-11-02', 'Week of Nov 2, 2026 (data date)'],
      ['2026-11-09', 'Week of Nov 9, 2026'],
      ['2026-11-16', 'Week of Nov 16, 2026'],
    ]);
  });

  it('builds each kind of request from the settings', () => {
    const s = { ...defaultSettings('2026-11-06', ['t1', 't2'], false), note: 'Progress update' };
    expect(printRequest('lookahead', s, null)).toEqual({ kind: 'lookahead', paper: 'tabloid', weeks: 3, start: '2026-11-02', assetIds: null, showTimes: true, note: 'Progress update' });
    expect(printRequest('full-schedule', s, null)).toEqual({ kind: 'full-schedule', paper: 'ansi-d', dayWidthIn: null, assetIds: null, note: 'Progress update' });
    expect(printRequest('test-sheets', s, null)).toEqual({ kind: 'test-sheets', taskIds: ['t1', 't2'], note: 'Progress update' });
  });

  it('fits the full schedule to the sheet width by default', () => {
    const s = defaultSettings('2026-11-06', [], false);
    expect(s.fullSchedule.dayWidthIn).toBeNull();
    expect(DAY_WIDTHS.find(([w]) => w === s.fullSchedule.dayWidthIn)?.[1]).toBe('Fit to sheet width');
  });

  it('limits schedule prints to the asset filter only when one is set and chosen', () => {
    const s = defaultSettings('2026-11-06', [], true);
    expect(s.lookAhead.assets).toBe('filter');
    expect(printRequest('lookahead', s, ['a'])).toMatchObject({ assetIds: ['a'] });
    expect(printRequest('lookahead', s, null)).toMatchObject({ assetIds: null });
    expect(printRequest('full-schedule', { ...s, fullSchedule: { ...s.fullSchedule, assets: 'all' } }, ['a'])).toMatchObject({ assetIds: null });
  });

  it('fits a sheet in the preview box without enlarging it', () => {
    expect(fitScale(1632, 1056, 816, 1056)).toBe(0.5);
    expect(fitScale(816, 1056, 2000, 528)).toBe(0.5);
    expect(fitScale(100, 100, 2000, 2000)).toBe(1);
    expect(fitScale(100, 100, 0, 0)).toBe(1);
  });
});

describe('test-sheet selection', () => {
  const task = (id: string, assetId: string, extra: Partial<Task> = {}): Task => ({ id, assetId, code: id, name: id, type: 'task', durationDays: 1, percentComplete: 0, ...extra });
  const tasks: Task[] = [
    task('before', 'a1'), // starts the Friday before the window
    task('first', 'a1'), // starts on the window's first day
    task('last', 'a1'), // starts on the window's last day
    task('after', 'a2'), // starts the Monday after the window
    task('done', 'a2', { percentComplete: 100 }),
    task('finished', 'a2', { percentComplete: 80, actualStart: '2026-11-03', actualFinish: '2026-11-05' }),
    task('partial', 'a2', { percentComplete: 50 }),
    task('spans', 'a1'), // started before the window, still running in it
    task('ms', 'a1', { type: 'milestone', durationDays: 0 }), // milestone with no checklist
    task('unscheduled', 'a1'),
  ];
  const d = (start: string, finish = start) => ({ start, finish });
  const schedule = {
    before: d('2026-10-30'),
    first: d('2026-11-02', '2026-11-04'),
    last: d('2026-11-20', '2026-11-24'),
    after: d('2026-11-23'),
    done: d('2026-11-09'),
    finished: d('2026-11-03', '2026-11-05'),
    partial: d('2026-11-10'),
    spans: d('2026-10-28', '2026-11-05'),
    ms: d('2026-11-12'),
  };
  const window = { start: '2026-11-02', end: '2026-11-20' };
  const ctx: TestSheetContext = { project: { tasks }, schedule, window, filter: null };
  // Every task but the milestone has a checklist; 'gone' was deleted since the dialog opened.
  const checklist = ['before', 'first', 'last', 'after', 'done', 'finished', 'partial', 'spans', 'unscheduled', 'gone'];

  it('defaults to incomplete tasks starting inside the look-ahead window, edges included', () => {
    expect(defaultTestSheetTasks(checklist, ctx)).toEqual(['first', 'last', 'partial']);
    expect(selectTestSheetTasks('window', checklist, ctx)).toEqual(['first', 'last', 'partial']);
  });

  it('never picks a milestone without a checklist', () => {
    // The milestone is incomplete and starts in the window, but has no test sheet to print. Milestones
    // are left out because the main process omits them from setup.checklistTasks (they have no checklist);
    // the checklist id list passed in is the only gate.
    for (const rule of ['window', 'open', 'all'] as const) expect(selectTestSheetTasks(rule, checklist, ctx)).not.toContain('ms');
    // Were it in the list, the same incomplete, in-window milestone would be picked.
    expect(selectTestSheetTasks('window', [...checklist, 'ms'], ctx)).toContain('ms');
  });

  it('picks nothing in window when there is no window', () => {
    expect(selectTestSheetTasks('window', checklist, { ...ctx, window: null })).toEqual([]);
  });

  it('offers not complete, asset filter, all and clear', () => {
    expect(selectTestSheetTasks('open', checklist, ctx)).toEqual(['before', 'first', 'last', 'after', 'partial', 'spans', 'unscheduled']);
    expect(selectTestSheetTasks('filter', checklist, ctx)).toEqual([]);
    expect(selectTestSheetTasks('filter', checklist, { ...ctx, filter: ['a2'] })).toEqual(['after', 'done', 'finished', 'partial']);
    expect(selectTestSheetTasks('all', checklist, ctx)).toEqual(checklist.filter((id) => id !== 'gone'));
    expect(selectTestSheetTasks('none', checklist, ctx)).toEqual([]);
  });

  it('treats an actual finish or 100 % as complete', () => {
    expect(isTaskComplete({ percentComplete: 100 })).toBe(true);
    expect(isTaskComplete({ percentComplete: 20, actualFinish: '2026-11-05' })).toBe(true);
    expect(isTaskComplete({ percentComplete: 99 })).toBe(false);
  });

  it('uses the Schedule look-ahead window from the data-date week', () => {
    const project = { dataDate: '2026-11-06', startDate: '2026-11-02', calendar: { workWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-11-02'] } };
    expect(currentLookAheadWindow(project, 3)).toEqual({ start: '2026-11-03', end: '2026-11-20' });
    expect(currentLookAheadWindow(project, 0)).toBeNull();
  });
});
