import { describe, expect, it } from 'vitest';
import { WorkCalendar } from '@cx/core';
import { lookAheadTitle, lookAheadWindow } from '../src/index.js';

const plain = new WorkCalendar('2026-01-01');
const withHolidays = new WorkCalendar('2026-01-01', {
  workWeekdays: [1, 2, 3, 4, 5],
  holidays: ['2026-09-07', '2026-11-26', '2026-11-27', '2026-12-25', '2027-01-01'],
});

describe('lookAheadWindow', () => {
  it('runs from the Monday of the data-date week to the Friday of the last week', () => {
    expect(lookAheadWindow('2026-11-06', 3, plain)).toEqual({ start: '2026-11-02', end: '2026-11-20' });
    expect(lookAheadWindow('2026-11-02', 3, plain)).toEqual({ start: '2026-11-02', end: '2026-11-20' });
    expect(lookAheadWindow('2026-11-04', 1, plain)).toEqual({ start: '2026-11-02', end: '2026-11-06' });
  });

  it('treats a weekend data date as part of the week that started on Monday', () => {
    expect(lookAheadWindow('2026-11-07', 2, plain)).toEqual({ start: '2026-11-02', end: '2026-11-13' });
    expect(lookAheadWindow('2026-11-08', 2, plain)).toEqual({ start: '2026-11-02', end: '2026-11-13' });
  });

  it('crosses month and year boundaries', () => {
    expect(lookAheadWindow('2026-12-02', 3, plain)).toEqual({ start: '2026-11-30', end: '2026-12-18' });
    expect(lookAheadWindow('2026-12-30', 3, plain)).toEqual({ start: '2026-12-28', end: '2027-01-15' });
    expect(lookAheadWindow('2027-01-01', 3, plain)).toEqual({ start: '2026-12-28', end: '2027-01-15' });
  });

  it('trims holidays off the edges of the window', () => {
    // Labor Day Monday: start on Tuesday.
    expect(lookAheadWindow('2026-09-09', 2, withHolidays)).toEqual({ start: '2026-09-08', end: '2026-09-18' });
    // Thanksgiving Thursday and Friday: end on Wednesday.
    expect(lookAheadWindow('2026-11-10', 3, withHolidays)).toEqual({ start: '2026-11-09', end: '2026-11-25' });
    // New Year's Day Friday ends a 1-week look-ahead on Thursday.
    expect(lookAheadWindow('2026-12-28', 1, withHolidays)).toEqual({ start: '2026-12-28', end: '2026-12-31' });
    // Holidays inside the window leave it alone.
    expect(lookAheadWindow('2026-12-21', 3, withHolidays)).toEqual({ start: '2026-12-21', end: '2027-01-08' });
  });

  it('keeps plain Monday/Friday when an edge week has no working days', () => {
    const shutdown = new WorkCalendar('2026-01-01', {
      workWeekdays: [1, 2, 3, 4, 5],
      holidays: ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01'],
    });
    expect(lookAheadWindow('2026-12-29', 1, shutdown)).toEqual({ start: '2026-12-28', end: '2027-01-01' });
  });

  it('rejects a non-positive or fractional week count', () => {
    expect(() => lookAheadWindow('2026-11-02', 0, plain)).toThrow();
    expect(() => lookAheadWindow('2026-11-02', 1.5, plain)).toThrow();
  });
});

describe('lookAheadTitle', () => {
  it('writes the year once within a year', () => {
    expect(lookAheadTitle({ start: '2026-11-02', end: '2026-11-20' }, 3)).toBe('3-Week Look-Ahead: Nov 2 – Nov 20, 2026');
    expect(lookAheadTitle({ start: '2026-11-30', end: '2026-12-18' }, 3)).toBe('3-Week Look-Ahead: Nov 30 – Dec 18, 2026');
  });

  it('writes both years across a year boundary', () => {
    expect(lookAheadTitle({ start: '2026-12-28', end: '2027-01-15' }, 3)).toBe('3-Week Look-Ahead: Dec 28, 2026 – Jan 15, 2027');
  });

  it('builds from lookAheadWindow', () => {
    expect(lookAheadTitle(lookAheadWindow('2026-11-10', 3, withHolidays), 3)).toBe('3-Week Look-Ahead: Nov 9 – Nov 25, 2026');
    expect(lookAheadTitle(lookAheadWindow('2026-12-30', 2, plain), 2)).toBe('2-Week Look-Ahead: Dec 28, 2026 – Jan 8, 2027');
  });
});
