import { describe, expect, it } from 'vitest';
import { computeSchedule, WorkCalendar } from '@cx/core';
import { largeProject, riversideProject } from '@cx/fixtures';
import { layoutSchedulePrint, packWeeks, printDocumentHtml } from '../src/index.js';

const riverside = riversideProject();
const base = {
  project: riverside,
  schedule: computeSchedule(riverside),
  title: '3-Week Look-Ahead',
  window: { start: '2026-11-02', end: '2026-11-20' },
  revision: { rev: 'B', issued: '2026-11-06', baseline: 'Rev A' },
};

describe('layoutSchedulePrint', () => {
  it('fits the 3-week look-ahead on one Tabloid sheet', () => {
    const l = layoutSchedulePrint({ ...base, paper: 'tabloid' });
    expect(l.sheets).toHaveLength(1);
    expect(l.taskCount).toBe(13); // tasks in or touching Nov 2 – Nov 20
    const svg = l.sheets[0]!.svg;
    expect(svg).toContain('width="17in" height="11in"');
    expect(svg).toContain('1 of 1');
    // 15 working days of day headings.
    expect(svg).toContain('>M 2<');
    expect(svg).toContain('>F 20<');
    expect(svg).not.toContain('>M 23<');
  });

  it('leaves out tasks outside the window', () => {
    const l = layoutSchedulePrint({ ...base, paper: 'tabloid' });
    expect(l.sheets[0]!.svg).not.toContain('Battery string verification');
  });

  it('repeats title, revision block and column headers on every sheet', () => {
    const large = largeProject();
    const l = layoutSchedulePrint({
      project: large, schedule: computeSchedule(large), paper: 'ansi-d', title: 'Full schedule',
      dayWidthIn: 0.42, revision: { rev: 'A', issued: '2026-11-02' },
    });
    expect(l.rowBands).toBeGreaterThan(1);
    expect(l.timeBands).toBeGreaterThan(1);
    expect(l.sheets).toHaveLength(l.rowBands * l.timeBands);
    for (const sheet of l.sheets) {
      expect(sheet.svg).toContain('Full schedule');
      expect(sheet.svg).toContain('>Revision<');
      expect(sheet.svg).toContain('>Task<');
      expect(sheet.svg).toContain(`${sheet.number} of ${l.sheets.length}`);
    }
    // Every task appears in exactly one row band (counted on time band 1).
    const firstBand = l.sheets.filter((s) => s.timeBand === 1).map((s) => s.svg).join('');
    for (const t of large.tasks.slice(0, 20)) expect(firstBand).toContain(`>${t.code}<`);
  });

  it('never ends a sheet on a bare asset header and marks continued groups', () => {
    const large = largeProject();
    const l = layoutSchedulePrint({
      project: large, schedule: computeSchedule(large), paper: 'letter', title: 'x',
      revision: { rev: 'A', issued: '2026-11-02' },
    });
    expect(l.sheets.length).toBeGreaterThan(5);
    expect(l.sheets.some((s) => s.svg.includes('(cont.)'))).toBe(true);
  });

  it('drops the Responsible column on Letter to keep the timeline usable', () => {
    const letter = layoutSchedulePrint({ ...base, paper: 'letter' });
    const tabloid = layoutSchedulePrint({ ...base, paper: 'tabloid' });
    expect(letter.sheets[0]!.svg).not.toContain('>Responsible<');
    expect(tabloid.sheets[0]!.svg).toContain('>Responsible<');
  });

  it('wraps sheets in a document with the CSS page size', () => {
    const html = printDocumentHtml(layoutSchedulePrint({ ...base, paper: 'ansi-d' }), { title: 't' });
    expect(html).toContain('@page { size: 34in 22in; margin: 0; }');
  });
});

describe('packWeeks', () => {
  const cal = new WorkCalendar('2026-11-02');
  const at = (i: number) => cal.dateAt(i);
  it('breaks bands on week boundaries', () => {
    expect(packWeeks(0, 29, 12, at)).toEqual([[0, 9], [10, 19], [20, 29]]);
  });
  it('splits a week when the sheet is narrower than a week', () => {
    expect(packWeeks(0, 9, 3, at)).toEqual([[0, 2], [3, 4], [5, 7], [8, 9]]);
  });
});
