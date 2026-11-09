import { describe, expect, it } from 'vitest';
import { computeSchedule } from '@cx/core';
import { largeProject, riversideProject } from '../src/index.js';

describe('fixtures', () => {
  it('riverside schedules to the dates shown in the mockups', () => {
    const r = computeSchedule(riversideProject());
    const d = (id: string) => r.tasks.get(id)!;
    expect(d('t1.3')).toMatchObject({ start: '2026-11-06', finish: '2026-11-09' });
    expect(d('t1.4')).toMatchObject({ start: '2026-11-10', finish: '2026-11-13' });
    expect(d('t1.5')).toMatchObject({ start: '2026-11-16', finish: '2026-11-17' });
    expect(d('t1.6').start).toBe('2026-11-18');
    expect(d('t2.5').start).toBe('2026-11-18');
    expect(d('t3.1').start).toBe('2026-11-19');
    expect(d('t1.4').critical).toBe(true);
  });

  it('large sample has 200+ tasks and schedules cleanly', () => {
    const p = largeProject();
    expect(p.tasks.length).toBeGreaterThanOrEqual(200);
    const r = computeSchedule(p);
    expect(r.tasks.size).toBe(p.tasks.length);
  });
});
