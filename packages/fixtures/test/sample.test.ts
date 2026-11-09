import { describe, expect, it } from 'vitest';
import { computeSchedule, taskChecklists, validateTemplate } from '@cx/core';
import { STARTER_TEMPLATES } from '@cx/templates';
import { riversideSample } from '../src/index.js';

describe('riverside sample', () => {
  it('has the nine assets of mockup 01, in sidebar order', () => {
    const { project } = riversideSample();
    expect(project.assets.map((a) => a.tag)).toEqual(['SWGR-1A', 'SWGR-1B', 'XFMR-1A', 'XFMR-1B', 'UPS-1A', 'UPS-1B', 'GEN-1', 'GEN-2', 'ATS-1']);
    expect(new Set(project.assets.map((a) => a.system))).toEqual(new Set(['Medium & low-voltage distribution', 'Critical power']));
  });

  it('makes every asset from a starter template and stores those templates', () => {
    const { project, templates } = riversideSample();
    for (const t of templates) {
      expect(validateTemplate(t)).toEqual([]);
      expect(STARTER_TEMPLATES.find((s) => s.id === t.id)?.version).toBe(t.version);
    }
    for (const a of project.assets) {
      expect(templates.some((t) => t.id === a.templateId && t.version === a.templateVersion)).toBe(true);
    }
    expect(project.tasks.every((t) => t.templateKey && t.readiness)).toBe(true);
    // Codes follow the asset order: 1.x for SWGR-1A ... 9.x for ATS-1.
    expect(project.tasks.find((t) => t.id === 'ats-1-vmi')?.code).toBe('9.1');
  });

  it('gives tasks test-sheet checklists from the template snapshots', () => {
    const { project, templates } = riversideSample();
    const lists = taskChecklists(project, templates);
    expect(lists.length).toBeGreaterThan(20);
    expect(lists.every((l) => l.templateTask.checklist.length > 0)).toBe(true);
    expect(lists.some((l) => l.task.id === 'swgr-1a-relay')).toBe(true);
  });

  it('schedules cleanly with progress up to the data date', () => {
    const { project } = riversideSample();
    const r = computeSchedule(project);
    expect(r.tasks.size).toBe(project.tasks.length);
    expect(r.tasks.get('swgr-1a-relay')).toMatchObject({ start: '2026-11-10', finish: '2026-11-13', critical: true });
    expect(project.tasks.find((t) => t.id === 'swgr-1a-ir')?.percentComplete).toBe(50);
    // The ATS transfer test waits for both generators.
    expect(r.tasks.get('ats-1-transfer')!.es >= r.tasks.get('gen-2-ready')!.ef).toBe(true);
  });

  it('is the same on every call', () => {
    expect(riversideSample()).toEqual(riversideSample());
  });
});
