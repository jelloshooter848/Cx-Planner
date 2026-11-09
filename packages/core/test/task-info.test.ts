import { describe, expect, it } from 'vitest';
import { firstDownstreamMilestone, templateTaskFor, type Asset, type Project, type Task, type Template } from '../src/index.js';

// Made-up data.
function task(id: string, extra: Partial<Task> = {}): Task {
  return { id, assetId: 'a', code: id, name: `Task ${id}`, type: 'task', durationDays: 1, percentComplete: 0, ...extra };
}

function project(tasks: Task[], links: Array<[string, string]>): Project {
  return {
    id: 'p',
    name: 'P',
    startDate: '2026-11-02',
    dataDate: '2026-11-02',
    calendar: { workWeekdays: [1, 2, 3, 4, 5], holidays: [] },
    assets: [{ id: 'a', tag: 'A-1', description: 'Asset' }],
    tasks,
    dependencies: links.map(([p, s]) => ({ predecessorId: p, successorId: s, type: 'FS', lagDays: 0 })),
  };
}

describe('firstDownstreamMilestone', () => {
  // a -> b -> m1 (es 5); a -> c -> d -> m2 (es 3); x -> m3 (unrelated)
  const p = project(
    [task('a'), task('b'), task('c'), task('d'), task('m1', { type: 'milestone' }), task('m2', { type: 'milestone' }), task('x'), task('m3', { type: 'milestone' })],
    [['a', 'b'], ['b', 'm1'], ['a', 'c'], ['c', 'd'], ['d', 'm2'], ['x', 'm3']],
  );
  const es: Record<string, number> = { m1: 5, m2: 3, m3: 0 };

  it('picks the earliest reachable milestone at any depth', () => {
    expect(firstDownstreamMilestone(p, 'a', (id) => es[id])?.id).toBe('m2');
    expect(firstDownstreamMilestone(p, 'b', (id) => es[id])?.id).toBe('m1');
  });

  it('returns null when no milestone is downstream, and skips the task itself', () => {
    expect(firstDownstreamMilestone(p, 'm1', (id) => es[id])).toBeNull();
    expect(firstDownstreamMilestone(p, 'm2', (id) => es[id])).toBeNull();
  });

  it('skips milestones with no scheduled start and keeps project order on ties', () => {
    expect(firstDownstreamMilestone(p, 'a', (id) => (id === 'm2' ? undefined : es[id]))?.id).toBe('m1');
    expect(firstDownstreamMilestone(p, 'a', () => 4)?.id).toBe('m1');
  });

  it('copes with shared successors (diamonds)', () => {
    const q = project([task('s'), task('l'), task('r'), task('m', { type: 'milestone' })], [['s', 'l'], ['s', 'r'], ['l', 'm'], ['r', 'm']]);
    expect(firstDownstreamMilestone(q, 's', () => 2)?.id).toBe('m');
  });
});

describe('templateTaskFor', () => {
  const template: Template = {
    id: 'tpl',
    name: 'Switchgear',
    version: 2,
    kind: 'custom',
    assetDescription: 'Switchgear',
    stages: [],
    requiredDocs: [],
    tasks: [
      { key: 'ir', name: 'IR test', durationDays: 1, type: 'task', trade: 'Test tech', predecessors: [], checklist: [{ id: 'ir-1', text: 'Megger each phase' }], requiredCerts: [] },
    ],
  };
  const asset: Asset = { id: 'a', tag: 'A-1', description: 'Asset', templateId: 'tpl', templateVersion: 2 };

  it('finds the template task through the asset and template key', () => {
    const link = templateTaskFor([template], asset, task('t', { templateKey: 'ir' }));
    expect(link?.template.name).toBe('Switchgear');
    expect(link?.templateTask.checklist.map((c) => c.text)).toEqual(['Megger each phase']);
  });

  it('returns null for hand-added tasks, other assets and missing keys', () => {
    expect(templateTaskFor([template], asset, task('t'))).toBeNull();
    expect(templateTaskFor([template], { ...asset, templateId: undefined }, task('t', { templateKey: 'ir' }))).toBeNull();
    expect(templateTaskFor([template], asset, task('t', { templateKey: 'gone' }))).toBeNull();
    expect(templateTaskFor([], asset, task('t', { templateKey: 'ir' }))).toBeNull();
    expect(templateTaskFor([template], undefined, task('t', { templateKey: 'ir' }))).toBeNull();
  });
});
