import { describe, expect, it } from 'vitest';
import {
  assetTagProblem,
  buildAddAssetsCommand,
  expandTagPattern,
  findTagProblems,
  parseAssetRows,
  previewAddAssets,
  TagPatternError,
  templateEndpoints,
  type AssetRowInput,
  type Project,
  type Template,
  type TemplateTask,
} from '../src/index.js';

// Made-up data.
function tt(key: string, durationDays: number, preds: string[] = [], extra: Partial<TemplateTask> = {}): TemplateTask {
  return {
    key, name: `Step ${key}`, durationDays, type: 'task', trade: 'Electrical',
    predecessors: preds.map((p) => ({ key: p, type: 'FS', lagDays: 0 })),
    checklist: [], requiredCerts: [], ...extra,
  };
}

/** Four tasks, 3 working days end to end. */
function panel(): Template {
  return {
    id: 'tpl-panel', name: 'Panelboard', version: 1, kind: 'starter', assetDescription: 'Panelboard',
    stages: [], requiredDocs: [],
    tasks: [tt('vmi', 1), tt('ir', 1, ['vmi']), tt('dir', 1, ['ir']), tt('energize', 0, ['dir'], { type: 'milestone' })],
  };
}

function project(): Project {
  return {
    id: 'p', name: 'Job', startDate: '2026-11-02', dataDate: '2026-11-02',
    calendar: { workWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-11-26', '2026-11-27'] },
    assets: [{ id: 'a1', tag: 'SWGR-1A', description: 'Switchgear' }],
    tasks: [{ id: 't1', assetId: 'a1', code: '1.1', name: 'Inspect', type: 'task', durationDays: 2, percentComplete: 0 }],
    dependencies: [],
  };
}

const row = (tag: string, extra: Partial<AssetRowInput> = {}): AssetRowInput => ({ tag, description: '', location: '', system: '', ...extra });

describe('expandTagPattern', () => {
  it('counts numbers and keeps zero padding', () => {
    expect(expandTagPattern('PNL-L1-01..12')).toEqual(Array.from({ length: 12 }, (_, i) => `PNL-L1-${String(i + 1).padStart(2, '0')}`));
    expect(expandTagPattern('PNL-1..3')).toEqual(['PNL-1', 'PNL-2', 'PNL-3']);
    expect(expandTagPattern('PNL-8..11')).toEqual(['PNL-8', 'PNL-9', 'PNL-10', 'PNL-11']);
    expect(expandTagPattern('X-098..101')).toEqual(['X-098', 'X-099', 'X-100', 'X-101']);
    expect(expandTagPattern(' LP-1 .. 2 ')).toEqual(['LP-1', 'LP-2']);
  });

  it('counts letters, with or without the repeated text before them', () => {
    expect(expandTagPattern('SWGR-1A..1D')).toEqual(['SWGR-1A', 'SWGR-1B', 'SWGR-1C', 'SWGR-1D']);
    expect(expandTagPattern('SWGR-1A..D')).toEqual(['SWGR-1A', 'SWGR-1B', 'SWGR-1C', 'SWGR-1D']);
    expect(expandTagPattern('mcc-a..c')).toEqual(['mcc-a', 'mcc-b', 'mcc-c']);
  });

  it('passes a plain tag through and gives nothing for empty text', () => {
    expect(expandTagPattern('  ATS-1 ')).toEqual(['ATS-1']);
    expect(expandTagPattern('   ')).toEqual([]);
    expect(expandTagPattern('PNL-1..1')).toEqual(['PNL-1']);
  });

  it('explains patterns it cannot read', () => {
    const bad = ['PNL-1..', '..3', 'PNL-3..1', 'SWGR-1D..1A', 'SWGR-1A..2D', 'PNL-A..3', 'PNL-1..B', 'A..b', 'P-1..2..3', 'PNL-1..3-', 'X..AB'];
    for (const p of bad) expect(() => expandTagPattern(p), p).toThrow(TagPatternError);
    expect(() => expandTagPattern('P-1..501')).toThrow(/at most 500/);
    expect(expandTagPattern('P-1..20', 20)).toHaveLength(20);
    expect(() => expandTagPattern('P-1..21', 20)).toThrow(TagPatternError);
  });
});

describe('parseAssetRows', () => {
  it('reads tab-separated rows, skipping a header and blank lines', () => {
    const text = 'Tag\tDescription\tLocation\tSystem\r\nPNL-1\tPanel 1\tElec 101\tNormal\r\n\r\n PNL-2 \t\tElec 102\nPNL-3\n';
    expect(parseAssetRows(text)).toEqual([
      row('PNL-1', { description: 'Panel 1', location: 'Elec 101', system: 'Normal' }),
      row('PNL-2', { location: 'Elec 102' }),
      row('PNL-3'),
    ]);
  });

  it('unquotes cells Excel quoted', () => {
    expect(parseAssetRows('"PNL ""A"""\t"Panel, main"')).toEqual([row('PNL "A"', { description: 'Panel, main' })]);
  });
});

describe('findTagProblems', () => {
  it('flags empty, repeated and existing tags by row', () => {
    const problems = findTagProblems(project(), ['P1', 'swgr-1a', '', 'p1 ', 'P2']);
    expect([...problems.entries()]).toEqual([
      [0, 'P1 is listed more than once'],
      [1, 'swgr-1a is already in the project'],
      [2, 'Enter a tag'],
      [3, 'p1 is listed more than once'],
    ]);
  });
});

describe('assetTagProblem', () => {
  const two = { assets: [{ id: 'a1', tag: 'SWGR-1A', description: '' }, { id: 'a2', tag: 'XFMR-1A', description: '' }] };
  it('refuses an empty tag and one another asset uses (trimmed, any case)', () => {
    expect(assetTagProblem(two, 'a1', '  ')).toBe('An asset needs a tag');
    expect(assetTagProblem(two, 'a1', ' xfmr-1a ')).toBe('xfmr-1a is already used by another asset');
  });
  it('accepts a new tag and a case change of the asset own tag', () => {
    expect(assetTagProblem(two, 'a1', 'SWGR-1C')).toBeNull();
    expect(assetTagProblem(two, 'a1', 'swgr-1a')).toBeNull();
  });
});

describe('templateEndpoints', () => {
  it('finds the first unlinked task and the last task nothing follows', () => {
    expect(templateEndpoints(panel())).toEqual({ first: 'vmi', last: 'energize' });
    const odd: Template = { ...panel(), tasks: [tt('b', 1, ['a']), tt('a', 1), tt('c', 1, ['b']), tt('note', 1, ['a'])] };
    expect(templateEndpoints(odd)).toEqual({ first: 'a', last: 'note' });
    expect(templateEndpoints({ ...panel(), tasks: [] })).toBeNull();
  });
});

describe('buildAddAssetsCommand / previewAddAssets', () => {
  it('trims input and defaults the description from the template', () => {
    const cmd = buildAddAssetsCommand(project(), {
      template: panel(), rows: [row(' P1 ', { description: ' ', location: ' L1 ', system: 'Normal' })],
      startNoEarlierThan: '2026-11-09', sequence: { kind: 'together' },
    });
    expect(cmd).toEqual({
      kind: 'addAssetsFromTemplate', template: panel(),
      assets: [{ tag: 'P1', description: 'Panelboard', location: 'L1', system: 'Normal', startNoEarlierThan: '2026-11-09' }],
    });
  });

  it('previews counts and the finish date without changing the project', () => {
    const p = project();
    const before = structuredClone(p);
    const plan = { template: panel(), rows: [row('P1'), row('P2'), row('P3')], startNoEarlierThan: '2026-11-09' };
    const together = previewAddAssets(p, buildAddAssetsCommand(p, { ...plan, sequence: { kind: 'together' } }));
    expect(together).toEqual({ assets: 3, tasks: 12, finish: '2026-11-11', projectFinish: '2026-11-11', error: null });
    // Follow: 3 working days each, back to back: Nov 9–11, 12–16, 17–19.
    const follow = previewAddAssets(p, buildAddAssetsCommand(p, { ...plan, sequence: { kind: 'follow' } }));
    expect(follow.finish).toBe('2026-11-19');
    // Stagger by 5 working days: starts Nov 9, 16, 23 -> last one Nov 23–25.
    const staggerCmd = buildAddAssetsCommand(p, { ...plan, sequence: { kind: 'stagger', days: 5 } });
    expect(staggerCmd.assets.map((a) => a.startNoEarlierThan)).toEqual(['2026-11-09', '2026-11-16', '2026-11-23']);
    expect(previewAddAssets(p, staggerCmd).finish).toBe('2026-11-25');
    expect(p).toStrictEqual(before);
  });

  it('staggers on working days of the project calendar', () => {
    const cmd = buildAddAssetsCommand(project(), {
      template: panel(), rows: [row('P1'), row('P2'), row('P3')], startNoEarlierThan: '2026-11-25', sequence: { kind: 'stagger', days: 1 },
    });
    // Thanksgiving Thursday and Friday are holidays.
    expect(cmd.assets.map((a) => a.startNoEarlierThan)).toEqual(['2026-11-25', '2026-11-30', '2026-12-01']);
    expect(() => buildAddAssetsCommand(project(), { template: panel(), rows: [], sequence: { kind: 'stagger', days: -1 } })).toThrow(/Stagger/);
  });

  it('reports a refused add instead of throwing', () => {
    const p = project();
    const r = previewAddAssets(p, buildAddAssetsCommand(p, { template: panel(), rows: [row('SWGR-1A')], sequence: { kind: 'together' } }));
    expect(r).toMatchObject({ assets: 1, tasks: 4, finish: null, error: 'Tag "SWGR-1A" is already used' });
  });
});
