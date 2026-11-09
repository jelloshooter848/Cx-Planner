import { describe, expect, it } from 'vitest';
import { taskChecklists, type Project, type Template, type TemplateTask } from '../src/index.js';

// Made-up data.
function tt(key: string, checklist: string[]): TemplateTask {
  return {
    key, name: `Step ${key}`, durationDays: 1, type: 'task', trade: 'Electrical', predecessors: [],
    checklist: checklist.map((text, i) => ({ id: `${key}-${i}`, text })), requiredCerts: [],
  };
}

const template: Template = {
  id: 'tpl-a', name: 'Panel', version: 2, kind: 'custom', assetDescription: 'Panel', stages: [], requiredDocs: [],
  tasks: [tt('vmi', ['Nameplate matches', 'No damage']), tt('energize', []), tt('ir', ['Megger phase to ground'])],
};

function project(): Project {
  return {
    id: 'p', name: 'Sample', startDate: '2026-11-02', dataDate: '2026-11-02',
    calendar: { workWeekdays: [1, 2, 3, 4, 5], holidays: [] },
    assets: [
      { id: 'b', tag: 'PNL-2', description: 'Panel', templateId: 'tpl-a' },
      { id: 'a', tag: 'PNL-1', description: 'Panel', templateId: 'tpl-a' },
      { id: 'c', tag: 'MAN-1', description: 'Typed by hand' },
    ],
    tasks: [
      { id: 'a1', assetId: 'a', code: '2.1', name: 'VMI', type: 'task', durationDays: 1, percentComplete: 0, templateKey: 'vmi' },
      { id: 'a2', assetId: 'a', code: '2.2', name: 'Energize', type: 'milestone', durationDays: 0, percentComplete: 0, templateKey: 'energize' },
      { id: 'b1', assetId: 'b', code: '1.1', name: 'IR', type: 'task', durationDays: 1, percentComplete: 0, templateKey: 'ir' },
      { id: 'b2', assetId: 'b', code: '1.2', name: 'Gone', type: 'task', durationDays: 1, percentComplete: 0, templateKey: 'removed-from-template' },
      { id: 'c1', assetId: 'c', code: '3.1', name: 'Manual', type: 'task', durationDays: 1, percentComplete: 0, templateKey: 'vmi' },
    ],
    dependencies: [],
  };
}

describe('taskChecklists', () => {
  it('lists tasks whose template task has checklist items, in asset order', () => {
    const r = taskChecklists(project(), [template]);
    expect(r.map((c) => c.task.id)).toEqual(['b1', 'a1']);
    expect(r[1]!.templateTask.checklist.map((i) => i.text)).toEqual(['Nameplate matches', 'No damage']);
    expect(r[1]!.asset.tag).toBe('PNL-1');
  });

  it('finds nothing without the template snapshot', () => {
    expect(taskChecklists(project(), [])).toEqual([]);
  });

  it('reads the snapshot version the asset is on when several are stored', () => {
    const v3: Template = { ...template, version: 3, tasks: [tt('vmi', ['Changed in v3']), tt('ir', [])] };
    const p = project();
    p.assets[1] = { ...p.assets[1]!, templateVersion: 2 };
    p.assets[0] = { ...p.assets[0]!, templateVersion: 3 };
    const r = taskChecklists(p, [template, v3]);
    expect(r.map((c) => c.task.id)).toEqual(['a1']);
    expect(r[0]!.templateTask.checklist.map((i) => i.text)).toEqual(['Nameplate matches', 'No damage']);
    // Without a version the newest snapshot is used.
    expect(taskChecklists(project(), [v3, template]).map((c) => c.template.version)).toEqual([3]);
  });
});
