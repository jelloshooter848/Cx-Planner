import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Project, Template } from '@cx/core';
import { largeProject, riversideProject } from '@cx/fixtures';
import { APPLICATION_ID, MIGRATIONS, ProjectStore } from '../src/index.js';

let file: string;
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'cx-save-')), 'Riverside.cxp');
});

function storeWith(p: Project): ProjectStore {
  const s = ProjectStore.open(file, { create: true });
  s.replaceProject(p, 'test');
  return s;
}

/** Events since `seq`, as [entity, id, field] triples. */
function eventKeys(s: ProjectStore, seq: number): string[] {
  return s.changesSince(seq).map((e) => `${e.entity} ${e.entityId} ${e.field ?? '-'}`);
}

const template: Template = {
  id: 'tpl-lv-swgr',
  name: 'LV switchgear',
  version: 2,
  kind: 'starter',
  assetDescription: 'Low-voltage switchgear lineup',
  stages: ['Delivered', 'Set', 'Tested'],
  tasks: [
    { key: 'vmi', name: 'Visual & mechanical inspection', durationDays: 2, type: 'task', trade: 'Electrical', predecessors: [], checklist: [{ id: 'c1', text: 'Nameplate matches drawings' }], requiredCerts: [] },
  ],
  requiredDocs: ['Test report'],
};

describe('ProjectStore.saveProject', () => {
  it('writes nothing when the project is unchanged', () => {
    const p = riversideProject();
    const s = storeWith(p);
    const before = s.getRevisionState();
    const result = s.saveProject(riversideProject(), 'autosave');
    expect(result).toEqual({ changes: 0, revision: before.revision });
    expect(s.getRevisionState()).toEqual(before);
    expect(s.changesSince(before.lastChangeSeq)).toEqual([]);
    s.close();
  });

  it('saves into a new, empty file', () => {
    const s = ProjectStore.open(file, { create: true });
    const p = riversideProject();
    const r = s.saveProject(p, 'new');
    expect(r.revision).toBe(1);
    expect(s.loadProject()).toEqual(p);
    expect(s.saveProject(p, 'new').changes).toBe(0);
    s.close();
  });

  it('writes one event per changed field and row, and loads back what was saved', () => {
    const s = storeWith(riversideProject());
    const seq = s.getRevisionState().lastChangeSeq;
    const next = riversideProject();
    next.name = 'Riverside DC – Building A';
    next.calendar.holidays = ['2026-11-26', '2027-01-01'];
    // Field edits.
    const t13 = next.tasks.find((t) => t.id === 't1.3')!;
    t13.percentComplete = 100;
    t13.actualFinish = '2026-11-09';
    t13.notes = 'Megger readings on sheet 4';
    next.assets.find((a) => a.id === 'gen-1')!.location = 'North yard';
    // Remove the UPS asset with its tasks and links.
    next.assets = next.assets.filter((a) => a.id !== 'ups-1a');
    const upsTasks = new Set(next.tasks.filter((t) => t.assetId === 'ups-1a').map((t) => t.id));
    next.tasks = next.tasks.filter((t) => !upsTasks.has(t.id));
    next.dependencies = next.dependencies.filter((d) => !upsTasks.has(d.predecessorId) && !upsTasks.has(d.successorId));
    // Change a link's lag; add an asset, a task and a link.
    next.dependencies.find((d) => d.predecessorId === 't1.6' && d.successorId === 't4.1')!.lagDays = 2;
    next.assets.push({ id: 'pnl-1a', tag: 'PNL-1A', description: 'Panelboard', templateId: 'tpl-pnl', templateVersion: 1 });
    next.tasks.push({ id: 't5.1', assetId: 'pnl-1a', code: '5.1', name: 'Torque verification', type: 'task', durationDays: 1, percentComplete: 0, templateKey: 'torque' });
    next.dependencies.push({ predecessorId: 't1.6', successorId: 't5.1', type: 'FS', lagDays: 0 });

    const r = s.saveProject(next, 'user', 'Weekly update');
    expect(s.loadProject()).toEqual(next);

    const keys = eventKeys(s, seq);
    expect(keys).toEqual(
      expect.arrayContaining([
        'project riverside-bldg-a name',
        'holiday 2026-12-25 -',
        'holiday 2027-01-01 -',
        'task t1.3 percentComplete',
        'task t1.3 actualFinish',
        'task t1.3 notes',
        'asset gen-1 location',
        'asset ups-1a -',
        'task t3.1 -',
        'task t3.4 -',
        'dependency t1.6->t3.1 -',
        'dependency t3.1->t3.2 -',
        'dependency t1.6->t4.1 lagDays',
        'asset pnl-1a -',
        'task t5.1 -',
        'dependency t1.6->t5.1 -',
      ]),
    );
    // UPS removal: 1 asset, 4 tasks, 4 links (3 in chain + one in). The generator rows only
    // shift up, so they get no "sort" events.
    expect(keys.filter((k) => k.endsWith(' sort'))).toEqual([]);
    // The 16 above, and the other two UPS tasks and two UPS links.
    expect(keys).toHaveLength(16 + 2 + 2);
    expect(r.changes).toBe(keys.length);

    const events = s.changesSince(seq);
    expect(events.every((e) => e.revision === r.revision && e.summary === 'Weekly update' && e.source === 'user')).toBe(true);
    expect(events.find((e) => e.entityId === 't1.3' && e.field === 'percentComplete')).toMatchObject({ oldValue: 50, newValue: 100 });
    expect(events.find((e) => e.entityId === 't1.3' && e.field === 'notes')).toMatchObject({ oldValue: undefined, newValue: 'Megger readings on sheet 4' });
    expect(events.find((e) => e.entityId === 't1.6->t4.1')).toMatchObject({ field: 'lagDays', oldValue: 1, newValue: 2 });
    expect(events.find((e) => e.entityId === 'ups-1a')).toMatchObject({ field: null, oldValue: { tag: 'UPS-1A' }, newValue: undefined });
    expect(events.find((e) => e.entityId === 't5.1')).toMatchObject({ field: null, oldValue: undefined, newValue: { templateKey: 'torque' } });
    expect(events.find((e) => e.entity === 'holiday' && e.entityId === '2027-01-01')).toMatchObject({ oldValue: undefined, newValue: '2027-01-01' });

    // Saving the same project again writes nothing; reopening loads the same project.
    expect(s.saveProject(next, 'autosave').changes).toBe(0);
    s.close();
    const again = ProjectStore.open(file, { backup: false });
    expect(again.loadProject()).toEqual(next);
    again.close();
  });

  it('logs readiness and calendar changes with decoded old values', () => {
    const s = storeWith(riversideProject());
    const seq = s.getRevisionState().lastChangeSeq;
    const next = riversideProject();
    const t = next.tasks.find((x) => x.id === 't1.4')!;
    const before = { ...t.readiness! };
    t.readiness = { ...before, S: 'ready' };
    next.calendar.workWeekdays = [1, 2, 3, 4, 5, 6];
    s.saveProject(next, 'user');
    const events = s.changesSince(seq);
    expect(events.find((e) => e.field === 'readiness')).toMatchObject({ oldValue: before, newValue: t.readiness });
    expect(events.find((e) => e.field === 'workWeekdays')).toMatchObject({ entity: 'project', oldValue: [1, 2, 3, 4, 5], newValue: [1, 2, 3, 4, 5, 6] });
    expect(s.loadProject()).toEqual(next);
    s.close();
  });

  it('moves a task to another asset and clears optional fields', () => {
    const s = storeWith(riversideProject());
    const next = riversideProject();
    const t = next.tasks.find((x) => x.id === 't2.1')!;
    t.assetId = 'gen-1';
    delete t.actualStart;
    delete t.responsible;
    const seq = s.getRevisionState().lastChangeSeq;
    s.saveProject(next, 'user');
    expect(eventKeys(s, seq)).toEqual(['task t2.1 assetId', 'task t2.1 responsible', 'task t2.1 actualStart']);
    expect(s.loadProject()).toEqual(next);
    s.close();
  });

  it('logs only the rows the caller moved, and keeps link and holiday order', () => {
    const s = storeWith(riversideProject());
    const seq = s.getRevisionState().lastChangeSeq;
    const next = riversideProject();
    // Move the last task to the top; every other task shifts down by one.
    next.tasks.unshift(next.tasks.pop()!);
    // Insert a new task in the middle (its neighbours below shift).
    next.tasks.splice(5, 0, { id: 't9.1', assetId: 'gen-1', code: '9.1', name: 'Load bank', type: 'task', durationDays: 1, percentComplete: 0 });
    next.dependencies.reverse();
    next.calendar.holidays.reverse();
    s.saveProject(next, 'user');
    const keys = eventKeys(s, seq);
    const last = riversideProject().tasks.at(-1)!.id;
    const n = next.dependencies.length;
    // One move for the task, n - 1 for the reversed links, one for the reversed holidays, one insert.
    expect(keys.filter((k) => k.startsWith('task '))).toEqual([`task ${last} sort`, 'task t9.1 -']);
    expect(keys.filter((k) => k.startsWith('dependency ')).length).toBe(n - 1);
    expect(keys.filter((k) => k.startsWith('holiday ')).length).toBe(1);
    expect(s.loadProject()).toEqual(next);
    expect(s.saveProject(s.loadProject(), 'autosave').changes).toBe(0);
    s.close();
  });

  it('saving the loaded project writes nothing, with edge values', () => {
    const p = riversideProject();
    p.assets[0]!.location = '';
    p.assets[0]!.system = '';
    p.assets[1]!.templateId = '';
    p.subtitle = '';
    const t = p.tasks.find((x) => x.readiness)!;
    const r = t.readiness!;
    // Same readiness, keys in reverse order.
    t.readiness = Object.fromEntries(Object.entries(r).reverse()) as typeof r;
    p.dependencies.reverse();
    p.calendar.holidays.reverse();
    const s = storeWith(p);
    const loaded = s.loadProject();
    expect(loaded.assets[0]).toMatchObject({ location: '', system: '' });
    expect(loaded.assets[1]!.templateId).toBe('');
    expect(loaded.dependencies).toEqual(p.dependencies);
    expect(loaded.calendar.holidays).toEqual(p.calendar.holidays);
    expect(s.saveProject(loaded, 'autosave').changes).toBe(0);
    // Readiness in yet another key order is still no change, for saveProject and updateTask.
    expect(s.saveProject(p, 'autosave').changes).toBe(0);
    s.updateTask(t.id, { readiness: { ...r } });
    expect(s.getRevisionState().revision).toBe(1);
    s.close();
  });

  it('rolls back the whole save when a row is invalid', () => {
    const p = riversideProject();
    const s = storeWith(p);
    const state = s.getRevisionState();
    const next = riversideProject();
    next.name = 'Renamed';
    next.dependencies.push({ predecessorId: 't1.1', successorId: 'no-such-task', type: 'FS', lagDays: 0 });
    expect(() => s.saveProject(next, 'user')).toThrow();
    expect(s.loadProject()).toEqual(p);
    expect(s.getRevisionState()).toEqual(state);
    // The store is still usable after the failed save.
    next.dependencies.pop();
    expect(s.saveProject(next, 'user').changes).toBe(1);
    s.close();
  });

  it('bumps the revision once per changing write and keeps it across replaceProject', () => {
    const s = storeWith(riversideProject());
    expect(s.getRevisionState().revision).toBe(1);
    expect(s.getRevisionState().savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    s.updateTask('t1.4', { notes: 'Settings file from engineer pending' });
    expect(s.getRevisionState().revision).toBe(2);
    s.updateTask('t1.4', { notes: 'Settings file from engineer pending' });
    expect(s.getRevisionState().revision).toBe(2);
    expect(s.loadProject().tasks.find((t) => t.id === 't1.4')!.notes).toBe('Settings file from engineer pending');
    s.replaceProject(riversideProject(), 'import');
    expect(s.getRevisionState().revision).toBe(3);
    s.close();
  });

  it('saves a large project in well under a second', () => {
    const big = largeProject();
    const s = ProjectStore.open(file, { create: true });
    let t0 = performance.now();
    s.saveProject(big, 'import');
    expect(performance.now() - t0).toBeLessThan(1000);

    const next = largeProject();
    next.tasks.forEach((t, i) => {
      if (i % 3 === 0) t.percentComplete = 50;
    });
    next.tasks.reverse();
    next.assets.splice(10, 1);
    const gone = new Set(big.tasks.filter((t) => t.assetId === big.assets[10]!.id).map((t) => t.id));
    next.tasks = next.tasks.filter((t) => !gone.has(t.id));
    next.dependencies = next.dependencies.filter((d) => !gone.has(d.predecessorId) && !gone.has(d.successorId));
    t0 = performance.now();
    const r = s.saveProject(next, 'user');
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(r.changes).toBeGreaterThan(next.tasks.length);
    expect(s.loadProject()).toEqual(next);
    s.close();
  });
});

describe('template snapshots', () => {
  it('stores every version of a snapshot copied into the project', () => {
    const s = storeWith(riversideProject());
    expect(s.getTemplateSnapshots()).toEqual([]);
    const seq = s.getRevisionState().lastChangeSeq;
    s.saveTemplateSnapshot(template, 'user');
    s.saveTemplateSnapshot(template, 'user');
    expect(s.getTemplateSnapshots()).toEqual([template]);
    const v3 = { ...template, version: 3, name: 'LV switchgear lineup' };
    s.saveTemplateSnapshot(v3, 'user');
    expect(s.getTemplateSnapshots()).toEqual([template, v3]);
    expect(s.getTemplateSnapshot('tpl-lv-swgr', 2)).toEqual(template);
    expect(s.getTemplateSnapshot('tpl-lv-swgr', 3)).toEqual(v3);
    expect(s.getTemplateSnapshot('tpl-lv-swgr', 4)).toBeUndefined();
    const v3b = { ...v3, name: 'LV switchgear (renamed)' };
    s.saveTemplateSnapshot(v3b, 'user');
    expect(s.getTemplateSnapshot('tpl-lv-swgr', 3)).toEqual(v3b);
    expect(s.changesSince(seq).map((e) => [e.entity, e.entityId, e.field, e.oldValue, e.newValue])).toEqual([
      ['template', 'tpl-lv-swgr', 'version', undefined, 2],
      ['template', 'tpl-lv-swgr', 'version', undefined, 3],
      ['template', 'tpl-lv-swgr', 'version', 3, 3],
    ]);
    // A project save leaves the snapshots alone.
    s.saveProject(riversideProject(), 'autosave');
    s.close();
    const again = ProjectStore.open(file, { backup: false });
    expect(again.getTemplateSnapshots()).toEqual([template, v3b]);
    again.close();
  });

  it('writes snapshots given to saveProject in the same transaction', () => {
    const s = storeWith(riversideProject());
    const before = s.getRevisionState().revision;
    const p = riversideProject();
    p.name = 'Renamed';
    const r = s.saveProject(p, 'user', 'Apply template', [template]);
    expect(r.revision).toBe(before + 1);
    expect(s.getTemplateSnapshots()).toEqual([template]);
    expect(s.changesSince(0).filter((e) => e.revision === r.revision).map((e) => e.entity)).toEqual(['template', 'project']);
    // A failed save writes no snapshot either.
    const bad = { ...riversideProject(), tasks: [{ ...riversideProject().tasks[0]!, durationDays: -1 }] };
    expect(() => s.saveProject(bad, 'user', 'Bad', [{ ...template, version: 9 }])).toThrow();
    expect(s.getTemplateSnapshot(template.id, 9)).toBeUndefined();
    s.close();
  });
});

describe('migrations', () => {
  it('keeps a version 3 snapshot when moving to per-version snapshots', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file);
    for (const m of MIGRATIONS.slice(0, 3)) db.exec(m);
    db.exec(`PRAGMA user_version = 3; PRAGMA application_id = ${APPLICATION_ID};`);
    db.prepare('INSERT INTO project_template (id, version, json) VALUES (?, ?, ?)').run(template.id, template.version, JSON.stringify(template));
    db.close();
    const s = ProjectStore.open(file, { backup: false });
    expect(s.getTemplateSnapshot(template.id, template.version)).toEqual(template);
    s.saveTemplateSnapshot({ ...template, version: template.version + 1 });
    expect(s.getTemplateSnapshots()).toHaveLength(2);
    s.close();
  });

  it('migrates a version 1 file with data to the current schema', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file);
    db.exec(MIGRATIONS[0]!);
    db.exec(`PRAGMA user_version = 1; PRAGMA application_id = ${APPLICATION_ID};`);
    db.exec(`
      INSERT INTO meta (key, value) VALUES ('id', 'old'), ('name', 'Old job'), ('subtitle', ''), ('start_date', '2026-01-05'),
        ('data_date', '2026-01-09'), ('work_weekdays', '[1,2,3,4,5]');
      INSERT INTO asset (id, tag, description, sort) VALUES ('A', 'SWGR-1A', 'Switchgear', 0);
      INSERT INTO task (id, asset_id, code, name, type, duration_days, percent_complete, sort) VALUES ('T1', 'A', '1.1', 'Inspect', 'task', 2, 0, 0);
      INSERT INTO task (id, asset_id, code, name, type, duration_days, percent_complete, sort) VALUES ('T2', 'A', '1.2', 'Test', 'task', 1, 0, 1);
      INSERT INTO dependency (predecessor_id, successor_id, type, lag_days) VALUES ('T1', 'T2', 'FS', 0);
      INSERT INTO change_event (at, source, entity, entity_id, field, old_value, new_value) VALUES ('2026-01-05T00:00:00Z', 'import', 'project', 'old', NULL, NULL, NULL);
    `);
    db.close();

    const s = ProjectStore.open(file, { backup: false });
    expect(s.schemaVersion).toBe(MIGRATIONS.length);
    const p = s.loadProject();
    expect(p.tasks.map((t) => t.id)).toEqual(['T1', 'T2']);
    expect(s.changesSince(0)[0]).not.toHaveProperty('revision');
    expect(s.getRevisionState()).toMatchObject({ revision: 0, lastChangeSeq: 1 });

    p.assets[0]!.templateId = 'tpl-lv-swgr';
    p.assets[0]!.templateVersion = 2;
    p.tasks[0]!.templateKey = 'vmi';
    p.tasks[0]!.notes = 'Done before the shutdown';
    const r = s.saveProject(p, 'user');
    expect(r).toEqual({ changes: 4, revision: 1 });
    s.saveTemplateSnapshot(template);
    expect(s.loadProject()).toEqual(p);
    s.close();
  });
});
