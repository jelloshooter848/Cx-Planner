import { describe, expect, it } from 'vitest';
import type { Template } from '@cx/core';
import { STARTER_TEMPLATES } from '@cx/templates';
import {
  assetsUsing,
  cleanTemplate,
  countWord,
  editDraft,
  freshDraft,
  libraryStatus,
  sameTemplate,
  stepDraft,
  templateProblems,
  uniqueName,
} from '../src/renderer/views/Templates/editor-model.js';

const starter = () => structuredClone(STARTER_TEMPLATES[0]!) as Template;

describe('template editor model', () => {
  it('compares templates by content', () => {
    const a = starter();
    expect(sameTemplate(a, starter())).toBe(true);
    expect(sameTemplate(a, { ...a, name: 'Other' })).toBe(false);
  });

  it('trims text and drops empty list entries before saving', () => {
    const t = starter();
    t.name = '  LV  ';
    t.stages = ['Set', '  ', ' Tested '];
    t.requiredDocs = [''];
    t.tasks[0] = {
      ...t.tasks[0]!,
      name: ' VMI ',
      requiredCerts: ['', 'NETA'],
      checklist: [
        { id: 'a', text: ' ok ' },
        { id: 'b', text: ' ' },
      ],
    };
    const c = cleanTemplate(t);
    expect(c.name).toBe('LV');
    expect(c.stages).toEqual(['Set', 'Tested']);
    expect(c.requiredDocs).toEqual([]);
    expect(c.tasks[0]).toMatchObject({ name: 'VMI', requiredCerts: ['NETA'], checklist: [{ id: 'a', text: 'ok' }] });
    expect(t.stages).toHaveLength(3);
  });

  it('lists problems with names instead of keys', () => {
    expect(templateProblems(starter())).toEqual([]);
    const t = starter();
    t.name = ' ';
    t.tasks[1] = { ...t.tasks[1]!, name: '' };
    t.tasks[0] = { ...t.tasks[0]!, predecessors: [{ key: t.tasks[1]!.key, type: 'FS', lagDays: 0 }] };
    const messages = templateProblems(t).map((p) => p.message);
    expect(messages).toContain('The template needs a name');
    expect(messages).toContain('Task 2 needs a name');
    expect(messages).toContain('Predecessor loop between tasks 1 Visual & mechanical inspection, 2 (no name)');
  });

  it('makes unique names and counts', () => {
    expect(uniqueName('New template', ['Other'])).toBe('New template');
    expect(uniqueName('New template', ['new template', 'New template 2'])).toBe('New template 3');
    expect(countWord(3)).toBe('Three');
    expect(countWord(12)).toBe('12');
    expect(
      assetsUsing(
        [
          { id: 'a', tag: 'A', description: '', templateId: 't' },
          { id: 'b', tag: 'B', description: '' },
        ],
        't',
      ).map((a) => a.id),
    ).toEqual(['a']);
    expect(assetsUsing(undefined, 't')).toEqual([]);
  });

  it('undoes and redoes draft edits', () => {
    const t = starter();
    const d0 = freshDraft(t);
    expect(stepDraft(d0, 'undo')).toBeNull();
    const removed = { ...t, tasks: t.tasks.slice(1) };
    const d1 = editDraft(d0, removed, removed.tasks[0]!.key);
    const d2 = editDraft(d1, { ...removed, name: 'Renamed' });
    expect(d2.past).toEqual([t, removed]);
    const u1 = stepDraft(d2, 'undo')!;
    expect(u1.draft).toBe(removed);
    const u2 = stepDraft(u1, 'undo')!;
    expect(u2.draft).toBe(t);
    expect(stepDraft(u2, 'undo')).toBeNull();
    expect(stepDraft(u2, 'redo')!.draft).toBe(removed);
    // A new edit clears the redo list.
    expect(editDraft(u1, { ...removed, name: 'Other' }).future).toEqual([]);
    // Selection only keeps a task that still exists.
    const gone = editDraft(d0, removed, null);
    expect(stepDraft({ ...gone, selectedKey: t.tasks[1]!.key }, 'undo')!.selectedKey).toBe(t.tasks[1]!.key);
  });

  it('makes typing in one field a single undo step', () => {
    const t = starter();
    const key = t.tasks[0]!.key;
    const rename = (d: ReturnType<typeof freshDraft>, name: string, field = `name:${key}`) =>
      editDraft(d, { ...d.draft, tasks: d.draft.tasks.map((x) => (x.key === key ? { ...x, name } : x)) }, d.selectedKey, field);
    let d = freshDraft(t);
    for (const name of ['P', 'Pr', 'Pre']) d = rename(d, name);
    expect(d.past).toEqual([t]);
    expect(d.draft.tasks[0]!.name).toBe('Pre');
    // Another field, or an edit with no key, starts a new step.
    const typed = d.draft;
    d = rename(d, 'Pre', `trade:${key}`);
    d = editDraft(d, { ...d.draft, tasks: d.draft.tasks.map((x) => (x.key === key ? { ...x, trade: 'Elec' } : x)) }, d.selectedKey, `trade:${key}`);
    expect(d.past).toEqual([t, typed]);
    const cleared = editDraft(d, { ...d.draft, name: 'X' });
    expect(rename(cleared, 'Again').past).toHaveLength(4);
    // Undo then typing again does not merge into the undone step.
    const u = stepDraft(d, 'undo')!;
    expect(rename(u, 'Prez').past).toEqual([t, typed]);
  });

  it('describes the library in the status bar', () => {
    expect(libraryStatus([{ kind: 'starter' }, { kind: 'starter' }, { kind: 'custom' }]).left).toBe('Library: 2 starters · 1 custom');
    expect(libraryStatus([{ kind: 'starter' }]).left).toBe('Library: 1 starter · 0 custom');
    expect(libraryStatus(null).right).toContain('Export to share');
  });
});
