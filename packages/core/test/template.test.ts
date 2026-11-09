import { describe, expect, it } from 'vitest';
import {
  computeSchedule,
  instantiateTemplate,
  templateSpanDays,
  TemplateInvalidError,
  validateTemplate,
  type Project,
  type Template,
  type TemplateTask,
} from '../src/index.js';

function tt(key: string, durationDays: number, preds: string[] = [], extra: Partial<TemplateTask> = {}): TemplateTask {
  return {
    key, name: `Task ${key}`, durationDays, type: 'task', trade: 'Electrical',
    predecessors: preds.map((p) => ({ key: p, type: 'FS', lagDays: 0 })),
    checklist: [], requiredCerts: [], ...extra,
  };
}

/** Shaped like the low-voltage switchgear starter in the template editor mockup. */
function lvSwitchgear(): Template {
  return {
    id: 'tpl-lv-swgr', name: 'Low-voltage switchgear', version: 3, kind: 'starter',
    assetDescription: 'Low-voltage switchgear lineup',
    stages: ['Delivered', 'Set', 'Terminated', 'Tested', 'Energized', 'Turned over'],
    requiredDocs: ['Test report', 'Relay settings printout'],
    tasks: [
      tt('vmi', 2, [], { name: 'Visual & mechanical inspection', checklist: [{ id: 'c1', text: 'Nameplate matches drawings' }] }),
      tt('torque', 2, ['vmi'], { name: 'Torque verification' }),
      tt('ir', 2, ['torque'], { name: 'Insulation resistance test', trade: 'Test tech', testForm: 'Insulation resistance', requiredCerts: ['NETA Level II'] }),
      tt('relay', 4, ['ir'], { name: 'Relay settings & calibration', trade: 'Relay tech' }),
      tt('func', 2, ['relay'], { name: 'Functional test', type: 'hold', trade: 'Cx agent', noticeLeadDays: 3 }),
      tt('energize', 0, ['func'], { name: 'Energization', type: 'milestone', trade: 'Foreman' }),
    ],
  };
}

const asset = { id: 'A1', tag: 'SWGR-1A', description: 'Main switchgear', location: 'Elec Rm 101' };

function idMaker(prefix: string) {
  return (key: string) => `${prefix}:${key}`;
}

function projectFrom(parts: { asset: Project['assets'][number]; tasks: Project['tasks']; dependencies: Project['dependencies'] }[]): Project {
  return {
    id: 'p', name: 'p', startDate: '2026-11-02', dataDate: '2026-11-02',
    calendar: { workWeekdays: [1, 2, 3, 4, 5], holidays: [] },
    assets: parts.map((p) => p.asset),
    tasks: parts.flatMap((p) => p.tasks),
    dependencies: parts.flatMap((p) => p.dependencies),
  };
}

describe('validateTemplate', () => {
  it('accepts a sound template', () => {
    expect(validateTemplate(lvSwitchgear())).toEqual([]);
  });

  it('accepts an empty template', () => {
    expect(validateTemplate({ ...lvSwitchgear(), tasks: [] })).toEqual([]);
  });

  it('reports duplicate and empty keys', () => {
    const t = { ...lvSwitchgear(), tasks: [tt('a', 1), tt('a', 2), tt('', 1)] };
    const codes = validateTemplate(t).map((p) => p.code);
    expect(codes).toContain('duplicate-key');
    expect(codes).toContain('empty-key');
  });

  it('reports unknown, self and duplicate predecessors', () => {
    const t = {
      ...lvSwitchgear(),
      tasks: [tt('a', 1, ['nope']), tt('b', 1, ['b']), tt('c', 1, ['a', 'a'])],
    };
    const problems = validateTemplate(t);
    expect(problems).toContainEqual(expect.objectContaining({ code: 'unknown-predecessor', taskKey: 'a' }));
    expect(problems).toContainEqual(expect.objectContaining({ code: 'self-predecessor', taskKey: 'b' }));
    expect(problems).toContainEqual(expect.objectContaining({ code: 'duplicate-predecessor', taskKey: 'c' }));
    expect(problems.some((p) => p.code === 'cycle')).toBe(false);
  });

  it('reports cycles and names the tasks in them', () => {
    const t = { ...lvSwitchgear(), tasks: [tt('start', 1), tt('a', 1, ['start', 'c']), tt('b', 1, ['a']), tt('c', 1, ['b'])] };
    const cycle = validateTemplate(t).filter((p) => p.code === 'cycle');
    expect(cycle).toHaveLength(1);
    expect(cycle[0]!.message).toContain('a, b, c');
    expect(cycle[0]!.message).not.toContain('start');
  });

  it('reports negative, fractional and milestone durations', () => {
    const t = {
      ...lvSwitchgear(),
      tasks: [tt('neg', -1), tt('frac', 1.5), tt('ms', 2, [], { type: 'milestone' }), tt('ok', 0, [], { type: 'milestone' })],
    };
    const problems = validateTemplate(t);
    expect(problems).toContainEqual(expect.objectContaining({ code: 'negative-duration', taskKey: 'neg' }));
    expect(problems).toContainEqual(expect.objectContaining({ code: 'invalid-duration', taskKey: 'frac' }));
    expect(problems).toContainEqual(expect.objectContaining({ code: 'milestone-duration', taskKey: 'ms' }));
    expect(problems.some((p) => p.taskKey === 'ok')).toBe(false);
  });

  it('reports bad lags, notice lead times, checklist ids and versions', () => {
    const bad = tt('b', 1, [], {
      predecessors: [{ key: 'a', type: 'SS', lagDays: 0.5 }],
      noticeLeadDays: -2,
      checklist: [{ id: 'x', text: 'one' }, { id: 'x', text: 'two' }],
    });
    const t = { ...lvSwitchgear(), version: 0, tasks: [tt('a', 1), bad] };
    const codes = validateTemplate(t).map((p) => p.code).sort();
    expect(codes).toEqual(['duplicate-checklist-id', 'invalid-lag', 'invalid-version', 'negative-notice']);
  });

  it('allows negative lag (lead)', () => {
    const t = { ...lvSwitchgear(), tasks: [tt('a', 3), tt('b', 2, [], { predecessors: [{ key: 'a', type: 'FS', lagDays: -1 }] })] };
    expect(validateTemplate(t)).toEqual([]);
  });
});

describe('instantiateTemplate', () => {
  it('creates the asset with template id and version', () => {
    const r = instantiateTemplate(lvSwitchgear(), { asset, groupNumber: 4 }, idMaker('A1'));
    expect(r.asset).toEqual({ ...asset, templateId: 'tpl-lv-swgr', templateVersion: 3 });
  });

  it('creates one task per template task with codes, trade and key', () => {
    const r = instantiateTemplate(lvSwitchgear(), { asset, groupNumber: 4 }, idMaker('A1'));
    expect(r.tasks.map((t) => t.code)).toEqual(['4.1', '4.2', '4.3', '4.4', '4.5', '4.6']);
    expect(r.tasks[2]).toEqual({
      id: 'A1:ir', assetId: 'A1', code: '4.3', name: 'Insulation resistance test', type: 'task',
      durationDays: 2, percentComplete: 0, responsible: 'Test tech', templateKey: 'ir',
    });
    expect(r.tasks[4]).toMatchObject({ type: 'hold', responsible: 'Cx agent' });
    expect(r.tasks[5]).toMatchObject({ type: 'milestone', durationDays: 0 });
  });

  it('calls makeId once per key and uses the ids in links', () => {
    const calls: string[] = [];
    let n = 0;
    const r = instantiateTemplate(lvSwitchgear(), { asset, groupNumber: 1 }, (key) => {
      calls.push(key);
      return `id${++n}`;
    });
    expect(calls).toEqual(['vmi', 'torque', 'ir', 'relay', 'func', 'energize']);
    expect(r.tasks.map((t) => t.id)).toEqual(['id1', 'id2', 'id3', 'id4', 'id5', 'id6']);
    expect(r.dependencies).toEqual([
      { predecessorId: 'id1', successorId: 'id2', type: 'FS', lagDays: 0 },
      { predecessorId: 'id2', successorId: 'id3', type: 'FS', lagDays: 0 },
      { predecessorId: 'id3', successorId: 'id4', type: 'FS', lagDays: 0 },
      { predecessorId: 'id4', successorId: 'id5', type: 'FS', lagDays: 0 },
      { predecessorId: 'id5', successorId: 'id6', type: 'FS', lagDays: 0 },
    ]);
  });

  it('keeps link types and lag', () => {
    const t: Template = {
      ...lvSwitchgear(),
      tasks: [tt('a', 5), tt('b', 2, [], { predecessors: [{ key: 'a', type: 'SS', lagDays: 2 }] }), tt('c', 1, [], { predecessors: [{ key: 'a', type: 'FF', lagDays: -1 }] })],
    };
    const r = instantiateTemplate(t, { asset, groupNumber: 1 }, idMaker('x'));
    expect(r.dependencies).toEqual([
      { predecessorId: 'x:a', successorId: 'x:b', type: 'SS', lagDays: 2 },
      { predecessorId: 'x:a', successorId: 'x:c', type: 'FF', lagDays: -1 },
    ]);
  });

  it('puts start-no-earlier-than only on tasks without predecessors', () => {
    const t: Template = { ...lvSwitchgear(), tasks: [tt('a', 2), tt('b', 1), tt('c', 3, ['a', 'b'])] };
    const r = instantiateTemplate(t, { asset, groupNumber: 2, startNoEarlierThan: '2026-11-11' }, idMaker('x'));
    expect(r.tasks.map((x) => x.startNoEarlierThan)).toEqual(['2026-11-11', '2026-11-11', undefined]);
    expect('startNoEarlierThan' in r.tasks[2]!).toBe(false);
  });

  it('omits start-no-earlier-than when none is given', () => {
    const r = instantiateTemplate(lvSwitchgear(), { asset, groupNumber: 1 }, idMaker('x'));
    expect(r.tasks.every((x) => !('startNoEarlierThan' in x))).toBe(true);
  });

  it('does not share arrays or objects with the template', () => {
    const tpl = lvSwitchgear();
    const r = instantiateTemplate(tpl, { asset, groupNumber: 1 }, idMaker('x'));
    r.tasks[0]!.name = 'changed';
    expect(tpl.tasks[0]!.name).toBe('Visual & mechanical inspection');
  });

  it('refuses an invalid template', () => {
    const t = { ...lvSwitchgear(), tasks: [tt('a', 1, ['b']), tt('b', 1, ['a'])] };
    expect(() => instantiateTemplate(t, { asset, groupNumber: 1 }, idMaker('x'))).toThrow(TemplateInvalidError);
    try {
      instantiateTemplate(t, { asset, groupNumber: 1 }, idMaker('x'));
    } catch (e) {
      expect((e as TemplateInvalidError).problems.map((p) => p.code)).toEqual(['cycle']);
    }
  });

  it('schedules to the template durations', () => {
    const tpl = lvSwitchgear();
    const r = instantiateTemplate(tpl, { asset, groupNumber: 1, startNoEarlierThan: '2026-11-04' }, idMaker('A1'));
    const s = computeSchedule(projectFrom([r]));
    const byKey = (k: string) => s.tasks.get(`A1:${k}`)!;
    for (const t of tpl.tasks) expect(byKey(t.key).ef - byKey(t.key).es).toBe(t.durationDays);
    expect(byKey('vmi')).toMatchObject({ start: '2026-11-04', finish: '2026-11-05' });
    expect(byKey('torque')).toMatchObject({ start: '2026-11-06', finish: '2026-11-09' });
    expect(byKey('relay')).toMatchObject({ start: '2026-11-12', finish: '2026-11-17' });
    expect(byKey('energize')).toMatchObject({ start: '2026-11-20', finish: '2026-11-20' });
    expect(s.projectFinishIndex - byKey('vmi').es).toBe(12);
    expect(s.tasks.size).toBe(6);
  });

  it('instantiates several assets side by side without id clashes', () => {
    const tpl = lvSwitchgear();
    const a = instantiateTemplate(tpl, { asset, groupNumber: 1 }, idMaker('A1'));
    const b = instantiateTemplate(tpl, { asset: { ...asset, id: 'A2', tag: 'SWGR-1B' }, groupNumber: 2, startNoEarlierThan: '2026-11-09' }, idMaker('A2'));
    const s = computeSchedule(projectFrom([a, b]));
    expect(b.tasks.every((t) => t.assetId === 'A2' && t.code.startsWith('2.'))).toBe(true);
    expect(s.tasks.get('A1:vmi')!.start).toBe('2026-11-02');
    expect(s.tasks.get('A2:vmi')!.start).toBe('2026-11-09');
  });
});

describe('templateSpanDays', () => {
  it('is the working-day span of the template laid out alone', () => {
    expect(templateSpanDays(lvSwitchgear())).toBe(12);
  });

  it('counts parallel paths once and honours lag', () => {
    const t: Template = {
      ...lvSwitchgear(),
      tasks: [tt('a', 3), tt('b', 5), tt('c', 2, [], { predecessors: [{ key: 'a', type: 'FS', lagDays: 1 }, { key: 'b', type: 'FS', lagDays: 0 }] })],
    };
    expect(templateSpanDays(t)).toBe(7);
  });

  it('is zero for an empty template', () => {
    expect(templateSpanDays({ ...lvSwitchgear(), tasks: [] })).toBe(0);
  });
});
