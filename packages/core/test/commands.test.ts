import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  CommandError,
  formatPredecessors,
  parsePredecessors,
  renumberTasks,
  setPredecessorsCommand,
  type Command,
  type CommandErrorCode,
  type Project,
  type Task,
  type Template,
  type TemplateTask,
} from '../src/index.js';

// ---------------------------------------------------------------------------------------
// Fixtures (made-up data)

function task(id: string, assetId: string, code: string, extra: Partial<Task> = {}): Task {
  return { id, assetId, code, name: `Task ${code}`, type: 'task', durationDays: 2, percentComplete: 0, ...extra };
}

/** Two assets with three and two tasks, chained within each group, plus one cross link. */
function sample(): Project {
  return {
    id: 'p1',
    name: 'Sample job',
    subtitle: 'Electrical commissioning',
    startDate: '2026-11-02',
    dataDate: '2026-11-02',
    calendar: { workWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-11-26'] },
    assets: [
      { id: 'a1', tag: 'SWGR-1A', description: 'Switchgear', location: 'Room 101' },
      { id: 'a2', tag: 'XFMR-1A', description: 'Transformer' },
    ],
    tasks: [
      task('t1', 'a1', '1.1'),
      task('t2', 'a1', '1.2', { responsible: 'Crew A' }),
      task('t3', 'a1', '1.3', { actualStart: '2026-11-04', percentComplete: 50 }),
      task('t4', 'a2', '2.1'),
      task('t5', 'a2', '2.2', { type: 'milestone', durationDays: 0 }),
    ],
    dependencies: [
      { predecessorId: 't1', successorId: 't2', type: 'FS', lagDays: 0 },
      { predecessorId: 't2', successorId: 't3', type: 'FS', lagDays: 0 },
      { predecessorId: 't4', successorId: 't5', type: 'FS', lagDays: 0 },
      { predecessorId: 't3', successorId: 't5', type: 'SS', lagDays: 2 },
    ],
  };
}

function tt(key: string, durationDays: number, preds: string[] = [], extra: Partial<TemplateTask> = {}): TemplateTask {
  return {
    key, name: `Step ${key}`, durationDays, type: 'task', trade: 'Electrical',
    predecessors: preds.map((p) => ({ key: p, type: 'FS', lagDays: 0 })),
    checklist: [], requiredCerts: [], ...extra,
  };
}

function panelTemplate(): Template {
  return {
    id: 'tpl-panel', name: 'Panelboard', version: 2, kind: 'starter', assetDescription: 'Panelboard',
    stages: ['Set', 'Tested'], requiredDocs: [],
    tasks: [tt('vmi', 1), tt('ir', 1, ['vmi']), tt('energize', 0, ['ir'], { type: 'milestone' })],
  };
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/**
 * Applies a command to a frozen project (so any mutation throws), then checks that its
 * inverse restores the original exactly, that redo (the inverse's inverse) gives the
 * edited project again, and that the inverse survives a JSON round trip.
 */
function roundTrip(project: Project, cmd: Command) {
  const original = structuredClone(project);
  const r = applyCommand(deepFreeze(project), cmd);
  expect(project).toStrictEqual(original);
  const undone = applyCommand(deepFreeze(r.project), r.inverse);
  expect(undone.project).toStrictEqual(original);
  const redone = applyCommand(undone.project, undone.inverse);
  expect(redone.project).toStrictEqual(r.project);
  const viaJson = applyCommand(r.project, JSON.parse(JSON.stringify(r.inverse)) as Command);
  expect(viaJson.project).toStrictEqual(original);
  return r;
}

function expectError(project: Project, cmd: Command, code: CommandErrorCode) {
  let err: unknown;
  try {
    applyCommand(deepFreeze(project), cmd);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(CommandError);
  expect((err as CommandError).code).toBe(code);
}

const codes = (p: Project) => Object.fromEntries(p.tasks.map((t) => [t.id, t.code]));
const groupOrder = (p: Project, assetId: string) => p.tasks.filter((t) => t.assetId === assetId).map((t) => t.id);

// ---------------------------------------------------------------------------------------

describe('addAssetsFromTemplate', () => {
  it('adds assets with tasks, links and codes in new groups, and undoes', () => {
    const r = roundTrip(sample(), {
      kind: 'addAssetsFromTemplate',
      template: panelTemplate(),
      assets: [
        { tag: 'PNL-1A', description: 'Panel 1A', location: 'Level 1', startNoEarlierThan: '2026-11-09' },
        { tag: 'PNL 1B', description: 'Panel 1B', system: 'Normal power' },
      ],
    });
    const p = r.project;
    expect(p.assets.map((a) => a.id)).toEqual(['a1', 'a2', 'pnl-1a', 'pnl-1b']);
    expect(p.assets[2]).toStrictEqual({
      id: 'pnl-1a', tag: 'PNL-1A', description: 'Panel 1A', location: 'Level 1', templateId: 'tpl-panel', templateVersion: 2,
    });
    expect(p.tasks.filter((t) => t.assetId === 'pnl-1b').map((t) => [t.id, t.code])).toEqual([
      ['pnl-1b:vmi', '4.1'], ['pnl-1b:ir', '4.2'], ['pnl-1b:energize', '4.3'],
    ]);
    expect(p.tasks.find((t) => t.id === 'pnl-1a:vmi')!.startNoEarlierThan).toBe('2026-11-09');
    expect(p.tasks.find((t) => t.id === 'pnl-1b:vmi')!.startNoEarlierThan).toBeUndefined();
    expect(p.dependencies).toHaveLength(4 + 4);
    expect(r.summary).toBe('Added 2 assets from Panelboard: PNL-1A, PNL 1B');
  });

  it('makes ids unique and honours explicit ids', () => {
    const base = sample();
    const r = applyCommand(base, {
      kind: 'addAssetsFromTemplate', template: panelTemplate(),
      assets: [{ tag: 'A1', description: '' }, { tag: 'a1', description: '' }, { id: 'mine', tag: 'X', description: '' }],
    });
    expect(r.project.assets.slice(2).map((a) => a.id)).toEqual(['a1-2', 'a1-3', 'mine']);
  });

  it('rejects bad input', () => {
    const tpl = panelTemplate();
    expectError(sample(), { kind: 'addAssetsFromTemplate', template: tpl, assets: [] }, 'empty-batch');
    expectError(sample(), { kind: 'addAssetsFromTemplate', template: tpl, assets: [{ tag: ' ', description: '' }] }, 'empty-name');
    expectError(sample(), { kind: 'addAssetsFromTemplate', template: tpl, assets: [{ id: 'a1', tag: 'X', description: '' }] }, 'duplicate-id');
    expectError(sample(), { kind: 'addAssetsFromTemplate', template: tpl, assets: [{ tag: 'X', description: '', startNoEarlierThan: '2026-13-01' }] }, 'invalid-date');
    const bad = { ...tpl, tasks: [tt('a', 1, ['b']), tt('b', 1, ['a'])] };
    expectError(sample(), { kind: 'addAssetsFromTemplate', template: bad, assets: [{ tag: 'X', description: '' }] }, 'invalid-template');
  });
});

describe('removeAsset / restoreAsset', () => {
  it('removes the asset, its tasks and every link touching them, renumbers later groups, and undoes', () => {
    const r = roundTrip(sample(), { kind: 'removeAsset', id: 'a1' });
    expect(r.project.assets.map((a) => a.id)).toEqual(['a2']);
    expect(codes(r.project)).toEqual({ t4: '1.1', t5: '1.2' });
    expect(r.project.dependencies).toEqual([{ predecessorId: 't4', successorId: 't5', type: 'FS', lagDays: 0 }]);
    expect(r.summary).toBe('Removed asset SWGR-1A and 3 tasks');
    expect(r.inverse.kind).toBe('restoreAsset');
  });

  it('removes the last asset without touching earlier groups', () => {
    const r = roundTrip(sample(), { kind: 'removeAsset', id: 'a2' });
    expect(codes(r.project)).toEqual({ t1: '1.1', t2: '1.2', t3: '1.3' });
  });

  it('rejects unknown ids and conflicting restores', () => {
    expectError(sample(), { kind: 'removeAsset', id: 'nope' }, 'unknown-asset');
    const p = sample();
    expectError(p, { kind: 'restoreAsset', asset: p.assets[0]!, index: 0, tasks: [], dependencies: [] }, 'duplicate-id');
  });
});

describe('updateAsset', () => {
  it('changes, adds and clears fields, and undoes', () => {
    const r = roundTrip(sample(), {
      kind: 'updateAsset', id: 'a1', patch: { tag: 'SWGR-1B', location: null, system: 'Normal power' },
    });
    expect(r.project.assets[0]).toStrictEqual({ id: 'a1', tag: 'SWGR-1B', description: 'Switchgear', system: 'Normal power' });
    expect(r.summary).toBe('Updated asset SWGR-1A: tag, location, system');
  });

  it('rejects unknown assets and an empty tag', () => {
    expectError(sample(), { kind: 'updateAsset', id: 'x', patch: {} }, 'unknown-asset');
    expectError(sample(), { kind: 'updateAsset', id: 'a1', patch: { tag: '' } }, 'empty-name');
  });
});

describe('addTask', () => {
  it('appends to the end of the group by default, with defaults, and undoes', () => {
    const r = roundTrip(sample(), { kind: 'addTask', assetId: 'a1', task: { name: 'Thermal scan' } });
    const added = r.project.tasks[3]!;
    expect(added).toStrictEqual({
      id: 'a1:t1', assetId: 'a1', code: '1.4', name: 'Thermal scan', type: 'task', durationDays: 1, percentComplete: 0,
    });
    expect(r.summary).toBe('Added task 1.4 Thermal scan');
  });

  it('inserts after a given task and renumbers the group', () => {
    const r = roundTrip(sample(), {
      kind: 'addTask', assetId: 'a1', afterTaskId: 't1', id: 'new',
      task: { name: 'Witness', type: 'witness', durationDays: 1, responsible: 'Cx agent' },
    });
    expect(groupOrder(r.project, 'a1')).toEqual(['t1', 'new', 't2', 't3']);
    expect(codes(r.project)).toMatchObject({ t1: '1.1', new: '1.2', t2: '1.3', t3: '1.4', t4: '2.1' });
  });

  it('gives milestones zero duration and places the first task of an empty asset after earlier groups', () => {
    let p = applyCommand(sample(), { kind: 'removeTask', id: 't4' }).project;
    p = applyCommand(p, { kind: 'removeTask', id: 't5' }).project;
    p = { ...p, assets: [...p.assets, { id: 'a3', tag: 'GEN-1', description: '' }] };
    p = applyCommand(p, { kind: 'addTask', assetId: 'a1', task: { name: 'Last of a1' } }).project;
    const r = roundTrip(p, { kind: 'addTask', assetId: 'a2', id: 'm', task: { name: 'Done', type: 'milestone' } });
    expect(r.project.tasks.map((t) => t.id)).toEqual(['t1', 't2', 't3', 'a1:t1', 'm']);
    expect(r.project.tasks[4]).toMatchObject({ code: '2.1', durationDays: 0 });
  });

  it('rejects invalid tasks', () => {
    const p = sample();
    expectError(p, { kind: 'addTask', assetId: 'zz', task: { name: 'x' } }, 'unknown-asset');
    expectError(p, { kind: 'addTask', assetId: 'a1', afterTaskId: 'zz', task: { name: 'x' } }, 'unknown-task');
    expectError(p, { kind: 'addTask', assetId: 'a1', afterTaskId: 't4', task: { name: 'x' } }, 'unknown-task');
    expectError(p, { kind: 'addTask', assetId: 'a1', id: 't1', task: { name: 'x' } }, 'duplicate-id');
    expectError(p, { kind: 'addTask', assetId: 'a1', task: { name: '' } }, 'empty-name');
    expectError(p, { kind: 'addTask', assetId: 'a1', task: { name: 'x', durationDays: -1 } }, 'invalid-duration');
    expectError(p, { kind: 'addTask', assetId: 'a1', task: { name: 'x', durationDays: 1.5 } }, 'invalid-duration');
    expectError(p, { kind: 'addTask', assetId: 'a1', task: { name: 'x', type: 'milestone', durationDays: 2 } }, 'milestone-duration');
    expectError(p, { kind: 'addTask', assetId: 'a1', task: { name: 'x', percentComplete: 101 } }, 'invalid-percent');
    expectError(p, { kind: 'addTask', assetId: 'a1', task: { name: 'x', type: 'bogus' as never } }, 'invalid-type');
  });
});

describe('removeTask / restoreTask', () => {
  it('removes the task and its links, renumbers the group, and undoes', () => {
    const r = roundTrip(sample(), { kind: 'removeTask', id: 't2' });
    expect(codes(r.project)).toEqual({ t1: '1.1', t3: '1.2', t4: '2.1', t5: '2.2' });
    expect(r.project.dependencies.map((d) => `${d.predecessorId}>${d.successorId}`)).toEqual(['t4>t5', 't3>t5']);
    expect(r.summary).toBe('Removed task 1.2 Task 1.2 and 2 links');
  });

  it('rejects unknown tasks and restores that clash', () => {
    expectError(sample(), { kind: 'removeTask', id: 'zz' }, 'unknown-task');
    const p = sample();
    expectError(p, { kind: 'restoreTask', task: p.tasks[0]!, index: 0, dependencies: [] }, 'duplicate-id');
    expectError(p, { kind: 'restoreTask', task: task('n', 'zz', '9.9'), index: 0, dependencies: [] }, 'unknown-asset');
    expectError(p, { kind: 'restoreTask', task: task('n', 'a1', '1.9'), index: 99, dependencies: [] }, 'invalid-index');
  });
});

describe('updateTask', () => {
  it('changes, sets and clears fields, and undoes', () => {
    const r = roundTrip(sample(), {
      kind: 'updateTask', id: 't3',
      patch: { name: 'IR test', durationDays: 3, percentComplete: 100, actualFinish: '2026-11-06', responsible: 'Tech' },
    });
    expect(r.project.tasks[2]).toMatchObject({ name: 'IR test', durationDays: 3, actualFinish: '2026-11-06', responsible: 'Tech' });
    expect(r.summary).toBe('Updated 1.3: name, duration, % complete, actual finish, responsible');
    const cleared = roundTrip(sample(), { kind: 'updateTask', id: 't2', patch: { responsible: null } });
    expect('responsible' in cleared.project.tasks[1]!).toBe(false);
  });

  it('ignores attempts to change id, asset or code through a patch', () => {
    const r = applyCommand(sample(), { kind: 'updateTask', id: 't1', patch: { id: 'x', assetId: 'a2', code: '9.9' } as never });
    expect(r.project.tasks[0]).toStrictEqual(sample().tasks[0]);
  });

  it('rejects invalid values', () => {
    const p = sample();
    const up = (patch: Record<string, unknown>): Command => ({ kind: 'updateTask', id: 't3', patch });
    expectError(p, { kind: 'updateTask', id: 'zz', patch: {} }, 'unknown-task');
    expectError(p, up({ durationDays: -2 }), 'invalid-duration');
    expectError(p, up({ durationDays: Number.NaN }), 'invalid-duration');
    expectError(p, up({ percentComplete: -1 }), 'invalid-percent');
    expectError(p, up({ percentComplete: 150 }), 'invalid-percent');
    expectError(p, up({ actualFinish: '2026-11-03' }), 'finish-before-start');
    expectError(p, up({ actualStart: null, actualFinish: '2026-11-05' }), 'finish-without-start');
    expectError(p, up({ actualStart: '2026-02-30' }), 'invalid-date');
    expectError(p, up({ startNoEarlierThan: 'soon' }), 'invalid-date');
    expectError(p, up({ type: 'milestone' }), 'milestone-duration');
    expectError(p, up({ name: '  ' }), 'empty-name');
    expectError(p, up({ name: null }), 'empty-name');
  });
});

describe('moveTask', () => {
  it('reorders within a group (indent) and undoes', () => {
    const r = roundTrip(sample(), { kind: 'moveTask', id: 't3', toAssetId: 'a1', toIndex: 0 });
    expect(groupOrder(r.project, 'a1')).toEqual(['t3', 't1', 't2']);
    expect(codes(r.project)).toMatchObject({ t3: '1.1', t1: '1.2', t2: '1.3' });
    expect(r.summary).toBe('Moved 1.3 Task 1.3 to 1.1');
  });

  it('moves to the end of a group', () => {
    const r = roundTrip(sample(), { kind: 'moveTask', id: 't1', toAssetId: 'a1', toIndex: 2 });
    expect(groupOrder(r.project, 'a1')).toEqual(['t2', 't3', 't1']);
  });

  it('moves into another group, keeping links, and renumbers both groups', () => {
    const r = roundTrip(sample(), { kind: 'moveTask', id: 't2', toAssetId: 'a2', toIndex: 1 });
    expect(groupOrder(r.project, 'a2')).toEqual(['t4', 't2', 't5']);
    expect(codes(r.project)).toEqual({ t1: '1.1', t3: '1.2', t4: '2.1', t2: '2.2', t5: '2.3' });
    expect(r.project.tasks.find((t) => t.id === 't2')!.assetId).toBe('a2');
    expect(r.project.dependencies).toEqual(sample().dependencies);
  });

  it('moves into an empty group', () => {
    const p: Project = { ...sample(), assets: [...sample().assets, { id: 'a3', tag: 'UPS-1', description: '' }] };
    const r = roundTrip(p, { kind: 'moveTask', id: 't1', toAssetId: 'a3', toIndex: 0 });
    expect(r.project.tasks.at(-1)).toMatchObject({ id: 't1', assetId: 'a3', code: '3.1' });
  });

  it('rejects bad moves', () => {
    expectError(sample(), { kind: 'moveTask', id: 'zz', toAssetId: 'a1', toIndex: 0 }, 'unknown-task');
    expectError(sample(), { kind: 'moveTask', id: 't1', toAssetId: 'zz', toIndex: 0 }, 'unknown-asset');
    expectError(sample(), { kind: 'moveTask', id: 't1', toAssetId: 'a1', toIndex: 3 }, 'invalid-index');
    expectError(sample(), { kind: 'moveTask', id: 't1', toAssetId: 'a2', toIndex: -1 }, 'invalid-index');
  });
});

describe('link / unlink / updateDependency', () => {
  it('links two tasks and undoes', () => {
    const r = roundTrip(sample(), { kind: 'link', predecessorId: 't1', successorId: 't4', type: 'FS', lagDays: 0 });
    expect(r.project.dependencies.at(-1)).toStrictEqual({ predecessorId: 't1', successorId: 't4', type: 'FS', lagDays: 0 });
    expect(r.summary).toBe('Linked 1.1 → 2.1 (FS)');
    const lag = applyCommand(sample(), { kind: 'link', predecessorId: 't1', successorId: 't3', type: 'SS', lagDays: 2 });
    expect(lag.summary).toBe('Linked 1.1 → 1.3 (SS+2)');
  });

  it('rejects loops, self links, duplicates, unknown tasks and bad lag', () => {
    const p = sample();
    expectError(p, { kind: 'link', predecessorId: 't3', successorId: 't1', type: 'FS', lagDays: 0 }, 'cycle');
    expectError(p, { kind: 'link', predecessorId: 't5', successorId: 't2', type: 'FF', lagDays: 0 }, 'cycle');
    expectError(p, { kind: 'link', predecessorId: 't1', successorId: 't1', type: 'FS', lagDays: 0 }, 'self-link');
    expectError(p, { kind: 'link', predecessorId: 't1', successorId: 't2', type: 'SS', lagDays: 0 }, 'duplicate-dependency');
    expectError(p, { kind: 'link', predecessorId: 'zz', successorId: 't2', type: 'FS', lagDays: 0 }, 'unknown-task');
    expectError(p, { kind: 'link', predecessorId: 't1', successorId: 'zz', type: 'FS', lagDays: 0 }, 'unknown-task');
    expectError(p, { kind: 'link', predecessorId: 't1', successorId: 't4', type: 'FS', lagDays: 0.5 }, 'invalid-lag');
    expectError(p, { kind: 'link', predecessorId: 't1', successorId: 't4', type: 'XX' as never, lagDays: 0 }, 'invalid-type');
    expectError(p, { kind: 'link', predecessorId: 't1', successorId: 't4', type: 'FS', lagDays: 0, index: 9 }, 'invalid-index');
  });

  it('unlinks from the middle of the list and undo puts it back in place', () => {
    const r = roundTrip(sample(), { kind: 'unlink', predecessorId: 't2', successorId: 't3' });
    expect(r.project.dependencies).toHaveLength(3);
    expect(r.summary).toBe('Unlinked 1.2 → 1.3');
    expectError(sample(), { kind: 'unlink', predecessorId: 't1', successorId: 't3' }, 'unknown-dependency');
  });

  it('changes a link type and lag and undoes', () => {
    const r = roundTrip(sample(), { kind: 'updateDependency', predecessorId: 't3', successorId: 't5', patch: { type: 'FF', lagDays: -1 } });
    expect(r.project.dependencies[3]).toStrictEqual({ predecessorId: 't3', successorId: 't5', type: 'FF', lagDays: -1 });
    expect(r.summary).toBe('Changed link 1.3 → 2.2 to FF-1');
    roundTrip(sample(), { kind: 'updateDependency', predecessorId: 't3', successorId: 't5', patch: { lagDays: 0 } });
    expectError(sample(), { kind: 'updateDependency', predecessorId: 't1', successorId: 't5', patch: {} }, 'unknown-dependency');
    expectError(sample(), { kind: 'updateDependency', predecessorId: 't3', successorId: 't5', patch: { lagDays: 1.2 } }, 'invalid-lag');
  });
});

describe('project-level commands', () => {
  it('sets the data date and undoes', () => {
    const r = roundTrip(sample(), { kind: 'setDataDate', date: '2026-11-09' });
    expect(r.project.dataDate).toBe('2026-11-09');
    expectError(sample(), { kind: 'setDataDate', date: '11/09/2026' }, 'invalid-date');
  });

  it('updates project info, clearing and adding the subtitle, and undoes', () => {
    const r = roundTrip(sample(), { kind: 'updateProjectInfo', name: 'Renamed', subtitle: null, startDate: '2026-10-26' });
    expect(r.project).toMatchObject({ name: 'Renamed', startDate: '2026-10-26' });
    expect('subtitle' in r.project).toBe(false);
    const noSub = r.project;
    roundTrip(noSub, { kind: 'updateProjectInfo', subtitle: 'Back again' });
    roundTrip(sample(), { kind: 'updateProjectInfo' });
    expectError(sample(), { kind: 'updateProjectInfo', name: '' }, 'empty-name');
    expectError(sample(), { kind: 'updateProjectInfo', startDate: '2026-1-1' }, 'invalid-date');
  });

  it('sets the calendar and undoes', () => {
    const r = roundTrip(sample(), { kind: 'setCalendar', calendar: { workWeekdays: [1, 2, 3, 4, 5, 6], holidays: ['2026-12-25'] } });
    expect(r.project.calendar.workWeekdays).toHaveLength(6);
    expectError(sample(), { kind: 'setCalendar', calendar: { workWeekdays: [], holidays: [] } }, 'invalid-calendar');
    expectError(sample(), { kind: 'setCalendar', calendar: { workWeekdays: [7], holidays: [] } }, 'invalid-calendar');
    expectError(sample(), { kind: 'setCalendar', calendar: { workWeekdays: [1, 1], holidays: [] } }, 'invalid-calendar');
    expectError(sample(), { kind: 'setCalendar', calendar: { workWeekdays: [1], holidays: ['xmas'] } }, 'invalid-date');
  });
});

describe('batch', () => {
  it('applies commands in order as one step and undoes them all', () => {
    const r = roundTrip(sample(), {
      kind: 'batch',
      commands: [
        { kind: 'addTask', assetId: 'a2', id: 'n1', task: { name: 'New' } },
        { kind: 'link', predecessorId: 't5', successorId: 'n1', type: 'FS', lagDays: 0 },
        { kind: 'removeTask', id: 't1' },
        { kind: 'moveTask', id: 't3', toAssetId: 'a2', toIndex: 0 },
      ],
    });
    expect(codes(r.project)).toEqual({ t2: '1.1', t3: '2.1', t4: '2.2', t5: '2.3', n1: '2.4' });
    expect(r.summary).toContain('Added task 2.3 New; Linked 2.2 → 2.3 (FS)');
  });

  it('is all or nothing and rejects an empty batch', () => {
    const p = sample();
    expectError(p, {
      kind: 'batch',
      commands: [{ kind: 'removeTask', id: 't1' }, { kind: 'removeTask', id: 't1' }],
    }, 'unknown-task');
    expectError(p, { kind: 'batch', commands: [] }, 'empty-batch');
  });

  it('chains of undo restore the original after many edits', () => {
    const start = sample();
    let p = start;
    const undo: Command[] = [];
    const edits: Command[] = [
      { kind: 'addAssetsFromTemplate', template: panelTemplate(), assets: [{ tag: 'PNL-2', description: 'Panel' }] },
      { kind: 'moveTask', id: 'pnl-2:ir', toAssetId: 'a1', toIndex: 1 },
      { kind: 'link', predecessorId: 'pnl-2:ir', successorId: 't4', type: 'FS', lagDays: 1 },
      { kind: 'removeAsset', id: 'a1' },
      { kind: 'updateTask', id: 't4', patch: { percentComplete: 25, actualStart: '2026-11-03' } },
      { kind: 'setDataDate', date: '2026-11-05' },
    ];
    for (const e of edits) {
      const r = applyCommand(p, e);
      p = r.project;
      undo.push(r.inverse);
    }
    for (const u of undo.reverse()) p = applyCommand(p, u).project;
    expect(p).toStrictEqual(start);
  });
});

describe('renumberTasks', () => {
  it('fixes codes to follow asset and task order, keeping unchanged tasks', () => {
    const p = sample();
    const messy: Project = { ...p, tasks: p.tasks.map((t) => ({ ...t, code: 'x' })) };
    expect(codes(renumberTasks(messy))).toEqual(codes(p));
    expect(renumberTasks(p)).toBe(p);
    expect(codes(renumberTasks(messy, ['a2']))).toMatchObject({ t1: 'x', t4: '2.1' });
  });
});

describe('parsePredecessors / formatPredecessors', () => {
  const p = sample();

  it('reads codes with optional type and lag', () => {
    expect(parsePredecessors('1.3', p, 't4')).toEqual({ predecessors: [{ predecessorId: 't3', type: 'FS', lagDays: 0 }], errors: [] });
    expect(parsePredecessors('1.3 FS', p, 't4').predecessors).toEqual([{ predecessorId: 't3', type: 'FS', lagDays: 0 }]);
    expect(parsePredecessors('1.2SS+2', p, 't4').predecessors).toEqual([{ predecessorId: 't2', type: 'SS', lagDays: 2 }]);
    expect(parsePredecessors('2.1 FF-1, 1.3', p, 't5').predecessors).toEqual([
      { predecessorId: 't4', type: 'FF', lagDays: -1 },
      { predecessorId: 't3', type: 'FS', lagDays: 0 },
    ]);
    expect(parsePredecessors(' 1.1 sf + 3d ; 1.2+1 ,, ', p, 't4').predecessors).toEqual([
      { predecessorId: 't1', type: 'SF', lagDays: 3 },
      { predecessorId: 't2', type: 'FS', lagDays: 1 },
    ]);
    expect(parsePredecessors('', p, 't4')).toEqual({ predecessors: [], errors: [] });
  });

  it('reads a bare number as a task in the same group', () => {
    expect(parsePredecessors('1', p, 't3').predecessors).toEqual([{ predecessorId: 't1', type: 'FS', lagDays: 0 }]);
    expect(parsePredecessors('1 SS', p, 't5').predecessors).toEqual([{ predecessorId: 't4', type: 'SS', lagDays: 0 }]);
  });

  it('reports problems per item and keeps the good ones', () => {
    const r = parsePredecessors('1.1, 9.9, 1.3, foo, 1.1 SS, 1.2 XX', p, 't3');
    expect(r.predecessors).toEqual([{ predecessorId: 't1', type: 'FS', lagDays: 0 }]);
    expect(r.errors.map((e) => e.text)).toEqual(['9.9', '1.3', 'foo', '1.1 SS', '1.2 XX']);
    expect(r.errors[0]!.message).toBe('There is no task 9.9');
    expect(r.errors[1]!.message).toBe('1.3 cannot follow itself');
    expect(() => parsePredecessors('1.1', p, 'zz')).toThrow(CommandError);
  });

  it('formats a task\'s predecessors and round-trips through the parser', () => {
    expect(formatPredecessors(p, 't5')).toBe('2.1 FS, 1.3 SS+2');
    expect(formatPredecessors(p, 't1')).toBe('');
    const q = applyCommand(p, { kind: 'updateDependency', predecessorId: 't3', successorId: 't5', patch: { type: 'FF', lagDays: -1 } }).project;
    expect(formatPredecessors(q, 't5')).toBe('2.1 FS, 1.3 FF-1');
    expect(parsePredecessors(formatPredecessors(q, 't5'), q, 't5').predecessors).toEqual(
      q.dependencies.filter((d) => d.successorId === 't5').map(({ predecessorId, type, lagDays }) => ({ predecessorId, type, lagDays })),
    );
  });
});

describe('setPredecessorsCommand', () => {
  it('builds one undoable step that adds, updates and removes links', () => {
    const p = sample();
    const parsed = parsePredecessors('1.3 FF-1, 1.1', p, 't5');
    const cmd = setPredecessorsCommand(p, 't5', parsed.predecessors)!;
    const r = roundTrip(p, cmd);
    expect(formatPredecessors(r.project, 't5')).toBe('1.3 FF-1, 1.1 FS');
    expect(r.summary).toBe('Set predecessors of 2.2 to 1.3 FF-1, 1.1 FS');
  });

  it('returns null when nothing changes, and clears all predecessors', () => {
    const p = sample();
    expect(setPredecessorsCommand(p, 't5', parsePredecessors('2.1, 1.3 SS+2', p, 't5').predecessors)).toBeNull();
    const r = roundTrip(p, setPredecessorsCommand(p, 't5', [])!);
    expect(formatPredecessors(r.project, 't5')).toBe('');
    expect(r.summary).toBe('Removed predecessors of 2.2');
  });

  it('rejects a loop when applied', () => {
    const p = sample();
    const cmd = setPredecessorsCommand(p, 't1', parsePredecessors('1.3', p, 't1').predecessors)!;
    expectError(p, cmd, 'cycle');
  });
});
