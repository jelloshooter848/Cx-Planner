import { describe, expect, it } from 'vitest';
import {
  addTemplateTask,
  blankTemplate,
  formatTemplatePredecessors,
  moveItem,
  moveTemplateTask,
  newChecklistItemId,
  newTemplateTaskKey,
  parseTemplatePredecessors,
  previewTemplate,
  removeTemplateTask,
  templateSpanDays,
  updateTemplateTask,
  type Template,
  type TemplateTask,
} from '../src/index.js';

function tt(key: string, durationDays: number, preds: string[] = [], extra: Partial<TemplateTask> = {}): TemplateTask {
  return {
    key,
    name: `Task ${key}`,
    durationDays,
    type: 'task',
    trade: 'Electrical',
    predecessors: preds.map((p) => ({ key: p, type: 'FS', lagDays: 0 })),
    checklist: [],
    requiredCerts: [],
    ...extra,
  };
}

function lv(): Template {
  return {
    id: 'tpl',
    name: 'LV switchgear',
    version: 2,
    kind: 'starter',
    assetDescription: '',
    stages: [],
    requiredDocs: [],
    tasks: [
      tt('vmi', 2),
      tt('torque', 2, ['vmi']),
      tt('ir', 2, ['torque']),
      tt('relay', 4, ['ir']),
      tt('func', 2, ['relay'], { type: 'hold' }),
      tt('energize', 0, ['func'], { type: 'milestone' }),
    ],
  };
}

describe('moveItem', () => {
  it('moves and clamps without changing the input', () => {
    const a = [1, 2, 3, 4];
    expect(moveItem(a, 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveItem(a, 3, -5)).toEqual([4, 1, 2, 3]);
    expect(moveItem(a, 1, 99)).toEqual([1, 3, 4, 2]);
    expect(moveItem(a, 9, 0)).toEqual(a);
    expect(a).toEqual([1, 2, 3, 4]);
  });
});

describe('keys and ids', () => {
  it('finds unused task keys and checklist ids', () => {
    const seq = (...xs: string[]) => () => xs.shift() ?? 'zz';
    expect(newTemplateTaskKey({ tasks: [tt('task-a', 1)] }, seq('a', 'b'))).toBe('task-b');
    expect(newChecklistItemId([{ id: 'x-a', text: '' }], 'x', seq('a', 'a', 'c'))).toBe('x-c');
    expect(newTemplateTaskKey({ tasks: [] })).toMatch(/^task-[0-9a-f]{8}$/);
    expect(newChecklistItemId([], 'x')).toMatch(/^x-[0-9a-f]{8}$/);
  });

  it('never hands a removed task key or checklist id out again', () => {
    const base: Template = { ...blankTemplate('b', 'B'), tasks: [tt('task-1', 1), tt('task-2', 1, ['task-1']), tt('task-3', 1, ['task-2'])] };
    const removed = removeTemplateTask(base, 'task-3');
    const { key } = addTemplateTask(removed);
    expect(key).not.toBe('task-3');
    expect(base.tasks.map((t) => t.key)).not.toContain(key);
    const items = [
      { id: 'k-1', text: 'a' },
      { id: 'k-2', text: 'b' },
    ];
    expect(newChecklistItemId(items.slice(0, 1), 'k')).not.toBe('k-2');
  });

  it('makes a blank custom template', () => {
    expect(blankTemplate('t1', 'Feeder')).toEqual({
      id: 't1',
      name: 'Feeder',
      version: 1,
      kind: 'custom',
      assetDescription: '',
      stages: [],
      tasks: [],
      requiredDocs: [],
    });
  });
});

describe('addTemplateTask', () => {
  it('appends a task that follows the last one', () => {
    const t = lv();
    const { template, key } = addTemplateTask(t);
    expect(template.tasks).toHaveLength(7);
    const added = template.tasks[6]!;
    expect(added.key).toBe(key);
    expect(added.predecessors).toEqual([{ key: 'energize', type: 'FS', lagDays: 0 }]);
    expect(added.durationDays).toBe(1);
    expect(t.tasks).toHaveLength(6);
  });

  it('inserts after a row and takes given fields', () => {
    const { template } = addTemplateTask(lv(), { name: 'Megger', type: 'milestone', predecessors: [] }, 0);
    expect(template.tasks[1]).toMatchObject({ name: 'Megger', type: 'milestone', durationDays: 0, predecessors: [] });
  });

  it('adds the first task of a blank template with no predecessor', () => {
    const { template } = addTemplateTask(blankTemplate('b', 'B'));
    expect(template.tasks[0]!.predecessors).toEqual([]);
  });
});

describe('removeTemplateTask', () => {
  it('bridges the links across the removed task', () => {
    const t = removeTemplateTask(lv(), 'ir');
    expect(t.tasks.map((x) => x.key)).toEqual(['vmi', 'torque', 'relay', 'func', 'energize']);
    expect(t.tasks[2]!.predecessors).toEqual([{ key: 'torque', type: 'FS', lagDays: 0 }]);
    expect(templateSpanDays(t)).toBe(10);
  });

  it('does not add a link the task already has or a self link', () => {
    const base = lv();
    base.tasks[3] = {
      ...base.tasks[3]!,
      predecessors: [
        { key: 'ir', type: 'FS', lagDays: 0 },
        { key: 'torque', type: 'SS', lagDays: 1 },
      ],
    };
    const t = removeTemplateTask(base, 'ir');
    expect(t.tasks.find((x) => x.key === 'relay')!.predecessors).toEqual([{ key: 'torque', type: 'SS', lagDays: 1 }]);
  });

  it('ignores an unknown key', () => {
    const t = lv();
    expect(removeTemplateTask(t, 'nope')).toBe(t);
  });
});

describe('moveTemplateTask and updateTemplateTask', () => {
  it('reorders rows keeping links', () => {
    const t = moveTemplateTask(lv(), 'energize', 0);
    expect(t.tasks[0]!.key).toBe('energize');
    expect(t.tasks[0]!.predecessors[0]!.key).toBe('func');
  });

  it('sets milestone duration to 0 and clears optional fields', () => {
    let t = updateTemplateTask(lv(), 'relay', { type: 'milestone' });
    expect(t.tasks[3]).toMatchObject({ type: 'milestone', durationDays: 0 });
    t = updateTemplateTask(t, 'func', { noticeLeadDays: 3, testForm: 'Functional' });
    expect(t.tasks[4]).toMatchObject({ noticeLeadDays: 3, testForm: 'Functional' });
    t = updateTemplateTask(t, 'func', { noticeLeadDays: undefined, testForm: ' ' });
    expect('noticeLeadDays' in t.tasks[4]!).toBe(false);
    expect('testForm' in t.tasks[4]!).toBe(false);
  });
});

describe('predecessor text', () => {
  it('formats row numbers with type and lag', () => {
    const t = lv();
    t.tasks[3] = {
      ...t.tasks[3]!,
      predecessors: [
        { key: 'vmi', type: 'FS', lagDays: 0 },
        { key: 'ir', type: 'SS', lagDays: 1 },
        { key: 'torque', type: 'FF', lagDays: -2 },
        { key: 'gone', type: 'FS', lagDays: 0 },
      ],
    };
    expect(formatTemplatePredecessors(t, t.tasks[3]!)).toBe('1, 3SS+1, 2FF-2');
    expect(formatTemplatePredecessors(t, t.tasks[0]!)).toBe('');
  });

  it('parses row numbers', () => {
    const t = lv();
    expect(parseTemplatePredecessors(t, 'relay', '1, 3ss+1; 2 FF -2')).toEqual({
      ok: true,
      predecessors: [
        { key: 'vmi', type: 'FS', lagDays: 0 },
        { key: 'ir', type: 'SS', lagDays: 1 },
        { key: 'torque', type: 'FF', lagDays: -2 },
      ],
    });
    expect(parseTemplatePredecessors(t, 'relay', '  ')).toEqual({ ok: true, predecessors: [] });
  });

  it('refuses bad input', () => {
    const t = lv();
    expect(parseTemplatePredecessors(t, 'relay', 'abc')).toMatchObject({ ok: false });
    expect(parseTemplatePredecessors(t, 'relay', '9')).toEqual({ ok: false, message: 'There is no task 9' });
    expect(parseTemplatePredecessors(t, 'relay', '4')).toEqual({ ok: false, message: 'A task cannot follow itself' });
    expect(parseTemplatePredecessors(t, 'relay', '1, 1SS')).toEqual({ ok: false, message: 'Task 1 is listed twice' });
  });
});

describe('previewTemplate', () => {
  it('lays the template out in working days', () => {
    const p = previewTemplate(lv());
    if (!p.ok) throw new Error('expected a preview');
    expect(p.spanDays).toBe(12);
    expect(p.rows.map((r) => [r.key, r.start, r.finish])).toEqual([
      ['vmi', 0, 2],
      ['torque', 2, 4],
      ['ir', 4, 6],
      ['relay', 6, 10],
      ['func', 10, 12],
      ['energize', 12, 12],
    ]);
    expect(p.rows.every((r) => r.critical)).toBe(true);
  });

  it('follows edits', () => {
    const p = previewTemplate(updateTemplateTask(lv(), 'relay', { durationDays: 6 }));
    expect(p.ok && p.spanDays).toBe(14);
  });

  it('reports problems instead of throwing', () => {
    const t = updateTemplateTask(lv(), 'vmi', { predecessors: [{ key: 'energize', type: 'FS', lagDays: 0 }] });
    const p = previewTemplate(t);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.problems.map((x) => x.code)).toContain('cycle');
  });

  it('handles an empty template and a lead on the first task', () => {
    expect(previewTemplate(blankTemplate('b', 'B'))).toEqual({ ok: true, rows: [], spanDays: 0 });
    const t: Template = {
      ...blankTemplate('b', 'B'),
      tasks: [tt('a', 3), tt('b', 2, [], { predecessors: [{ key: 'a', type: 'FF', lagDays: 0 }] })],
    };
    const p = previewTemplate(t);
    expect(p.ok && p.rows.map((r) => [r.start, r.finish])).toEqual([
      [0, 3],
      [1, 3],
    ]);
  });
});
