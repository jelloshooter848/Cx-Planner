import { describe, expect, it } from 'vitest';
import type { ChecklistItem } from '@cx/core';
import { riversideProject } from '@cx/fixtures';
import {
  layoutTestSheet, orientationOf, PAPER, portrait, printDocumentHtml, textWidth, wrapText, type TestSheetItem, type TestSheetOptions,
} from '../src/index.js';

const riverside = riversideProject();
const asset = riverside.assets.find((a) => a.id === 'swgr-1a')!;
const relayTask = riverside.tasks.find((t) => t.id === 't1.4')!;
const holdTask = riverside.tasks.find((t) => t.id === 't1.5')!;

const items = (n: number, text = (i: number) => `Check item number ${i} verified and recorded`): TestSheetItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, text: text(i + 1) }));

const base: TestSheetOptions = {
  project: riverside,
  asset,
  task: relayTask,
  checklist: items(5),
  revision: { rev: 'A', issued: '2026-11-06' },
  sheetId: 'LVSG-04',
  sheetName: 'Protective relay test',
  scheduled: { start: '2026-11-10', finish: '2026-11-13' },
};
const sheet = (o: Partial<TestSheetOptions> = {}) => layoutTestSheet({ ...base, ...o });
const allSvg = (o: Partial<TestSheetOptions> = {}) => sheet(o).sheets.map((s) => s.svg).join('');
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe('paper orientation', () => {
  it('keeps the PAPER sizes landscape and stands Letter upright on request', () => {
    expect(PAPER.letter).toMatchObject({ widthIn: 11, heightIn: 8.5 });
    expect(orientationOf(PAPER.letter)).toBe('landscape');
    const p = portrait(PAPER.letter);
    expect(p).toMatchObject({ id: 'letter', widthIn: 8.5, heightIn: 11 });
    expect(orientationOf(p)).toBe('portrait');
    expect(portrait(p)).toBe(p);
  });
});

describe('layoutTestSheet', () => {
  it('lays out on Letter portrait, 8.5 × 11 in', () => {
    const l = sheet();
    expect(l.paper).toMatchObject({ id: 'letter', widthIn: 8.5, heightIn: 11 });
    expect(l.sheets).toHaveLength(1);
    expect(l.sheets[0]!.svg).toContain('width="8.5in" height="11in"');
    expect(l.sheets[0]!.svg).toContain('viewBox="0 0 816 1056"');
    const html = printDocumentHtml(l, { title: 'Test sheet' });
    expect(html).toContain('@page { size: 8.5in 11in; margin: 0; }');
    expect(html).toContain('.sheet { width: 8.5in; height: 11in;');
  });

  it('prints the header and asset / task info block', () => {
    const svg = allSvg();
    for (const s of [
      '>TEST SHEET · TASK 1.4 · PROTECTIVE RELAY TEST<', '>Relay settings &amp; calibration<', '>SWGR-1A<',
      '>Low-voltage switchgear<', '>Riverside Data Center – Bldg A<', '>Sheet LVSG-04 · Rev A<', '>Elec Rm 101<',
      '>Nov 10 – Nov 13<', '>Relay technician<', '>Test date<',
    ]) expect(svg).toContain(s);
  });

  it('has test instrument, serial and calibration fields unless turned off', () => {
    for (const s of ['>Test instrument<', '>Serial no.<', '>Cal. due<']) {
      expect(allSvg()).toContain(s);
      expect(allSvg({ instrumentFields: false })).not.toContain(s);
    }
  });

  it('prints every item with a number, Pass / Fail / N/A boxes and the sign-off block', () => {
    const l = sheet();
    const svg = l.sheets[0]!.svg;
    expect(l.itemCount).toBe(5);
    for (let i = 1; i <= 5; i++) {
      expect(svg).toContain(`data-item="c${i}"`);
      expect(svg).toContain(`Check item number ${i} verified and recorded`);
    }
    expect(count(svg, '>N/A<')).toBe(5);
    for (const s of ['>#<', '>Check<', '>Result<', '>Notes<', '>Init.<', '>COMMENTS<', 'Performed by', 'Witnessed by', 'QC reviewed by', '>Page 1 of 1<']) {
      expect(svg).toContain(s);
    }
  });

  it('wraps long item text onto several lines inside the Check column', () => {
    const long = 'Feeder breaker opens, closes and trips from the local control switch and from the remote SCADA point with correct status indication';
    const svg = allSvg({ checklist: [{ id: 'x', text: long }] });
    const row = svg.slice(svg.indexOf('data-item="x"'));
    const spans = [...row.slice(0, row.indexOf('</g>')).matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]!);
    expect(spans.length).toBeGreaterThan(1);
    expect(spans.join(' ')).toBe(long);
  });

  it('adds an Acceptance column only when some item has acceptance criteria', () => {
    expect(allSvg()).not.toContain('>Acceptance<');
    const svg = allSvg({ checklist: [{ id: 'a', text: 'Insulation resistance', acceptance: '≥ 100 MΩ' }] });
    expect(svg).toContain('>Acceptance<');
    expect(svg).toContain('≥ 100 MΩ');
  });

  it('prints a template checklist item\'s acceptance in that item\'s row', () => {
    const checklist: ChecklistItem[] = [
      { id: 'lugs', text: 'Cable lugs torqued to manufacturer values', acceptance: 'Per mfr. torque table' },
      { id: 'marks', text: 'Torque marks applied' },
    ];
    const svg = allSvg({ checklist });
    expect(svg).toContain('>Acceptance<');
    const row = (id: string) => {
      const from = svg.slice(svg.indexOf(`data-item="${id}"`));
      return from.slice(0, from.indexOf('</g>'));
    };
    expect(row('lugs')).toContain('Per mfr. torque table');
    expect(row('marks')).not.toContain('Per mfr.');
  });

  it('fits the twelve-item mockup checklist with a hold point on one page', () => {
    const l = sheet({ task: holdTask, checklist: items(12, (i) => `Pre-energization check ${i}`) });
    expect(l.sheets).toHaveLength(1);
  });

  it('paginates long checklists with repeated headers and every item exactly once, in order', () => {
    const checklist = items(60);
    const l = sheet({ checklist });
    expect(l.sheets.length).toBeGreaterThan(1);
    expect(l.sheets.flatMap((s) => s.itemIds)).toEqual(checklist.map((c) => c.id));
    const n = l.sheets.length;
    l.sheets.forEach((s, i) => {
      expect(s.number).toBe(i + 1);
      expect(s.itemIds.length).toBeGreaterThan(0);
      expect(s.svg).toContain('>Check<');
      expect(s.svg).toContain('>SWGR-1A<');
      expect(s.svg).toContain(`>Page ${i + 1} of ${n}<`);
      expect(s.svg.includes('(CONTINUED)')).toBe(i > 0);
      expect(s.svg.includes('>Location<')).toBe(i === 0);
      expect(s.svg.includes('Performed by')).toBe(i === n - 1);
      expect(s.svg.includes('>COMMENTS<')).toBe(i === n - 1);
    });
    // Item numbers keep counting across pages.
    const second = l.sheets[1]!;
    const firstOnSecond = Number(second.itemIds[0]!.slice(1));
    expect(second.svg).toContain(`>${firstOnSecond}<`);
  });

  it('never leaves the sign-off page without checklist rows', () => {
    for (let n = 1; n <= 60; n++) {
      const l = sheet({ task: holdTask, checklist: items(n) });
      expect(l.sheets.at(-1)!.itemIds.length).toBeGreaterThan(0);
      expect(l.sheets.flatMap((s) => s.itemIds)).toHaveLength(n);
    }
  });

  // Lowest baseline / line y of anything drawn above the footer, and the sign-off line y.
  const geometry = (svg: string) => {
    const footerY = 1056 - 48 - 6;
    const ys: number[] = [];
    for (const m of svg.matchAll(/<text x="[^"]*" y="([\d.]+)"[^>]*>(.*?)<\/text>/g)) {
      const base = Number(m[1]);
      const extra = (m[2]!.match(/dy="/g) ?? []).length * 15;
      ys.push(base + extra);
    }
    for (const m of svg.matchAll(/<line [^>]*y1="([\d.]+)" [^>]*y2="([\d.]+)"/g)) ys.push(Number(m[1]), Number(m[2]));
    const above = ys.filter((y) => Math.abs(y - footerY) > 0.01);
    return { maxY: Math.max(...above), footerY };
  };

  it('keeps everything inside the page with a very tall item and many comment lines', () => {
    const huge = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ');
    for (const task of [relayTask, holdTask]) {
      for (const checklist of [[{ id: 'big', text: huge }], [...items(8), { id: 'big', text: huge }, ...items(3).map((c) => ({ ...c, id: `z${c.id}` }))]]) {
        const l = sheet({ task, checklist, commentLines: 30 });
        expect(l.sheets.flatMap((s) => s.itemIds)).toEqual(checklist.map((c) => c.id));
        for (const s of l.sheets) {
          expect(s.itemIds.length).toBeGreaterThan(0);
          const { maxY, footerY } = geometry(s.svg);
          expect(maxY).toBeLessThanOrEqual(1056 - 48);
          expect(maxY).toBeLessThan(footerY - 10);
        }
        // Comment lines stay above the sign-off line.
        const last = l.sheets.at(-1)!.svg;
        const signY = Number(/<line [^>]*y1="([\d.]+)"[^>]*\/><text [^>]*>Performed by/.exec(last)![1]);
        const commentsAt = last.indexOf('>COMMENTS<');
        const commentYs = [...last.slice(commentsAt, last.indexOf('Performed by')).matchAll(/<line [^>]*y1="([\d.]+)"/g)].map((m) => Number(m[1]));
        expect(commentYs.length).toBeGreaterThan(0);
        for (const y of commentYs.slice(0, -1)) expect(y).toBeLessThan(signY);
      }
    }
    // The over-long item is cut with an ellipsis rather than drawn off the page.
    expect(allSvg({ checklist: [{ id: 'big', text: huge }] })).toContain('…');
  });

  it('caps comment lines but honours small requests', () => {
    const lines = (o: Partial<TestSheetOptions>) => {
      const svg = sheet(o).sheets.at(-1)!.svg;
      return count(svg.slice(svg.indexOf('>COMMENTS<'), svg.indexOf('Performed by')), '<line ');
    };
    expect(lines({ commentLines: 0 })).toBe(0);
    expect(lines({ checklist: items(25), commentLines: 3 })).toBeGreaterThanOrEqual(3);
    expect(lines({ commentLines: 30 })).toBeLessThan(30);
  });

  it('shows a hold point box for holds, a witness box for witness points and none otherwise', () => {
    expect(allSvg({ task: holdTask })).toContain('>HOLD POINT<');
    expect(allSvg({ task: { ...holdTask, type: 'witness' } })).toContain('>WITNESS POINT<');
    expect(allSvg()).not.toMatch(/HOLD POINT|WITNESS POINT/);
    expect(allSvg({ task: holdTask, holdNote: 'Wait for the Owner.' })).toContain('Wait for the Owner.');
  });

  it('prints one page with a note when the task has no checklist', () => {
    const l = sheet({ checklist: [] });
    expect(l.sheets).toHaveLength(1);
    expect(l.itemCount).toBe(0);
    expect(l.sheets[0]!.svg).toContain('No checklist items');
  });

  it('prints in black, white and grey only', () => {
    const colours = new Set([...allSvg({ task: holdTask, checklist: items(40) }).matchAll(/#[0-9a-f]{3,6}\b/gi)].map((m) => m[0].toLowerCase()));
    for (const c of colours) {
      const hex = c.length === 4 ? [...c.slice(1)].map((h) => h + h).join('') : c.slice(1);
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!), c).toBeLessThan(24);
    }
  });

  it('escapes text', () => {
    const svg = allSvg({ checklist: [{ id: 'e', text: 'A <b> & "c"' }] });
    expect(svg).toContain('A &lt;b&gt; &amp; &quot;c&quot;');
  });
});

describe('wrapText', () => {
  it('breaks at spaces without exceeding the width and keeps every word', () => {
    const s = 'Bus bolted connections torque-verified and witness-marked per manufacturer table';
    const lines = wrapText(s, 150, 13);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l, 13)).toBeLessThanOrEqual(150);
    expect(lines.join(' ')).toBe(s);
  });

  it('splits a word longer than the line', () => {
    const lines = wrapText('X'.repeat(40), 60, 13);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('X'.repeat(40));
    for (const l of lines) expect(textWidth(l, 13)).toBeLessThanOrEqual(60);
  });

  it('returns one empty line for empty text', () => {
    expect(wrapText('', 100, 13)).toEqual(['']);
  });
});
