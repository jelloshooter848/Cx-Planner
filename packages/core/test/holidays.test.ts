import { describe, expect, it } from 'vitest';
import { federalHolidayName, mergeHolidays, nthWeekday, observedDate, usFederalHolidays } from '../src/index.js';

const dates = (year: number) => usFederalHolidays(year).map((h) => h.date);

describe('usFederalHolidays', () => {
  it('lists 2026 with Independence Day observed on Friday Jul 3', () => {
    expect(dates(2026)).toEqual([
      '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03',
      '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25',
    ]);
    expect(usFederalHolidays(2026).find((h) => h.date === '2026-07-03')).toEqual({ date: '2026-07-03', name: 'Independence Day', actual: '2026-07-04' });
    expect(usFederalHolidays(2026).find((h) => h.date === '2026-12-25')).toEqual({ date: '2026-12-25', name: 'Christmas Day' });
  });

  it('moves Saturday holidays to Friday and Sunday holidays to Monday (2027)', () => {
    expect(dates(2027)).toEqual([
      '2027-01-01', '2027-01-18', '2027-02-15', '2027-05-31', '2027-06-18', '2027-07-05',
      '2027-09-06', '2027-10-11', '2027-11-11', '2027-11-25', '2027-12-24',
      // New Year's Day 2028 is a Saturday, observed Friday Dec 31, 2027.
      '2027-12-31',
    ]);
    expect(usFederalHolidays(2027).at(-1)).toEqual({ date: '2027-12-31', name: "New Year's Day", actual: '2028-01-01' });
  });

  it('leaves out a New Year observed in the year before (2028, 2022)', () => {
    expect(dates(2028)).toEqual([
      '2028-01-17', '2028-02-21', '2028-05-29', '2028-06-19', '2028-07-04',
      '2028-09-04', '2028-10-09', '2028-11-10', '2028-11-23', '2028-12-25',
    ]);
    expect(dates(2022)[0]).toBe('2022-01-17');
    expect(dates(2021)).toContain('2021-12-31');
    expect(dates(2021)).toContain('2021-06-18');
  });

  it('observes a Sunday New Year on Monday Jan 2 (2023)', () => {
    expect(dates(2023)).toEqual([
      '2023-01-02', '2023-01-16', '2023-02-20', '2023-05-29', '2023-06-19', '2023-07-04',
      '2023-09-04', '2023-10-09', '2023-11-10', '2023-11-23', '2023-12-25',
    ]);
  });

  it('adds Juneteenth from 2021 only', () => {
    expect(usFederalHolidays(2020).some((h) => h.name.startsWith('Juneteenth'))).toBe(false);
    expect(dates(2020)).toHaveLength(10);
  });

  it('never returns a weekend day', () => {
    for (let y = 2020; y <= 2040; y++) {
      for (const d of dates(y)) expect([0, 6]).not.toContain(new Date(`${d}T00:00:00Z`).getUTCDay());
    }
  });

  it('refuses years it does not cover', () => {
    expect(() => usFederalHolidays(1970)).toThrow(RangeError);
    expect(() => usFederalHolidays(2026.5)).toThrow(RangeError);
  });
});

describe('holiday helpers', () => {
  it('finds nth and last weekdays', () => {
    expect(nthWeekday(2026, 11, 4, 4)).toBe('2026-11-26');
    expect(nthWeekday(2026, 5, 1, -1)).toBe('2026-05-25');
    expect(nthWeekday(2026, 12, 4, -1)).toBe('2026-12-31');
    expect(nthWeekday(2026, 9, 2, 1)).toBe('2026-09-01');
  });

  it('computes observed dates', () => {
    expect(observedDate('2026-07-04')).toBe('2026-07-03');
    expect(observedDate('2027-07-04')).toBe('2027-07-05');
    expect(observedDate('2026-07-06')).toBe('2026-07-06');
  });

  it('names federal holidays by date', () => {
    expect(federalHolidayName('2026-11-26')).toBe('Thanksgiving Day');
    expect(federalHolidayName('2027-12-31')).toBe("New Year's Day");
    expect(federalHolidayName('2026-11-27')).toBeNull();
    expect(federalHolidayName('nonsense')).toBeNull();
  });

  it('merges without duplicates, in order', () => {
    expect(mergeHolidays(['2026-12-25', '2026-11-27'], ['2026-11-26', '2026-12-25'])).toEqual(['2026-11-26', '2026-11-27', '2026-12-25']);
  });
});
