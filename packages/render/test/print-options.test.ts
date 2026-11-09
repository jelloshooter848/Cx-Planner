import { describe, expect, it } from 'vitest';
import { computeSchedule } from '@cx/core';
import { riversideProject } from '@cx/fixtures';
import { layoutSchedulePrint, newestRevisions, type SchedulePrintOptions } from '../src/index.js';

const riverside = riversideProject();
const schedule = computeSchedule(riverside);
const base: SchedulePrintOptions = {
  project: riverside,
  schedule,
  paper: 'tabloid',
  title: '3-Week Look-Ahead',
  window: { start: '2026-11-02', end: '2026-11-20' },
  revision: { rev: 'B', issued: '2026-11-06', baseline: 'Rev A' },
};
const svgOf = (o: Partial<SchedulePrintOptions> = {}) => layoutSchedulePrint({ ...base, ...o }).sheets.map((s) => s.svg).join('');
const countOf = (s: string, needle: string) => s.split(needle).length - 1;
const HEAVY = 'stroke-width="2.6"';

describe('assetIds', () => {
  it('prints every asset group by default', () => {
    const svg = svgOf();
    for (const tag of ['SWGR-1A', 'XFMR-1A', 'UPS-1A', 'GEN-1']) expect(svg).toContain(`>${tag}<`);
  });

  it('prints only the chosen asset groups', () => {
    const l = layoutSchedulePrint({ ...base, assetIds: ['xfmr-1a', 'gen-1'] });
    const svg = l.sheets.map((s) => s.svg).join('');
    expect(svg).toContain('>XFMR-1A<');
    expect(svg).toContain('>GEN-1<');
    expect(svg).not.toContain('>SWGR-1A<');
    expect(svg).not.toContain('>UPS-1A<');
    expect(svg).not.toContain('>1.1<');
    expect(svg).toContain('>2.1<');
    expect(l.taskCount).toBe(layoutSchedulePrint(base).taskCount - 6 - 1); // all of SWGR-1A (6) and UPS-1A 3.1 (1) dropped
  });

  it('prints an empty grid when no asset matches', () => {
    const l = layoutSchedulePrint({ ...base, assetIds: [] });
    expect(l.taskCount).toBe(0);
    expect(l.sheets).toHaveLength(1);
    const full = layoutSchedulePrint({ ...base, window: undefined, assetIds: [] });
    expect(full.sheets).toHaveLength(1);
  });
});

describe('showCriticalPath', () => {
  it('draws heavy outlines and the legend item by default', () => {
    const svg = svgOf();
    expect(svg).toContain(HEAVY);
    expect(svg).toContain('Critical path (heavy outline)');
  });

  it('drops heavy outlines and the legend item when off', () => {
    const svg = svgOf({ showCriticalPath: false });
    expect(svg).not.toContain(HEAVY);
    expect(svg).not.toContain('Critical path');
    expect(svg).toContain('Not started'); // the rest of the legend stays
  });
});

describe('showTimes', () => {
  it('shows the T I M E S columns and legend line by default', () => {
    const svg = svgOf();
    const sheets = layoutSchedulePrint(base).sheets.length;
    for (const k of ['T', 'I', 'M', 'E', 'S']) expect(countOf(svg, `>${k}</text>`)).toBe(sheets);
    expect(svg).toContain('T Tools · I Information');
    expect(svg).toContain('Blocked or late');
  });

  it('hides the columns and legend line when off', () => {
    const svg = svgOf({ showTimes: false });
    // A lone T/I/M/E/S text node only ever comes from the column headers, so any markup works.
    for (const k of ['T', 'I', 'M', 'E', 'S']) expect(countOf(svg, `>${k}</text>`)).toBe(0);
    expect(svg).not.toContain('T Tools');
    expect(svg).not.toContain('Blocked or late');
    expect(svg).not.toContain('Ready / on site');
    expect(svg).toContain('>Responsible<');
  });
});

describe('title block', () => {
  it('shows a Baseline box only when a baseline is given', () => {
    expect(svgOf()).toContain('>Baseline<');
    expect(svgOf({ revision: { rev: 'A', issued: '2026-11-02' } })).not.toContain('>Baseline<');
  });
});

describe('revision history', () => {
  const revisions = [
    { rev: 'A', date: '2026-10-05', note: 'Issued for coordination' },
    { rev: 'B', date: '2026-10-12', note: 'Progress update' },
    { rev: 'D', date: '2026-10-26', note: 'Crew change' },
    { rev: 'C', date: '2026-10-19', note: 'Holiday added' },
    { rev: 'E', date: '2026-11-02', note: 'Weekly update' },
  ];

  it('picks the newest three, oldest first', () => {
    expect(newestRevisions(revisions, 3).map((r) => r.rev)).toEqual(['C', 'D', 'E']);
    expect(newestRevisions(revisions.slice(0, 2), 3).map((r) => r.rev)).toEqual(['A', 'B']);
  });

  it('keeps list order for revisions on the same date', () => {
    const same = [
      { rev: 'A', date: '2026-11-02', note: '' },
      { rev: 'B', date: '2026-11-02', note: '' },
      { rev: 'C', date: '2026-11-02', note: '' },
      { rev: 'D', date: '2026-11-02', note: '' },
    ];
    expect(newestRevisions(same, 3).map((r) => r.rev)).toEqual(['B', 'C', 'D']);
  });

  it('prints only the newest three in the footer', () => {
    const svg = svgOf({ revisions });
    expect(svg).toContain('Holiday added');
    expect(svg).toContain('Crew change');
    expect(svg).toContain('Weekly update');
    expect(svg).not.toContain('Issued for coordination');
    expect(svg).not.toContain('Progress update');
    expect(svg.indexOf('Holiday added')).toBeLessThan(svg.indexOf('Weekly update'));
  });
});
