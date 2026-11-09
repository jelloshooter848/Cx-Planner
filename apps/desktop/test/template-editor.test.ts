import { describe, expect, it } from 'vitest';
import type { Template } from '@cx/core';
import { STARTER_TEMPLATES } from '@cx/templates';
import {
  assetsUsing,
  cleanTemplate,
  countWord,
  sameTemplate,
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
});
