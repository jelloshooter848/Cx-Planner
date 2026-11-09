import { describe, expect, it } from 'vitest';
import { computeSchedule, WorkCalendar } from '@cx/core';
import { largeProject, riversideProject } from '@cx/fixtures';
import { fullScheduleTitle, layoutSchedulePrint, packWeeks, printDocumentHtml, printedTaskRange } from '../src/index.js';
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

describe('full schedule', () => {
  const full = { project: riverside, schedule: base.schedule, revision: base.revision, title: 'Full' };

  it('titles the sheet with the date range of the printed tasks', () => {
    expect(printedTaskRange(full)).toEqual({ start: '2026-11-02', end: '2026-12-07' });
    expect(fullScheduleTitle(printedTaskRange(full))).toBe('Full Commissioning Schedule: Nov 2 – Dec 7, 2026');
    // Only the chosen assets count.
    expect(printedTaskRange({ ...full, assetIds: ['gen-1'] })).toEqual({ start: '2026-11-19', end: '2026-12-04' });
    expect(fullScheduleTitle({ start: '2026-11-02', end: '2027-03-21' })).toBe('Full Commissioning Schedule: Nov 2, 2026 – Mar 21, 2027');
    expect(printedTaskRange({ ...full, assetIds: [] })).toBeNull();
    expect(fullScheduleTitle(null)).toBe('Full Commissioning Schedule');
  });

  it('prints a Dur column on ANSI D, with milestones at 0 d', () => {
    const svg = layoutSchedulePrint({ ...full, paper: 'ansi-d' }).sheets[0]!.svg;
    expect(svg).toContain('>Dur<');
    expect(svg).toContain('>4 d<');
    const milestone = riverside.tasks.find((t) => t.durationDays === 0)!;
    expect(milestone).toBeDefined();
    // Cells in one row share a baseline: find the milestone's code, then its Dur cell on that line.
    const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const y = new RegExp(`<text[^>]* y="([\\d.]+)"[^>]*>${esc(milestone.code)}</text>`).exec(svg)?.[1];
    expect(y).toBeDefined();
    expect(svg).toMatch(new RegExp(`<text[^>]* y="${esc(y!)}"[^>]*>0 d</text>`));
  });

  it('fits the whole job on the width of one ANSI D sheet by default', () => {
    const l = layoutSchedulePrint({ ...full, paper: 'ansi-d' });
    expect(l.timeBands).toBe(1);
    // The timeline runs to the right margin (34 in − 0.45 in at 96 px/in), not part way across.
    const frame = /<rect x="43.2" y="[\d.]+" width="([\d.]+)" height="[\d.]+" fill="none" stroke="#111" stroke-width="1"\/>/.exec(l.sheets[0]!.svg);
    expect(Number(frame?.[1])).toBeCloseTo(3177.6, 1);
  });

  it('leaves Dur off look-aheads unless asked for', () => {
    expect(layoutSchedulePrint({ ...base, paper: 'tabloid' }).sheets[0]!.svg).not.toContain('>Dur<');
    expect(layoutSchedulePrint({ ...base, paper: 'tabloid', showDuration: true }).sheets[0]!.svg).toContain('>Dur<');
  });

  it('drops Dur first, then Responsible, when the sheet is narrow', () => {
    // Tabloid: fitting 26 working days leaves about 0.27 in a day with every column.
    const roomy = layoutSchedulePrint({ ...full, paper: 'tabloid' }).sheets[0]!.svg;
    expect(roomy).toContain('>Dur<');
    // No dialog setting passes minDayWidthIn yet; 0.28 in stands in for a job a few days longer than
    // riverside, just past what fits with every column. Dur goes, which is enough, so Responsible stays.
    const narrow = layoutSchedulePrint({ ...full, paper: 'tabloid', minDayWidthIn: 0.28 }).sheets[0]!.svg;
    expect(narrow).not.toContain('>Dur<');
    expect(narrow).toContain('>Responsible<');
    // A long job on Tabloid switches to the week scale instead, which keeps every column while the
    // timeline is at least 5 in wide.
    const large = largeProject();
    const long = layoutSchedulePrint({ ...full, project: large, schedule: computeSchedule(large), paper: 'tabloid' });
    expect(long.scale).toBe('week');
    expect(long.sheets[0]!.svg).toContain('>Dur<');
    expect(long.sheets[0]!.svg).toContain('>Responsible<');
    // A fixed day width keeps Dur while the timeline is at least 5 in wide.
    expect(layoutSchedulePrint({ ...full, paper: 'tabloid', dayWidthIn: 0.42 }).sheets[0]!.svg).toContain('>Dur<');
  });
});

describe('full schedule timescale', () => {
  const large = largeProject(120);
  const schedule = computeSchedule(large);
  const opts = { project: large, schedule, paper: 'ansi-d' as const, title: 'Full', revision: { rev: 'A', issued: '2026-11-02' } };
  const summaryBars = (svg: string) =>
    [...svg.matchAll(/<rect class="asset-summary" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/g)].map((m) => ({
      x: Number(m[1]), y: Number(m[2]), right: Number(m[1]) + Number(m[3]),
    }));

  it('fits a long job on one ANSI D time band with week columns under month headings', () => {
    const l = layoutSchedulePrint(opts);
    expect(l.scale).toBe('week');
    expect(l.timeBands).toBe(1);
    expect(l.sheets).toHaveLength(l.rowBands);
    const svg = l.sheets[0]!.svg;
    expect(svg).toContain('>Dur<');
    expect(svg).toContain('>Responsible<');
    expect(svg).toContain('>November 2026<');
    expect(svg).toContain('>August 2027<');
    // Week columns are headed by their Monday; no per-day headings or "Week of" labels.
    for (const d of ['Nov 2', 'Nov 9', 'Nov 30', 'Aug 9']) expect(svg).toContain(`>${d}<`);
    expect(svg).not.toContain('Week of');
    expect(svg).not.toMatch(/>[MTWF] \d+</);
  });

  it('draws a summary bar on every asset group row from first start to last finish', () => {
    const l = layoutSchedulePrint(opts);
    // The table/timeline divider is the last heavy line before the marker labels and footer.
    const body0 = l.sheets[0]!.svg.slice(0, l.sheets[0]!.svg.indexOf('<g class="sheet-footer">'));
    const tlX = Number([...body0.matchAll(/<line x1="([\d.]+)" y1="[\d.]+" x2="[\d.]+" y2="[\d.]+" stroke="#111" stroke-width="1"\/>/g)].at(-1)![1]);
    const first = Math.min(...large.tasks.map((t) => schedule.tasks.get(t.id)!.es));
    const last = Math.max(...large.tasks.map((t) => schedule.tasks.get(t.id)!.ef)) + 1;
    const dayW = (34 * 96 - 43.2 - tlX) / (last - first + 1);
    let groups = 0;
    for (const sheet of l.sheets) {
      const bars = summaryBars(sheet.svg);
      // One bar per group row (including continued groups) on the sheet.
      const tags = [...sheet.svg.matchAll(/font-size="13" font-weight="700" fill="#111">([^<]+)<tspan/g)].map((m) => m[1]!.replace(' (cont.)', ''));
      expect(bars).toHaveLength(tags.length);
      tags.forEach((tag, i) => {
        const asset = large.assets.find((a) => a.tag === tag)!;
        const own = large.tasks.filter((t) => t.assetId === asset.id).map((t) => schedule.tasks.get(t.id)!);
        const es = Math.min(...own.map((s) => s.es));
        const ef = Math.max(...own.map((s) => s.ef));
        expect(bars[i]!.x).toBeCloseTo(tlX + (es - first) * dayW, 0);
        expect(bars[i]!.right).toBeCloseTo(tlX + (ef - first) * dayW, 0);
      });
      groups += tags.length;
    }
    expect(groups).toBeGreaterThanOrEqual(120);
  });

  it('keeps short jobs on the day scale', () => {
    const l = layoutSchedulePrint({ ...opts, project: riverside, schedule: computeSchedule(riverside) });
    expect(l.scale).toBe('day');
    expect(l.sheets).toHaveLength(1);
    expect(l.sheets[0]!.svg).toContain('Week of Nov 2');
    expect(summaryBars(l.sheets[0]!.svg).length).toBe(riverside.assets.length);
  });

  it('keeps look-aheads on the day scale without summary bars', () => {
    const l = layoutSchedulePrint({ ...opts, paper: 'tabloid', window: { start: '2026-11-02', end: '2026-11-20' }, scale: 'week' });
    expect(l.scale).toBe('day');
    expect(l.sheets[0]!.svg).not.toContain('asset-summary');
  });

  it('uses the day scale for fixed day widths and the week scale on request', () => {
    expect(layoutSchedulePrint({ ...opts, dayWidthIn: 0.42 }).scale).toBe('day');
    const week = layoutSchedulePrint({ ...opts, project: riverside, schedule: computeSchedule(riverside), scale: 'week' });
    expect(week.scale).toBe('week');
    expect(week.sheets[0]!.svg).toContain('>November 2026<');
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
