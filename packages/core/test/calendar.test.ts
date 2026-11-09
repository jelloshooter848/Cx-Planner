import { describe, expect, it } from 'vitest';
import { WorkCalendar, weekday } from '../src/index.js';

describe('WorkCalendar', () => {
  const cal = new WorkCalendar('2026-11-02', { workWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-11-26'] });

  it('maps indexes to working days, skipping weekends and holidays', () => {
    expect(cal.dateAt(0)).toBe('2026-11-02');
    expect(cal.dateAt(4)).toBe('2026-11-06');
    expect(cal.dateAt(5)).toBe('2026-11-09');
    // Nov 26 is a holiday: Nov 25 is index 17, Nov 27 is index 18.
    expect(cal.dateAt(17)).toBe('2026-11-25');
    expect(cal.dateAt(18)).toBe('2026-11-27');
  });

  it('maps dates back to indexes; non-working dates roll forward', () => {
    expect(cal.indexOf('2026-11-09')).toBe(5);
    expect(cal.indexOf('2026-11-07')).toBe(5);
    expect(cal.indexOf('2026-11-26')).toBe(18);
    expect(cal.indexOf('2026-10-30')).toBe(-1);
    expect(cal.dateAt(-1)).toBe('2026-10-30');
  });

  it('round-trips over a long range', () => {
    for (let i = 0; i < 600; i += 7) expect(cal.indexOf(cal.dateAt(i))).toBe(i);
  });

  it('counts working days between dates', () => {
    expect(cal.workdaysBetween('2026-11-02', '2026-11-16')).toBe(10);
    expect(weekday('2026-11-02')).toBe(1);
  });
});
