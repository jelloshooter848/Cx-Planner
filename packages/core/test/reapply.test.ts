import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  CommandError,
  isInternalCommand,
  planReapply,
  reapplyTemplate,
  TemplateInvalidError,
  UnknownAssetError,
  type Command,
  type CommandErrorCode,
  type Project,
  type Task,
  type Template,
  type TemplateTask,
} from '../src/index.js';

// ---------------------------------------------------------------------------------------
// Fixtures (made-up data)

function tt(key: string, durationDays: number, preds: string[] = [], extra: Partial<TemplateTask> = {}): TemplateTask {
  return {
    key, name: `Step ${key}`, durationDays, type: 'task', trade: 'Electrical',
    predecessors: preds.map((p) => ({ key: p, type: 'FS', lagDays: 0 })),
    checklist: [], requiredCerts: [], ...extra,
  };
}

/** Version 1: vmi → ir → hipot → energize. */
function v1(): Template {
  return {
    id: 'tpl-swgr', name: 'Switchgear', version: 1, kind: 'custom', assetDescription: 'Switchgear',
    stages: ['Set', 'Tested'], requiredDocs: [],
    tasks: [tt('vmi', 1), tt('ir', 2, ['vmi']), tt('hipot', 1, ['ir']), tt('energize', 0, ['hipot'], { type: 'milestone' })],
  };
}

/**
 * Version 2: "ir" renamed and longer, "hipot" dropped, "torque" added between vmi and ir,
 * "witness" added after ir, energize now follows witness.
 */
function v2(): Template {
  return {
    ...v1(),
    version: 2,
    tasks: [
      tt('vmi', 1),
      tt('torque', 1, ['vmi'], { trade: 'Test tech' }),
      tt('ir', 3, ['torque'], { name: 'Insulation resistance' }),
      tt('witness', 0, ['ir'], { type: 'witness', trade: 'Cx agent' }),
      tt('energize', 0, ['witness'], { type: 'milestone' }),
    ],
  };
}

function t(id: string, assetId: string, code: string, key: string | undefined, extra: Partial<Task> = {}): Task {
  const base: Task = { id, assetId, code, name: `Step ${key ?? id}`, type: 'task', durationDays: 1, percentComplete: 0, responsible: 'Electrical', ...extra };
  if (key !== undefined) base.templateKey = key;
  return base;
}

/** Two switchgear assets made from v1, plus an unrelated asset; a user-added task and a cross link. */
function sample(): Project {
  return {
    id: 'p1', name: 'Sample job', startDate: '2026-11-02', dataDate: '2026-11-02',
    calendar: { workWeekdays: [1, 2, 3, 4, 5], holidays: [] },
    assets: [
      { id: 'a', tag: 'SWGR-A', description: 'Switchgear A', templateId: 'tpl-swgr', templateVersion: 1 },
      { id: 'b', tag: 'SWGR-B', description: 'Switchgear B', templateId: 'tpl-swgr', templateVersion: 1 },
      { id: 'x', tag: 'XFMR-1', description: 'Transformer' },
    ],
    tasks: [
      t('a:vmi', 'a', '1.1', 'vmi', { startNoEarlierThan: '2026-11-09' }),
      t('a:ir', 'a', '1.2', 'ir', { durationDays: 2 }),
      t('a:extra', 'a', '1.3', undefined, { name: 'Owner walkdown', responsible: 'Owner' }),
      t('a:hipot', 'a', '1.4', 'hipot'),
      t('a:energize', 'a', '1.5', 'energize', { type: 'milestone', durationDays: 0 }),
      t('b:vmi', 'b', '2.1', 'vmi', { actualStart: '2026-11-03', actualFinish: '2026-11-03', percentComplete: 100 }),
      t('b:ir', 'b', '2.2', 'ir', { durationDays: 2, actualStart: '2026-11-04', percentComplete: 40, notes: 'Megger on site' }),
      t('b:hipot', 'b', '2.3', 'hipot', { percentComplete: 10 }),
      t('b:energize', 'b', '2.4', 'energize', { type: 'milestone', durationDays: 0 }),
      t('x:set', 'x', '3.1', undefined, { name: 'Set transformer' }),
    ],
    dependencies: [
      { predecessorId: 'a:vmi', successorId: 'a:ir', type: 'FS', lagDays: 0 },
      { predecessorId: 'a:ir', successorId: 'a:hipot', type: 'FS', lagDays: 0 },
      { predecessorId: 'a:hipot', successorId: 'a:energize', type: 'FS', lagDays: 0 },
      // User links: to a user-added task, and across assets.
      { predecessorId: 'a:ir', successorId: 'a:extra', type: 'SS', lagDays: 1 },
      { predecessorId: 'x:set', successorId: 'a:vmi', type: 'FS', lagDays: 0 },
      { predecessorId: 'a:energize', successorId: 'b:vmi', type: 'FS', lagDays: 2 },
      { predecessorId: 'b:vmi', successorId: 'b:ir', type: 'FS', lagDays: 0 },
      { predecessorId: 'b:ir', successorId: 'b:hipot', type: 'FS', lagDays: 0 },
      { predecessorId: 'b:hipot', successorId: 'b:energize', type: 'FS', lagDays: 0 },
    ],
  };
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

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

const byId = (p: Project, id: string) => p.tasks.find((x) => x.id === id)!;
const group = (p: Project, assetId: string) => p.tasks.filter((x) => x.assetId === assetId).map((x) => [x.id, x.code]);
const links = (p: Project) => p.dependencies.map((d) => `${d.predecessorId}>${d.successorId} ${d.type}${d.lagDays}`);

// ---------------------------------------------------------------------------------------

describe('planReapply', () => {
  it('plans additions, updates, removals and link changes for an unstarted asset', () => {
    const [plan] = planReapply(sample(), ['a'], v2());
    expect(plan!.assetId).toBe('a');
    expect(plan!.versionChanged).toBe(true);
    expect(plan!.added.map((x) => x.key)).toEqual(['torque', 'witness']);
    expect(plan!.updated).toEqual([
      {
        taskId: 'a:ir',
        changes: [
          { field: 'name', from: 'Step ir', to: 'Insulation resistance' },
          { field: 'durationDays', from: 2, to: 3 },
        ],
      },
    ]);
    expect(plan!.removed).toEqual([{ taskId: 'a:hipot', reason: 'No longer in Switchgear' }]);
    expect(plan!.conflicts).toEqual([]);
    expect(plan!.links.removed).toEqual([{ predecessorId: 'a:vmi', successorId: 'a:ir', type: 'FS', lagDays: 0 }]);
    expect(plan!.links.added).toEqual([
      { predecessorKey: 'vmi', successorKey: 'torque', type: 'FS', lagDays: 0 },
      { predecessorKey: 'torque', successorKey: 'ir', type: 'FS', lagDays: 0 },
      { predecessorKey: 'ir', successorKey: 'witness', type: 'FS', lagDays: 0 },
      { predecessorKey: 'witness', successorKey: 'energize', type: 'FS', lagDays: 0 },
    ]);
    expect(plan!.links.changed).toEqual([]);
  });

  it('keeps started tasks the template dropped as conflicts', () => {
    const [plan] = planReapply(sample(), ['b'], v2());
    expect(plan!.removed).toEqual([]);
    expect(plan!.conflicts).toEqual([
      { taskId: 'b:ir', message: 'Step ir has progress and its duration changes from 2 to 3 days; check its actuals' },
      { taskId: 'b:hipot', message: 'Step hipot is no longer in Switchgear but has progress, so it was kept' },
    ]);
  });

  it('warns when a task with progress changes type or duration', () => {
    const tpl: Template = { ...v1(), version: 2, tasks: [tt('vmi', 1), tt('ir', 0, ['vmi'], { type: 'milestone' }), tt('hipot', 1, ['ir']), tt('energize', 0, ['hipot'], { type: 'milestone' })] };
    const [plan] = planReapply(sample(), ['b'], tpl);
    expect(plan!.conflicts).toEqual([
      { taskId: 'b:ir', message: 'Step ir has progress and its type changes from task to milestone and its duration changes from 2 to 0 days; check its actuals' },
    ]);
    // Actuals are kept.
    const { project: p } = reapplyTemplate(sample(), ['b'], tpl);
    expect(byId(p, 'b:ir')).toMatchObject({ actualStart: '2026-11-04', percentComplete: 40, type: 'milestone', durationDays: 0 });
    // Name-only changes to a started task are not conflicts.
    expect(planReapply(sample(), ['b'], { ...v1(), version: 2 })[0]!.conflicts).toEqual([]);
  });

  it('treats links from tasks removed in another listed asset as gone when dating', () => {
    const p0 = sample();
    byId(p0, 'b:hipot').percentComplete = 0;
    p0.dependencies = p0.dependencies.filter((d) => !(d.predecessorId === 'a:vmi' && d.successorId === 'a:ir'));
    p0.dependencies.push({ predecessorId: 'b:hipot', successorId: 'a:ir', type: 'FS', lagDays: 0 });
    const tpl: Template = { ...v1(), version: 2, tasks: [tt('vmi', 1), tt('ir', 2), tt('energize', 0, ['ir'], { type: 'milestone' })] };
    const dated = { taskId: 'a:ir', changes: [{ field: 'startNoEarlierThan', from: undefined, to: '2026-11-09' }] };
    // Alone, b:hipot stays and still holds a:ir back.
    expect(planReapply(p0, ['a'], tpl)[0]!.updated).not.toContainEqual(dated);
    // Together, b:hipot is removed, so a:ir gets the asset date as it would within one asset.
    const [planA, planB] = planReapply(p0, ['a', 'b'], tpl);
    expect(planB!.removed.map((r) => r.taskId)).toContain('b:hipot');
    expect(planA!.updated).toContainEqual(dated);
    const { project: p } = reapplyTemplate(p0, ['a', 'b'], tpl);
    expect(byId(p, 'a:ir').startNoEarlierThan).toBe('2026-11-09');
  });

  it('reports a second task with the same key as a conflict and leaves it alone', () => {
    const p = sample();
    p.tasks.splice(2, 0, t('a:ir2', 'a', '1.3', 'ir', { name: 'Copy' }));
    const [plan] = planReapply(p, ['a'], v1());
    expect(plan!.conflicts.map((c) => c.taskId)).toEqual(['a:ir2']);
    expect(plan!.updated).toEqual([]);
  });

  it('notices changed link types and lags', () => {
    const tpl = v1();
    tpl.tasks[1]!.predecessors = [{ key: 'vmi', type: 'SS', lagDays: 1 }];
    const [plan] = planReapply(sample(), ['a'], tpl);
    expect(plan!.versionChanged).toBe(false);
    expect(plan!.links.changed).toEqual([{ predecessorId: 'a:vmi', successorId: 'a:ir', type: 'SS', lagDays: 1 }]);
    expect(plan!.added).toEqual([]);
  });

  it('refuses invalid templates and unknown assets', () => {
    const bad = v1();
    bad.tasks[0]!.predecessors = [{ key: 'nope', type: 'FS', lagDays: 0 }];
    expect(() => planReapply(sample(), ['a'], bad)).toThrow(TemplateInvalidError);
    expect(() => planReapply(sample(), ['zzz'], v1())).toThrow(UnknownAssetError);
  });
});

describe('reapplyTemplate', () => {
  it('rebuilds an unstarted asset and keeps user tasks and user links', () => {
    const { project: p } = reapplyTemplate(sample(), ['a'], v2());
    expect(p.tasks.filter((x) => x.assetId === 'a').map((x) => x.id)).toEqual([
      'a:vmi', 'a:torque', 'a:ir', 'a:witness', 'a:extra', 'a:energize',
    ]);
    const torque = byId(p, 'a:torque');
    expect(torque).toStrictEqual({
      id: 'a:torque', assetId: 'a', code: '', name: 'Step torque', type: 'task', durationDays: 1,
      percentComplete: 0, responsible: 'Test tech', templateKey: 'torque',
    });
    expect(byId(p, 'a:ir')).toMatchObject({ name: 'Insulation resistance', durationDays: 3 });
    expect(byId(p, 'a:extra')).toStrictEqual(sample().tasks[2]);
    expect(p.assets[0]).toMatchObject({ templateId: 'tpl-swgr', templateVersion: 2 });
    expect(links(p)).toEqual([
      'a:ir>a:extra SS1',
      'x:set>a:vmi FS0',
      'a:energize>b:vmi FS2',
      'b:vmi>b:ir FS0',
      'b:ir>b:hipot FS0',
      'b:hipot>b:energize FS0',
      'a:vmi>a:torque FS0',
      'a:torque>a:ir FS0',
      'a:ir>a:witness FS0',
      'a:witness>a:energize FS0',
    ]);
    // Asset b is untouched.
    expect(p.tasks.filter((x) => x.assetId === 'b')).toStrictEqual(sample().tasks.filter((x) => x.assetId === 'b'));
  });

  it('never loses progress on a started asset', () => {
    const { project: p } = reapplyTemplate(sample(), ['b'], v2());
    const before = sample();
    expect(byId(p, 'b:vmi')).toStrictEqual(byId(before, 'b:vmi'));
    expect(byId(p, 'b:ir')).toStrictEqual({ ...byId(before, 'b:ir'), name: 'Insulation resistance', durationDays: 3 });
    expect(byId(p, 'b:hipot')).toStrictEqual(byId(before, 'b:hipot'));
    // The kept task's links stay (it is no longer a template task).
    expect(links(p)).toContain('b:ir>b:hipot FS0');
    expect(links(p)).toContain('b:hipot>b:energize FS0');
    expect(links(p)).not.toContain('b:vmi>b:ir FS0');
    expect(links(p)).toContain('b:torque>b:ir FS0');
  });

  it('copies the asset start-no-earlier date onto new tasks nothing holds back', () => {
    const tpl = v2();
    tpl.tasks.push(tt('survey', 1));
    const { project: p } = reapplyTemplate(sample(), ['a'], tpl);
    expect(byId(p, 'a:survey').startNoEarlierThan).toBe('2026-11-09');
    expect(byId(p, 'a:torque').startNoEarlierThan).toBeUndefined();
  });

  it('keeps the asset date when the only task carrying it is removed', () => {
    const p0: Project = {
      ...sample(),
      assets: [{ id: 'a', tag: 'SWGR-A', description: 'Switchgear A', templateId: 'tpl-swgr', templateVersion: 1 }],
      tasks: [t('a:s1', 'a', '1.1', 's1', { startNoEarlierThan: '2026-12-01' }), t('a:s2', 'a', '1.2', 's2')],
      dependencies: [{ predecessorId: 'a:s1', successorId: 'a:s2', type: 'FS', lagDays: 0 }],
    };
    const tpl: Template = { ...v1(), version: 2, tasks: [tt('s0', 1), tt('s2', 1, ['s0'])] };
    const { project: p, plans } = reapplyTemplate(p0, ['a'], tpl);
    expect(plans[0]!.removed.map((r) => r.taskId)).toEqual(['a:s1']);
    expect(byId(p, 'a:s0').startNoEarlierThan).toBe('2026-12-01');
    expect(byId(p, 'a:s2').startNoEarlierThan).toBeUndefined();
  });

  it('gives the asset date to a matched task that no longer has a predecessor', () => {
    // v1 without vmi: ir becomes the first task and nothing holds it back.
    const tpl: Template = { ...v1(), version: 2, tasks: [tt('ir', 2), tt('hipot', 1, ['ir']), tt('energize', 0, ['hipot'], { type: 'milestone' })] };
    const [plan] = planReapply(sample(), ['a'], tpl);
    expect(plan!.updated).toEqual([{ taskId: 'a:ir', changes: [{ field: 'startNoEarlierThan', from: undefined, to: '2026-11-09' }] }]);
    const { project: p } = reapplyTemplate(sample(), ['a'], tpl);
    expect(byId(p, 'a:ir').startNoEarlierThan).toBe('2026-11-09');
    // A task held back by a user link that stays is left alone, and so is a root without a date.
    const p0 = sample();
    p0.dependencies.push({ predecessorId: 'x:set', successorId: 'a:ir', type: 'FS', lagDays: 0 });
    expect(planReapply(p0, ['a'], tpl)[0]!.updated).toEqual([]);
    const p1 = sample();
    delete p1.tasks[0]!.startNoEarlierThan;
    p1.tasks[1]!.startNoEarlierThan = '2026-11-16';
    const keep = planReapply(p1, ['a'], v1());
    expect(keep[0]!.updated).toEqual([]);
  });

  it('flags an asset made from another template', () => {
    const other: Template = { ...v1(), id: 'tpl-other', name: 'Other' };
    expect(planReapply(sample(), ['a'], other)[0]!.templateMismatch).toBe(true);
    expect(planReapply(sample(), ['a'], v2())[0]!.templateMismatch).toBe(false);
    expect(planReapply(sample(), ['x'], v1())[0]!.templateMismatch).toBe(false);
  });

  it('adds a first template task before the asset tasks and makes ids unique', () => {
    const p0 = sample();
    p0.tasks.push(t('a:pre', 'x', '3.2', undefined));
    const tpl = v1();
    tpl.tasks.unshift(tt('pre', 1));
    tpl.tasks[1]!.predecessors = [{ key: 'pre', type: 'FS', lagDays: 0 }];
    const { project: p } = reapplyTemplate(p0, ['a'], tpl);
    expect(p.tasks.filter((x) => x.assetId === 'a')[0]!.id).toBe('a:pre-2');
    expect(p.tasks[0]!.id).toBe('a:pre-2');
  });

  it('places tasks for an asset that has none after the earlier assets', () => {
    const p0 = sample();
    p0.tasks = p0.tasks.filter((x) => x.assetId !== 'b');
    p0.dependencies = p0.dependencies.filter((d) => !d.predecessorId.startsWith('b:') && !d.successorId.startsWith('b:'));
    const { project: p } = reapplyTemplate(p0, ['b'], v1());
    expect(p.tasks.map((x) => x.assetId)).toEqual(['a', 'a', 'a', 'a', 'a', 'b', 'b', 'b', 'b', 'x']);
  });
});

describe('reapplyTemplate command', () => {
  it('re-applies to several assets, renumbers and undoes exactly', () => {
    const r = roundTrip(sample(), { kind: 'reapplyTemplate', assetIds: ['a', 'b'], template: v2() });
    expect(r.inverse.kind).toBe('restoreAssets');
    expect(group(r.project, 'a')).toEqual([
      ['a:vmi', '1.1'], ['a:torque', '1.2'], ['a:ir', '1.3'], ['a:witness', '1.4'], ['a:extra', '1.5'], ['a:energize', '1.6'],
    ]);
    expect(group(r.project, 'b')).toEqual([
      ['b:vmi', '2.1'], ['b:torque', '2.2'], ['b:ir', '2.3'], ['b:witness', '2.4'], ['b:hipot', '2.5'], ['b:energize', '2.6'],
    ]);
    expect(group(r.project, 'x')).toEqual([['x:set', '3.1']]);
    expect(r.summary).toBe('Re-applied Switchgear v2 to SWGR-A, SWGR-B: 4 tasks added, 2 tasks updated, 1 task removed, 2 tasks kept with conflicts');
    expect((r.inverse as { summary?: string }).summary).toBe(`Undo: ${r.summary}`);
  });

  it('undoes exactly when the asset is linked from other assets and a linked task is removed', () => {
    const p = sample();
    p.dependencies.push({ predecessorId: 'a:hipot', successorId: 'x:set', type: 'FF', lagDays: 0 });
    p.dependencies = p.dependencies.filter((d) => !(d.predecessorId === 'x:set' && d.successorId === 'a:vmi'));
    const r = roundTrip(p, { kind: 'reapplyTemplate', assetIds: ['a'], template: v2() });
    expect(links(r.project)).not.toContain('a:hipot>x:set FF0');
  });

  it('refuses another template unless allowed, and undoes when allowed', () => {
    const other: Template = { ...v2(), id: 'tpl-other', name: 'Other' };
    expectError(sample(), { kind: 'reapplyTemplate', assetIds: ['a'], template: other }, 'other-template');
    const r = roundTrip(sample(), { kind: 'reapplyTemplate', assetIds: ['a'], template: other, allowOtherTemplate: true });
    expect(r.project.assets[0]!.templateId).toBe('tpl-other');
    expectError(sample(), { kind: 'reapplyTemplate', assetIds: ['a'], template: other, allowOtherTemplate: false as unknown as true }, 'invalid-field');
  });

  it('undoes exactly when the removed first task carried the asset date', () => {
    const tpl: Template = { ...v2(), version: 3, tasks: v2().tasks.slice(1).map((x) => ({ ...x, predecessors: x.key === 'torque' ? [] : x.predecessors })) };
    const r = roundTrip(sample(), { kind: 'reapplyTemplate', assetIds: ['a'], template: tpl });
    expect(byId(r.project, 'a:torque').startNoEarlierThan).toBe('2026-11-09');
  });

  it('refuses a template of the wrong shape', () => {
    const cmd = (template: unknown): Command => ({ kind: 'reapplyTemplate', assetIds: ['a'], template: template as Template });
    const withTask = (patch: Record<string, unknown>) => {
      const tpl = v2();
      Object.assign(tpl.tasks[1]!, patch);
      return tpl;
    };
    for (const bad of [
      null,
      'x',
      { ...v2(), tasks: 'nope' },
      { ...v2(), name: 3 },
      withTask({ name: 5 }),
      withTask({ trade: null }),
      withTask({ type: 'party' }),
      withTask({ durationDays: '1' }),
      withTask({ checklist: [{ id: 1, text: 'x' }] }),
      withTask({ requiredCerts: undefined }),
      withTask({ predecessors: [{ key: 'vmi', type: 'XX', lagDays: 0 }] }),
      withTask({ predecessors: [{ key: 'vmi', type: 'FS', lagDays: '0' }] }),
    ]) {
      expectError(sample(), cmd(bad), 'invalid-template');
      expectError(sample(), { kind: 'addAssetsFromTemplate', template: bad as Template, assets: [{ tag: 'N', description: 'N' }] }, 'invalid-template');
    }
  });

  it('marks undo-only commands as internal', () => {
    const r = applyCommand(sample(), { kind: 'reapplyTemplate', assetIds: ['a'], template: v2() });
    expect(isInternalCommand(r.inverse)).toBe(true);
    expect(isInternalCommand({ kind: 'batch', commands: [{ kind: 'setDataDate', date: '2026-11-09' }, r.inverse] })).toBe(true);
    expect(isInternalCommand({ kind: 'updateTask', id: 'a:ir', patch: {}, restore: true })).toBe(true);
    expect(isInternalCommand({ kind: 'reapplyTemplate', assetIds: ['a'], template: v2() })).toBe(false);
    expect(isInternalCommand({ kind: 'updateTask', id: 'a:ir', patch: {} })).toBe(false);
    expect(isInternalCommand(null)).toBe(false);
  });

  it('refuses a re-apply that changes nothing', () => {
    const done = applyCommand(sample(), { kind: 'reapplyTemplate', assetIds: ['a'], template: v2() }).project;
    expectError(done, { kind: 'reapplyTemplate', assetIds: ['a'], template: v2() }, 'no-change');
  });

  it('refuses a template whose links would make a loop with user links', () => {
    const p = sample();
    // User link: energize → extra → vmi. The template then adds vmi → ... → energize.
    p.dependencies = p.dependencies.filter((d) => d.successorId !== 'a:extra');
    p.dependencies.push({ predecessorId: 'a:energize', successorId: 'a:extra', type: 'FS', lagDays: 0 });
    p.dependencies.push({ predecessorId: 'a:extra', successorId: 'a:vmi', type: 'FS', lagDays: 0 });
    p.dependencies = p.dependencies.filter((d) => !(d.predecessorId === 'a:hipot' && d.successorId === 'a:energize'));
    p.dependencies = p.dependencies.filter((d) => !(d.predecessorId === 'a:ir' && d.successorId === 'a:hipot'));
    p.dependencies = p.dependencies.filter((d) => !(d.predecessorId === 'a:vmi' && d.successorId === 'a:ir'));
    expectError(p, { kind: 'reapplyTemplate', assetIds: ['a'], template: v1() }, 'cycle');
  });

  it('refuses bad input', () => {
    const bad = v1();
    bad.tasks[0]!.durationDays = -1;
    expectError(sample(), { kind: 'reapplyTemplate', assetIds: ['a'], template: bad }, 'invalid-template');
    expectError(sample(), { kind: 'reapplyTemplate', assetIds: ['nope'], template: v1() }, 'unknown-asset');
    expectError(sample(), { kind: 'reapplyTemplate', assetIds: [], template: v1() }, 'empty-batch');
    expectError(sample(), { kind: 'reapplyTemplate', assetIds: ['a', 'a'], template: v2() }, 'invalid-field');
    expectError(sample(), { kind: 'reapplyTemplate', assetIds: [3] as unknown as string[], template: v2() }, 'invalid-field');
  });
});

describe('restoreAssets', () => {
  it('refuses snapshots that do not fit the project', () => {
    const p = sample();
    const asset = p.assets[0]!;
    expectError(p, { kind: 'restoreAssets', assets: [], tasks: [], dependencies: [] }, 'invalid-field');
    expectError(p, { kind: 'restoreAssets', assets: [{ ...asset, id: 'zzz' }], tasks: [], dependencies: [] }, 'unknown-asset');
    expectError(
      p,
      { kind: 'restoreAssets', assets: [asset], tasks: [{ item: t('x:set', 'a', '1.1', undefined), index: 0 }], dependencies: [] },
      'duplicate-id',
    );
    expectError(
      p,
      { kind: 'restoreAssets', assets: [asset], tasks: [{ item: t('n', 'b', '1.1', undefined), index: 0 }], dependencies: [] },
      'unknown-asset',
    );
    expectError(
      p,
      {
        kind: 'restoreAssets', assets: [asset], tasks: [],
        dependencies: [{ item: { predecessorId: 'a:vmi', successorId: 'x:set', type: 'FS', lagDays: 0 }, index: 0 }],
      },
      'unknown-task',
    );
  });

  it('empties an asset when the snapshot has no tasks, and undoes', () => {
    const p = sample();
    const r = roundTrip(p, { kind: 'restoreAssets', assets: [p.assets[0]!], tasks: [], dependencies: [] });
    expect(r.project.tasks.some((x) => x.assetId === 'a')).toBe(false);
    expect(r.summary).toBe('Restored 1 asset');
  });
});
