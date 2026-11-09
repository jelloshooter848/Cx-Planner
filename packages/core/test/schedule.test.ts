import { describe, expect, it } from 'vitest';
import { computeSchedule, ScheduleCycleError, type Project, type Task, type Dependency } from '../src/index.js';

function task(id: string, durationDays: number, extra: Partial<Task> = {}): Task {
  return { id, assetId: 'A', code: id, name: id, type: 'task', durationDays, percentComplete: 0, ...extra };
}
function dep(p: string, s: string, type: Dependency['type'] = 'FS', lagDays = 0): Dependency {
  return { predecessorId: p, successorId: s, type, lagDays };
}
function project(tasks: Task[], dependencies: Dependency[], dataDate = '2026-11-02'): Project {
  return {
    id: 'p', name: 'p', startDate: '2026-11-02', dataDate,
    calendar: { workWeekdays: [1, 2, 3, 4, 5], holidays: [] },
    assets: [{ id: 'A', tag: 'A', description: '' }], tasks, dependencies,
  };
}

describe('computeSchedule', () => {
  it('chains finish-to-start tasks over weekends', () => {
    const r = computeSchedule(project([task('a', 2), task('b', 4), task('c', 0, { type: 'milestone' })], [dep('a', 'b'), dep('b', 'c')]));
    expect(r.tasks.get('a')).toMatchObject({ start: '2026-11-02', finish: '2026-11-03' });
    expect(r.tasks.get('b')).toMatchObject({ start: '2026-11-04', finish: '2026-11-09' });
    expect(r.tasks.get('c')).toMatchObject({ start: '2026-11-10', finish: '2026-11-10', es: 6, ef: 6 });
    expect(r.projectFinish).toBe('2026-11-09');
  });

  it('finds float and the critical path', () => {
    // a(5) -> c(1); b(2) -> c. b has 3 days float.
    const r = computeSchedule(project([task('a', 5), task('b', 2), task('c', 1)], [dep('a', 'c'), dep('b', 'c')]));
    expect(r.tasks.get('a')!.critical).toBe(true);
    expect(r.tasks.get('c')!.critical).toBe(true);
    expect(r.tasks.get('b')).toMatchObject({ totalFloat: 3, critical: false });
  });

  it('handles SS, FF and SF links with lag', () => {
    const r = computeSchedule(
      project(
        [task('a', 5), task('ss', 3), task('ff', 2), task('sf', 2)],
        [dep('a', 'ss', 'SS', 2), dep('a', 'ff', 'FF', 1), dep('a', 'sf', 'SF', 3)],
      ),
    );
    expect(r.tasks.get('ss')!.es).toBe(2);
    expect(r.tasks.get('ff')!.ef).toBe(6);
    expect(r.tasks.get('sf')!.ef).toBe(3);
  });

  it('respects start-no-earlier-than and the data date', () => {
    const r = computeSchedule(
      project([task('a', 2, { startNoEarlierThan: '2026-11-11' }), task('b', 1)], [], '2026-11-04'),
    );
    expect(r.tasks.get('a')!.start).toBe('2026-11-11');
    expect(r.tasks.get('b')!.start).toBe('2026-11-04');
  });

  it('pins finished work and finishes started work from the data date', () => {
    const r = computeSchedule(
      project(
        [
          task('done', 2, { percentComplete: 100, actualStart: '2026-11-02', actualFinish: '2026-11-04' }),
          task('half', 4, { percentComplete: 50, actualStart: '2026-11-05' }),
          task('next', 1),
        ],
        [dep('done', 'half'), dep('half', 'next')],
        '2026-11-10',
      ),
    );
    expect(r.tasks.get('done')).toMatchObject({ finish: '2026-11-04', critical: false });
    // Started Nov 5, 2 days remain from data date Nov 10 -> finishes Nov 11.
    expect(r.tasks.get('half')).toMatchObject({ start: '2026-11-05', finish: '2026-11-11' });
    expect(r.tasks.get('next')!.start).toBe('2026-11-12');
  });

  it('reports dependency loops', () => {
    expect(() => computeSchedule(project([task('a', 1), task('b', 1)], [dep('a', 'b'), dep('b', 'a')]))).toThrow(
      ScheduleCycleError,
    );
  });
});
