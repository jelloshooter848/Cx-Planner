import { describe, expect, it } from 'vitest';
import { applyCommand, planProgress, progressCommand, type ProgressChange, type ProgressContext, type Project, type Task } from '../src/index.js';

const ctx: ProgressContext = { dataDate: '2026-11-06', computedStart: '2026-11-04' };

function task(extra: Partial<Task> = {}): Task {
  return { id: 't1', assetId: 'a1', code: '1.1', name: 'IR test', type: 'task', durationDays: 3, percentComplete: 0, ...extra };
}

const plan = (t: Task, change: ProgressChange, c: ProgressContext = ctx) => planProgress(t, change, c);

describe('planProgress', () => {
  it('fills in the actual start from the computed start when % goes above 0', () => {
    expect(plan(task(), { percentComplete: 40 })).toEqual({ kind: 'patch', patch: { percentComplete: 40, actualStart: '2026-11-04' } });
    // An existing actual start is kept.
    expect(plan(task({ actualStart: '2026-11-03' }), { percentComplete: 40 })).toEqual({ kind: 'patch', patch: { percentComplete: 40 } });
    // A computed start after the data date: the data date (progress is as of that date).
    expect(plan(task(), { percentComplete: 40 }, { dataDate: '2026-11-06', computedStart: '2026-11-10' })).toEqual({
      kind: 'patch',
      patch: { percentComplete: 40, actualStart: '2026-11-06' },
    });
    // No computed schedule: the data date.
    expect(plan(task(), { percentComplete: 10 }, { dataDate: '2026-11-06', computedStart: null })).toEqual({
      kind: 'patch',
      patch: { percentComplete: 10, actualStart: '2026-11-06' },
    });
  });

  it('asks for an actual finish, defaulting to the data date, when % is set to 100', () => {
    expect(plan(task(), { percentComplete: 100 })).toEqual({ kind: 'needs-finish', finish: '2026-11-06', start: '2026-11-04' });
    expect(plan(task({ actualStart: '2026-11-02', percentComplete: 50 }), { percentComplete: 100 })).toEqual({ kind: 'needs-finish', finish: '2026-11-06', start: null });
    // The default start is no later than the default finish.
    expect(plan(task(), { percentComplete: 100 }, { dataDate: '2026-11-06', computedStart: '2026-11-12' })).toEqual({ kind: 'needs-finish', finish: '2026-11-06', start: '2026-11-06' });
    // A start after the data date pushes the default finish to it.
    expect(plan(task({ actualStart: '2026-11-09', percentComplete: 50 }), { percentComplete: 100 })).toMatchObject({ finish: '2026-11-09' });
    // Answered: one patch with all three fields.
    expect(plan(task(), { percentComplete: 100, actualStart: '2026-11-02', actualFinish: '2026-11-05' })).toEqual({
      kind: 'patch',
      patch: { percentComplete: 100, actualStart: '2026-11-02', actualFinish: '2026-11-05' },
    });
  });

  it('sets 100% when an actual finish is entered, and fills the start no later than the finish', () => {
    expect(plan(task({ actualStart: '2026-11-02', percentComplete: 30 }), { actualFinish: '2026-11-05' })).toEqual({
      kind: 'patch',
      patch: { percentComplete: 100, actualFinish: '2026-11-05' },
    });
    expect(plan(task(), { actualFinish: '2026-11-03' })).toEqual({
      kind: 'patch',
      patch: { percentComplete: 100, actualStart: '2026-11-03', actualFinish: '2026-11-03' },
    });
  });

  it('rejects a finish before the start', () => {
    expect(plan(task({ actualStart: '2026-11-05' }), { actualFinish: '2026-11-04' })).toMatchObject({ kind: 'error', code: 'finish-before-start' });
    expect(plan(task({ actualStart: '2026-11-02', actualFinish: '2026-11-04', percentComplete: 100 }), { actualStart: '2026-11-05' })).toMatchObject({
      kind: 'error',
      code: 'finish-before-start',
    });
    expect(plan(task(), { percentComplete: 100, actualStart: '2026-11-05', actualFinish: '2026-11-04' })).toMatchObject({ code: 'finish-before-start' });
  });

  it('reopens a finished task when % goes below 100', () => {
    const done = task({ actualStart: '2026-11-02', actualFinish: '2026-11-04', percentComplete: 100 });
    expect(plan(done, { percentComplete: 80 })).toEqual({ kind: 'patch', patch: { percentComplete: 80, actualFinish: null } });
    // 0% keeps the actual start: the task started but has nothing done.
    expect(plan(done, { percentComplete: 0 })).toEqual({ kind: 'patch', patch: { percentComplete: 0, actualFinish: null } });
  });

  it('resets the task when the actual start is cleared', () => {
    const done = task({ actualStart: '2026-11-02', actualFinish: '2026-11-04', percentComplete: 100 });
    expect(plan(done, { actualStart: null })).toEqual({ kind: 'patch', patch: { percentComplete: 0, actualStart: null, actualFinish: null } });
  });

  it('refuses to clear the finish of a 100% task, but allows it with a lower %', () => {
    const done = task({ actualStart: '2026-11-02', actualFinish: '2026-11-04', percentComplete: 100 });
    expect(plan(done, { actualFinish: null })).toMatchObject({ kind: 'error', code: 'clear-finish-at-100' });
    expect(plan(done, { actualFinish: null, percentComplete: 90 })).toEqual({ kind: 'patch', patch: { percentComplete: 90, actualFinish: null } });
    expect(plan(done, { actualFinish: '2026-11-05', percentComplete: 90 })).toMatchObject({ kind: 'error', code: 'finish-below-100' });
  });

  it('sets an actual start alone without touching %', () => {
    expect(plan(task(), { actualStart: '2026-11-05' })).toEqual({ kind: 'patch', patch: { actualStart: '2026-11-05' } });
  });

  it('returns an empty patch when nothing changes', () => {
    expect(plan(task({ percentComplete: 20, actualStart: '2026-11-02' }), { percentComplete: 20 })).toEqual({ kind: 'patch', patch: {} });
    expect(progressCommand('t1', {})).toBeNull();
  });

  it('checks values', () => {
    expect(plan(task(), { percentComplete: 101 })).toMatchObject({ code: 'invalid-percent' });
    expect(plan(task(), { percentComplete: Number.NaN })).toMatchObject({ code: 'invalid-percent' });
    expect(plan(task(), { actualStart: '2026-02-30' })).toMatchObject({ code: 'invalid-date' });
    expect(plan(task(), { actualFinish: 'Nov 5' })).toMatchObject({ code: 'invalid-date' });
  });

  it('treats milestones as 0% or 100%, starting when they finish', () => {
    const m = task({ type: 'milestone', durationDays: 0 });
    expect(plan(m, { percentComplete: 50 })).toMatchObject({ kind: 'error', code: 'milestone-percent' });
    expect(plan(m, { percentComplete: 100 })).toEqual({ kind: 'needs-finish', finish: '2026-11-06', start: null });
    expect(plan(m, { percentComplete: 100, actualFinish: '2026-11-05' })).toEqual({
      kind: 'patch',
      patch: { percentComplete: 100, actualStart: '2026-11-05', actualFinish: '2026-11-05' },
    });
  });

  it('gives a patch that applies as one undoable updateTask command', () => {
    const project: Project = {
      id: 'p',
      name: 'Sample',
      startDate: '2026-11-02',
      dataDate: '2026-11-06',
      calendar: { workWeekdays: [1, 2, 3, 4, 5], holidays: [] },
      assets: [{ id: 'a1', tag: 'SWGR-1', description: 'Switchgear' }],
      tasks: [task()],
      dependencies: [],
    };
    const r = plan(project.tasks[0]!, { actualFinish: '2026-11-05' });
    if (r.kind !== 'patch') throw new Error('expected a patch');
    const cmd = progressCommand('t1', r.patch)!;
    const applied = applyCommand(project, cmd);
    expect(applied.project.tasks[0]).toMatchObject({ percentComplete: 100, actualStart: '2026-11-04', actualFinish: '2026-11-05' });
    expect(applied.summary).toBe('Updated 1.1: % complete, actual start, actual finish');
    expect(applyCommand(applied.project, applied.inverse).project).toEqual(project);
  });
});
