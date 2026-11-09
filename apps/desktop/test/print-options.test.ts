import { describe, expect, it } from 'vitest';
import { defaultSettings, fitScale, lookAheadStarts, mondayOf, printRequest } from '../src/renderer/dialogs/Print/print-options.js';

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
    expect(printRequest('full-schedule', s, null)).toEqual({ kind: 'full-schedule', paper: 'ansi-d', dayWidthIn: 0.42, assetIds: null, note: 'Progress update' });
    expect(printRequest('test-sheets', s, null)).toEqual({ kind: 'test-sheets', taskIds: ['t1', 't2'], note: 'Progress update' });
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
