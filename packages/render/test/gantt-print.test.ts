import { describe, expect, it } from 'vitest';
import { computeSchedule, WorkCalendar } from '@cx/core';
import { largeProject, riversideProject } from '@cx/fixtures';
import { layoutSchedulePrint, packWeeks, printDocumentHtml } from '../src/index.js';
import { textWidth } from '../src/text.js';

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

describe('marker labels', () => {
  const labelsOf = (svg: string) => [...svg.matchAll(/<g class="marker-label">(<text [^>]*>([^<]*)<\/text>)<\/g>/g)];

  it('draws every marker label after all grid, bar and data date lines', () => {
    const large = largeProject();
    const layouts = [
      layoutSchedulePrint({ ...base, paper: 'tabloid' }),
      layoutSchedulePrint({ ...base, paper: 'letter' }),
      layoutSchedulePrint({
        project: large, schedule: computeSchedule(large), paper: 'ansi-d', title: 'Full schedule',
        dayWidthIn: 0.42, revision: { rev: 'A', issued: '2026-11-02' },
      }),
    ];
    let seen = 0;
    for (const sheet of layouts.flatMap((l) => l.sheets)) {
      const labels = labelsOf(sheet.svg);
      if (labels.length === 0) continue;
      seen += labels.length;
      // Legend and sign-off lines live in the footer group after the labels; the body's lines all come before.
      const footerAt = sheet.svg.indexOf('<g class="sheet-footer">');
      expect(footerAt).toBeGreaterThan(0);
      const bodyLines = [...sheet.svg.slice(0, footerAt).matchAll(/<line /g)].map((m) => m.index);
      const firstLabel = labels[0]!.index;
      expect(Math.max(...bodyLines)).toBeLessThan(firstLabel);
      for (const l of labels) {
        expect(l[1]).toContain('stroke="#fff"');
        expect(l[1]).toContain('paint-order="stroke"');
      }
    }
    expect(seen).toBeGreaterThan(0);
    const tabloid = labelsOf(layouts[0]!.sheets[0]!.svg).map((m) => m[2]);
    expect(tabloid).toEqual(expect.arrayContaining(['HOLD', 'Energization']));
  });

  it('keeps at least 4 px between a diamond and a label pushed to its left', () => {
    // End the window on the energization day so its label cannot fit right of the diamond.
    const svg = layoutSchedulePrint({ ...base, paper: 'tabloid', window: { start: '2026-11-02', end: '2026-11-18' } }).sheets[0]!.svg;
    const left = labelsOf(svg).filter((m) => m[1]!.includes('text-anchor="end"'));
    expect(left.map((m) => m[2])).toContain('Energization');
    const diamonds = [...svg.matchAll(/<path d="M([\d.]+) ([\d.]+) L([\d.]+) [\d.]+ L[\d.]+ [\d.]+ L([\d.]+) /g)].map((m) => ({
      left: Number(m[4]), mid: Number(m[2]) + (Number(m[1]) - Number(m[4])),
    }));
    for (const m of left) {
      const x = Number(/ x="([\d.]+)"/.exec(m[1]!)![1]);
      const baseline = Number(/ y="([\d.]+)"/.exec(m[1]!)![1]);
      const halo = Number(/stroke-width="([\d.]+)"/.exec(m[1]!)![1]);
      // The label's own diamond: same row, nearest to the right of the label's end.
      const own = diamonds.filter((d) => Math.abs(d.mid - (baseline - 4.5)) < 1 && d.left > x).sort((a, b) => a.left - b.left)[0]!;
      expect(own.left - (x + halo / 2)).toBeGreaterThanOrEqual(4);
    }
  });

  it('keeps labels inside the timeline, clear of the table divider, on windows that start on a marker', () => {
    // One- and two-day windows leave too little room on either side of a diamond, so labels are shortened.
    const cal = new WorkCalendar('2026-11-02');
    const anchors = new Set<string>();
    let shortened = 0;
    for (let i = 0; i < 25; i++) {
      for (const span of [0, 1]) {
        const sheet = layoutSchedulePrint({
          ...base, paper: 'tabloid', window: { start: cal.dateAt(i), end: cal.dateAt(i + span) }, dayWidthIn: 0.6,
        }).sheets[0];
        if (!sheet) continue;
        const svg = sheet.svg;
        // The Gantt frame and its table/timeline divider come just before the marker labels.
        const body = svg.slice(0, svg.indexOf('<g class="sheet-footer">'));
        const frame = [...body.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="[\d.]+" fill="none" stroke="#111"/g)].at(-1)!;
        const right = Number(frame[1]) + Number(frame[2]);
        const tlX = Number([...body.matchAll(/<line x1="([\d.]+)" y1="[\d.]+" x2="[\d.]+" y2="[\d.]+" stroke="#111" stroke-width="1"\/>/g)].at(-1)![1]);
        for (const m of labelsOf(svg)) {
          const x = Number(/ x="([\d.]+)"/.exec(m[1]!)![1]);
          const halo = Number(/stroke-width="([\d.]+)"/.exec(m[1]!)![1]);
          const end = m[1]!.includes('text-anchor="end"');
          const start = end ? x - textWidth(m[2]!, 11, true) : x;
          expect(start - halo / 2).toBeGreaterThanOrEqual(tlX);
          expect(start + textWidth(m[2]!, 11, true)).toBeLessThanOrEqual(right + 0.01);
          anchors.add(end ? 'end' : 'start');
          if (m[2]!.endsWith('…')) shortened++;
        }
      }
    }
    expect(shortened).toBeGreaterThan(0);
    expect([...anchors].sort()).toEqual(['end', 'start']);
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
