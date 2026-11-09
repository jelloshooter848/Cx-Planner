import { describe, expect, it } from 'vitest';
import { computeSchedule, instantiateTemplate, templateSpanDays, validateTemplate, type Project } from '@cx/core';
import { STARTER_TEMPLATES, starterTemplate, starterTemplates } from '../src/index.js';

/** Library list in the template editor mockup (02-Templates). */
const EXPECTED = [
  ['Low-voltage switchgear', 6],
  ['Medium-voltage switchgear', 7],
  ['Power transformer', 5],
  ['Panelboard / distribution', 4],
  ['Emergency generator', 6],
  ['Automatic transfer switch', 5],
  ['UPS & batteries', 6],
  ['Generic ITP (blank)', 3],
] as const;

describe('STARTER_TEMPLATES', () => {
  it('lists the eight starters with the task counts in the mockup', () => {
    expect(STARTER_TEMPLATES.map((t) => [t.name, t.tasks.length])).toEqual(EXPECTED);
  });

  it('has unique ids and starter metadata', () => {
    expect(new Set(STARTER_TEMPLATES.map((t) => t.id)).size).toBe(8);
    for (const t of STARTER_TEMPLATES) {
      expect(t.kind).toBe('starter');
      expect(t.version).toBe(1);
      expect(t.stages.length).toBeGreaterThan(0);
      expect(t.requiredDocs.length).toBeGreaterThan(0);
      expect(t.assetDescription).not.toBe('');
    }
  });

  it.each(STARTER_TEMPLATES.map((t) => [t.name, t] as const))('%s is valid, instantiates and schedules', (_name, t) => {
    expect(validateTemplate(t)).toEqual([]);
    const inst = instantiateTemplate(
      t,
      { asset: { id: 'A1', tag: 'TAG-1', description: t.assetDescription }, groupNumber: 1, startNoEarlierThan: '2026-11-02' },
      (key) => `A1:${key}`,
    );
    expect(inst.tasks).toHaveLength(t.tasks.length);
    const project: Project = {
      id: 'p', name: 'p', startDate: '2026-11-02', dataDate: '2026-11-02',
      calendar: { workWeekdays: [1, 2, 3, 4, 5], holidays: [] },
      assets: [inst.asset], tasks: inst.tasks, dependencies: inst.dependencies,
    };
    const r = computeSchedule(project);
    expect(r.tasks.size).toBe(t.tasks.length);
    expect(templateSpanDays(t)).toBeGreaterThan(0);
  });

  it('gives every hold and witness a notice lead time and every non-milestone a checklist', () => {
    for (const t of STARTER_TEMPLATES) {
      for (const task of t.tasks) {
        if (task.type === 'hold' || task.type === 'witness') expect(task.noticeLeadDays, `${t.name}: ${task.name}`).toBeGreaterThan(0);
        if (task.type !== 'milestone') expect(task.checklist.length, `${t.name}: ${task.name}`).toBeGreaterThan(0);
        expect(task.trade).not.toBe('');
      }
    }
  });

  it('low-voltage switchgear matches the template editor mockup', () => {
    const lv = STARTER_TEMPLATES[0]!;
    expect(lv.tasks.map((t) => [t.name, t.durationDays, t.type, t.trade, t.checklist.length])).toEqual([
      ['Visual & mechanical inspection', 2, 'task', 'Electrical', 5],
      ['Torque verification', 2, 'task', 'Electrical', 4],
      ['Insulation resistance test', 2, 'task', 'Test tech', 3],
      ['Relay settings & calibration', 4, 'task', 'Relay tech', 6],
      ['Functional test', 2, 'hold', 'Cx agent', 5],
      ['Energization', 0, 'milestone', 'Foreman', 0],
    ]);
    // Each task follows the one before it (the "Pred" column: —, 1, 2, 3, 4, 5).
    const keys = lv.tasks.map((t) => t.key);
    lv.tasks.forEach((t, i) => {
      expect(t.predecessors).toEqual(i === 0 ? [] : [{ key: keys[i - 1], type: 'FS', lagDays: 0 }]);
    });
    expect(lv.tasks[3]!.checklist.map((c) => c.text)).toEqual([
      'Settings file revision matches coordination study',
      'Pickup and time-delay values verified',
      'Instantaneous settings verified',
      'Trip test performed and recorded',
      'Settings printout attached',
      'Initials and date entered',
    ]);
    expect(lv.tasks[3]!.requiredCerts).toContain('Relay technician');
    expect(templateSpanDays(lv)).toBe(12);
  });

  it('is frozen; the copy helpers return editable clones', () => {
    expect(Object.isFrozen(STARTER_TEMPLATES)).toBe(true);
    expect(Object.isFrozen(STARTER_TEMPLATES[0]!.tasks[0]!.checklist)).toBe(true);
    const copies = starterTemplates();
    expect(copies).toEqual(STARTER_TEMPLATES);
    copies[0]!.tasks[0]!.name = 'Edited';
    expect(STARTER_TEMPLATES[0]!.tasks[0]!.name).toBe('Visual & mechanical inspection');
    const one = starterTemplate('starter-ups-batteries');
    expect(one?.name).toBe('UPS & batteries');
    expect(Object.isFrozen(one)).toBe(false);
    expect(starterTemplate('nope')).toBeUndefined();
  });
});
