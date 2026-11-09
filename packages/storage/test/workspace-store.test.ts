import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, statSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { TemplateInvalidError } from '@cx/core';
import type { Template } from '@cx/core';
import { STARTER_TEMPLATES } from '@cx/templates';
import {
  BACKUP_DIR,
  NotAWorkspaceFileError,
  ProjectFileCorruptError,
  ProjectLockedError,
  TEMPLATE_FILE_FORMAT,
  TemplateImportError,
  TemplateNotFoundError,
  WORKSPACE_APPLICATION_ID,
  WORKSPACE_FILE_NAME,
  WORKSPACE_MIGRATIONS,
  WorkspaceStore,
} from '../src/index.js';

let folder: string;
beforeEach(() => {
  folder = join(mkdtempSync(join(tmpdir(), 'cx-ws-')), 'Workspace');
});

const LV = 'starter-lv-switchgear';

function custom(id = 'tpl-meter'): Template {
  return {
    id,
    name: 'Revenue meter',
    version: 1,
    kind: 'custom',
    assetDescription: 'Utility revenue meter',
    stages: ['Set', 'Tested'],
    tasks: [
      { key: 'set', name: 'Set meter', durationDays: 1, type: 'task', trade: 'Electrical', predecessors: [], checklist: [], requiredCerts: [] },
      {
        key: 'test', name: 'Test meter', durationDays: 1, type: 'witness', trade: 'Test tech',
        predecessors: [{ key: 'set', type: 'FS', lagDays: 0 }],
        checklist: [{ id: 'c1', text: 'Polarity checked' }], requiredCerts: [], noticeLeadDays: 2,
      },
    ],
    requiredDocs: ['Test report'],
  };
}

describe('WorkspaceStore: file', () => {
  it('creates the folder and file, marks it CXW1 and seeds the starters', () => {
    const ws = WorkspaceStore.open(folder, { create: true });
    expect(ws.path).toBe(join(folder, WORKSPACE_FILE_NAME));
    expect(ws.schemaVersion).toBe(WORKSPACE_MIGRATIONS.length);
    const list = ws.listTemplates();
    expect(list.map((t) => t.id)).toEqual(STARTER_TEMPLATES.map((t) => t.id));
    expect(list.every((t) => t.kind === 'starter' && t.version === 1)).toBe(true);
    expect(list[0]!.taskCount).toBe(STARTER_TEMPLATES[0]!.tasks.length);
    expect(list[0]!.name).toBe(STARTER_TEMPLATES[0]!.name);
    expect(ws.getTemplate(LV)).toEqual(STARTER_TEMPLATES[0]);
    ws.close();

    const db = new DatabaseSync(join(folder, WORKSPACE_FILE_NAME));
    expect((db.prepare('PRAGMA application_id').get() as { application_id: number }).application_id).toBe(WORKSPACE_APPLICATION_ID);
    expect(WORKSPACE_APPLICATION_ID).toBe(0x43585731);
    db.close();
  });

  it('does not seed again on reopen, and keeps edits', () => {
    const ws = WorkspaceStore.open(folder, { create: true });
    ws.deleteTemplate(LV);
    ws.close();
    const again = WorkspaceStore.open(folder);
    expect(again.listTemplates()).toHaveLength(STARTER_TEMPLATES.length - 1);
    again.close();
  });

  it('seeds a file that was migrated but never seeded, once', () => {
    mkdirSync(folder, { recursive: true });
    const raw = new DatabaseSync(join(folder, WORKSPACE_FILE_NAME));
    raw.exec(WORKSPACE_MIGRATIONS[0]!);
    raw.exec(`PRAGMA user_version = 1; PRAGMA application_id = ${WORKSPACE_APPLICATION_ID};`);
    raw.close();
    const ws = WorkspaceStore.open(folder);
    expect(ws.listTemplates().map((t) => t.id)).toEqual(STARTER_TEMPLATES.map((t) => t.id));
    for (const t of STARTER_TEMPLATES) ws.deleteTemplate(t.id);
    ws.close();
    const again = WorkspaceStore.open(folder);
    expect(again.listTemplates()).toEqual([]);
    again.close();
  });

  it('refuses a damaged file and releases the lock', () => {
    WorkspaceStore.open(folder, { create: true }).close();
    const path = join(folder, WORKSPACE_FILE_NAME);
    const raw = new DatabaseSync(path);
    const pageSize = (raw.prepare('PRAGMA page_size').get() as { page_size: number }).page_size;
    raw.close();
    // Scribble over every page after the first, keeping the header readable.
    const pages = statSync(path).size / pageSize;
    const fd = openSync(path, 'r+');
    for (let p = 1; p < pages; p++) writeSync(fd, Buffer.alloc(pageSize, 0x5a), 0, pageSize, p * pageSize + 8);
    closeSync(fd);
    expect(() => WorkspaceStore.open(folder, { backup: false })).toThrow(ProjectFileCorruptError);
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  it('refuses to open a missing workspace without create', () => {
    expect(() => WorkspaceStore.open(folder)).toThrow(/No workspace file/);
  });

  it('holds the single-writer lock while open', () => {
    const ws = WorkspaceStore.open(folder, { create: true });
    expect(() => WorkspaceStore.open(folder)).toThrow(ProjectLockedError);
    ws.close();
    expect(existsSync(join(folder, `${WORKSPACE_FILE_NAME}.lock`))).toBe(false);
    WorkspaceStore.open(folder).close();
  });

  it('backs up on open', () => {
    WorkspaceStore.open(folder, { create: true }).close();
    WorkspaceStore.open(folder).close();
    const backups = readdirSync(join(folder, BACKUP_DIR));
    expect(backups.some((f) => f.startsWith(`${WORKSPACE_FILE_NAME}.`) && f.endsWith('.bak'))).toBe(true);
  });

  it('rejects a project database or other SQLite file in place of the workspace', () => {
    const other = join(folder, 'other');
    WorkspaceStore.open(other, { create: true }).close();
    const raw = new DatabaseSync(join(other, WORKSPACE_FILE_NAME));
    raw.exec('PRAGMA application_id = 0x43585031');
    raw.close();
    expect(() => WorkspaceStore.open(other)).toThrow(NotAWorkspaceFileError);
    expect(existsSync(join(other, `${WORKSPACE_FILE_NAME}.lock`))).toBe(false);
  });

  it('refuses a workspace saved by a newer schema', () => {
    WorkspaceStore.open(folder, { create: true }).close();
    const raw = new DatabaseSync(join(folder, WORKSPACE_FILE_NAME));
    raw.exec(`PRAGMA user_version = ${WORKSPACE_MIGRATIONS.length + 1}`);
    raw.close();
    expect(() => WorkspaceStore.open(folder)).toThrow(/newer version/);
  });

  it('keeps the change log append-only', () => {
    const ws = WorkspaceStore.open(folder, { create: true });
    expect(ws.changesSince().length).toBe(STARTER_TEMPLATES.length);
    expect(() => ws.exec('DELETE FROM change_event')).toThrow(/append-only/);
    expect(() => ws.exec("UPDATE change_event SET source = 'x'")).toThrow(/append-only/);
    ws.close();
  });
});

describe('WorkspaceStore: templates', () => {
  let ws: WorkspaceStore;
  beforeEach(() => {
    ws = WorkspaceStore.open(folder, { create: true });
    return () => ws.close();
  });

  it('returns copies that cannot change the library', () => {
    const t = ws.getTemplate(LV)!;
    t.name = 'Changed in memory';
    expect(ws.getTemplate(LV)!.name).toBe(STARTER_TEMPLATES[0]!.name);
    expect(ws.getTemplate('nope')).toBeUndefined();
  });

  it('bumps the version only when content changes, and keeps starters as starters', () => {
    const seq = ws.changesSince().at(-1)!.seq;
    const t = ws.getTemplate(LV)!;
    expect(ws.saveTemplate(t).version).toBe(1);
    expect(ws.changesSince(seq)).toEqual([]);

    t.tasks[0]!.durationDays += 1;
    const saved = ws.saveTemplate(t, 'editor');
    expect(saved).toMatchObject({ id: LV, kind: 'starter', version: 2 });
    expect(ws.getTemplate(LV)!.tasks[0]!.durationDays).toBe(t.tasks[0]!.durationDays);
    const ev = ws.changesSince(seq);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ entity: 'template', entityId: LV, field: 'content', source: 'editor' });
    expect((ev[0]!.oldValue as Template).version).toBe(1);
    expect((ev[0]!.newValue as Template).version).toBe(2);

    // A rename is a change; a stale version or kind in the input is ignored.
    expect(ws.saveTemplate({ ...t, name: 'LV gear', version: 1, kind: 'custom' })).toMatchObject({ version: 3, kind: 'starter', name: 'LV gear' });
    // Key order does not count as a change.
    const current = ws.getTemplate(LV)!;
    const reversed = (o: object): object => Object.fromEntries(Object.entries(o).reverse());
    const shuffled = { ...(reversed(current) as Template), tasks: current.tasks.map((x) => reversed(x) as typeof x) };
    expect(ws.saveTemplate(shuffled).version).toBe(3);
  });

  it('brings a deleted template back when it is saved again', () => {
    ws.saveTemplate(custom());
    ws.deleteTemplate('tpl-meter');
    const seq = ws.changesSince().at(-1)!.seq;
    const back = ws.saveTemplate(custom());
    expect(back).toMatchObject({ id: 'tpl-meter', version: 1 });
    expect(ws.getTemplate('tpl-meter')).toEqual(back);
    expect(ws.changesSince(seq)).toEqual([expect.objectContaining({ field: 'deleted', oldValue: true, newValue: false })]);
  });

  it('trims names on save and import', () => {
    expect(ws.saveTemplate({ ...custom(), name: '  padded  ' }).name).toBe('padded');
    const t = { ...custom('tpl-pad'), name: '  imported  ' };
    expect(ws.importTemplate(JSON.stringify({ format: 'cx-template', version: 1, template: t })).template.name).toBe('imported');
  });

  it('lists a starter added later before custom templates, in shipped order', () => {
    ws.saveTemplate(custom());
    // Simulate a starter shipped after this workspace was made.
    const late = STARTER_TEMPLATES[1]!.id;
    ws.exec(`DELETE FROM template WHERE id = '${late}'`);
    expect(ws.restoreStarters()).toEqual([late]);
    const ids = ws.listTemplates().map((t) => t.id);
    expect(ids).toEqual([...STARTER_TEMPLATES.map((t) => t.id), 'tpl-meter']);
  });

  it('adds a new template as custom version 1 and lists it last', () => {
    const saved = ws.saveTemplate({ ...custom(), version: 7, kind: 'starter' });
    expect(saved).toEqual({ ...custom(), version: 1, kind: 'custom' });
    const list = ws.listTemplates();
    expect(list.at(-1)).toMatchObject({ id: 'tpl-meter', name: 'Revenue meter', kind: 'custom', version: 1, taskCount: 2 });
    expect(list.at(-1)!.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('refuses invalid templates', () => {
    const bad = custom();
    bad.tasks[0]!.predecessors = [{ key: 'test', type: 'FS', lagDays: 0 }];
    expect(() => ws.saveTemplate(bad)).toThrow(TemplateInvalidError);
    expect(() => ws.saveTemplate({ ...custom(), name: '  ' })).toThrow(/needs a name/);
    expect(() => ws.saveTemplate({ ...custom(), id: '' })).toThrow(/no id/);
    expect(ws.getTemplate('tpl-meter')).toBeUndefined();
  });

  it('duplicates as a custom template at version 1', () => {
    const t = ws.getTemplate(LV)!;
    t.stages = ['Only'];
    ws.saveTemplate(t);
    const copy = ws.duplicateTemplate(LV, '  LV gear, site B  ');
    expect(copy.id).not.toBe(LV);
    expect(copy.id).toMatch(/^tpl-/);
    expect(copy).toMatchObject({ name: 'LV gear, site B', kind: 'custom', version: 1, stages: ['Only'] });
    expect(copy.tasks).toEqual(t.tasks);
    expect(ws.getTemplate(copy.id)).toEqual(copy);
    expect(() => ws.duplicateTemplate('nope', 'x')).toThrow(TemplateNotFoundError);
    expect(() => ws.duplicateTemplate(LV, '')).toThrow(/needs a name/);
  });

  it('deletes templates, including starters, and restores missing starters', () => {
    ws.saveTemplate(custom());
    ws.deleteTemplate('tpl-meter');
    ws.deleteTemplate(LV);
    expect(ws.getTemplate(LV)).toBeUndefined();
    expect(ws.listTemplates().map((t) => t.id)).not.toContain(LV);
    expect(() => ws.deleteTemplate(LV)).toThrow(TemplateNotFoundError);

    // An edited starter that is still there is left alone.
    const mv = ws.getTemplate('starter-mv-switchgear')!;
    mv.name = 'MV gear (ours)';
    ws.saveTemplate(mv);

    expect(ws.restoreStarters()).toEqual([LV]);
    expect(ws.getTemplate(LV)).toEqual(STARTER_TEMPLATES[0]);
    expect(ws.getTemplate('starter-mv-switchgear')!.name).toBe('MV gear (ours)');
    expect(ws.getTemplate('tpl-meter')).toBeUndefined();
    expect(ws.listTemplates().map((t) => t.id)).toEqual(STARTER_TEMPLATES.map((t) => t.id));
    expect(ws.restoreStarters()).toEqual([]);
  });

  it('gives a restored starter a new version when its last content differed', () => {
    const t = ws.getTemplate(LV)!;
    t.requiredDocs = [...t.requiredDocs, 'Extra'];
    ws.saveTemplate(t);
    ws.deleteTemplate(LV);
    ws.restoreStarters();
    expect(ws.getTemplate(LV)).toEqual({ ...STARTER_TEMPLATES[0], version: 3 });
  });

  it('exports and imports a template', () => {
    ws.saveTemplate(custom());
    const json = ws.exportTemplate('tpl-meter');
    const file = JSON.parse(json) as { format: string; version: number; template: Template };
    expect(file).toEqual({ format: TEMPLATE_FILE_FORMAT, version: 1, template: custom() });
    expect(() => ws.exportTemplate('nope')).toThrow(TemplateNotFoundError);

    // Same id already here: imported under a new id.
    const dup = ws.importTemplate(json);
    expect(dup.idChanged).toBe(true);
    expect(dup.template.id).not.toBe('tpl-meter');
    expect(dup.template).toMatchObject({ name: 'Revenue meter', kind: 'custom', version: 1 });

    // Into another workspace: id and version kept.
    const other = WorkspaceStore.open(join(folder, '..', 'Other'), { create: true });
    const edited = ws.getTemplate('tpl-meter')!;
    edited.stages = ['Set'];
    ws.saveTemplate(edited);
    const res = other.importTemplate(ws.exportTemplate('tpl-meter'));
    expect(res).toEqual({ idChanged: false, template: { ...custom(), stages: ['Set'], version: 2 } });
    expect(other.getTemplate('tpl-meter')).toEqual(res.template);
    expect(other.changesSince().at(-1)).toMatchObject({ source: 'import', entityId: 'tpl-meter' });
    other.close();
  });

  it('imports an exported starter as a custom copy', () => {
    const res = ws.importTemplate(ws.exportTemplate(LV));
    expect(res.idChanged).toBe(true);
    expect(res.template.kind).toBe('custom');
  });

  it('explains why a file cannot be imported', () => {
    const problems = (json: string): string[] => {
      try {
        ws.importTemplate(json);
      } catch (e) {
        expect(e).toBeInstanceOf(TemplateImportError);
        return (e as TemplateImportError).problems;
      }
      throw new Error('expected the import to fail');
    };
    expect(problems('{oops')[0]).toMatch(/not valid JSON/);
    expect(problems('{"format":"something-else"}')[0]).toMatch(/not a Cx Planner template/);
    expect(problems('[]')[0]).toMatch(/not a Cx Planner template/);
    expect(problems(JSON.stringify({ format: 'cx-template', version: 2, template: custom() }))[0]).toMatch(/newer version/);
    expect(problems(JSON.stringify({ format: 'cx-template', version: 1 }))).toEqual(['The file has no template']);

    const wrongShape = { ...custom(), name: 5, stages: 'Set', tasks: [{ ...custom().tasks[0], durationDays: '2', type: 'job' }, 'x'] };
    expect(problems(JSON.stringify({ format: 'cx-template', version: 1, template: wrongShape }))).toEqual([
      'Template: name must be text',
      'Template: stages must be a list',
      'Task 1 ("Set meter"): durationDays must be a number',
      'Task 1 ("Set meter"): type must be one of task, hold, witness, milestone',
      'Task 2 must be an object',
    ]);

    const loop = custom();
    loop.tasks[0]!.predecessors = [{ key: 'test', type: 'FS', lagDays: 0 }];
    expect(problems(JSON.stringify({ format: 'cx-template', version: 1, template: loop }))[0]).toMatch(/loop/);

    expect(ws.listTemplates()).toHaveLength(STARTER_TEMPLATES.length);
  });

  it('keeps optional task fields on import', () => {
    const t = custom('tpl-opt');
    t.tasks[1]!.testForm = 'TF-12';
    ws.saveTemplate(t);
    const other = WorkspaceStore.open(join(folder, '..', 'Other2'), { create: true });
    const res = other.importTemplate(ws.exportTemplate('tpl-opt'));
    expect(res.template.tasks[1]).toMatchObject({ testForm: 'TF-12', noticeLeadDays: 2 });
    expect(res.template).toEqual(t);
    other.close();
  });

  it('imports a file without a kind as custom', () => {
    const { kind: _kind, ...noKind } = custom('tpl-nokind');
    const res = ws.importTemplate(JSON.stringify({ format: 'cx-template', version: 1, template: noKind }));
    expect(res.template.kind).toBe('custom');
  });

  it('rejects a bad template version with an import error', () => {
    for (const version of [0, 1.5]) {
      const json = JSON.stringify({ format: 'cx-template', version: 1, template: { ...custom('tpl-v'), version } });
      expect(() => ws.importTemplate(json)).toThrow(TemplateImportError);
    }
    expect(ws.getTemplate('tpl-v')).toBeUndefined();
  });

  it('drops unknown fields on import', () => {
    const t = { ...custom('tpl-x'), secret: 'x', tasks: custom().tasks.map((k) => ({ ...k, extra: 1 })) };
    const res = ws.importTemplate(JSON.stringify({ format: 'cx-template', version: 1, template: t }));
    expect(res.template).toEqual(custom('tpl-x'));
  });
});
