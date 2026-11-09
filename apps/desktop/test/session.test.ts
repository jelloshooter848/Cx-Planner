import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Project } from '@cx/core';
import { riversideProject } from '@cx/fixtures';
import { ProjectStore, WorkspaceStore } from '@cx/storage';
import type { AppState } from '../src/shared/api.js';
import { scheduleView, Session, windowTitle } from '../src/main/session.js';

let dir: string;
let sent: AppState[];
let session: Session;

function openProject(p: Project = riversideProject(), name = 'Riverside.cxp'): ProjectStore {
  const store = ProjectStore.open(join(dir, name), { create: true });
  store.replaceProject(p, 'test');
  session.openStore(store);
  return store;
}

const last = () => sent[sent.length - 1]!;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cx-session-'));
  sent = [];
  session = new Session({ broadcast: (s) => sent.push(s), recent: () => [join(dir, 'gone.cxp')] });
});
afterEach(() => session.dispose());

describe('Session', () => {
  it('starts with no project', () => {
    const s = session.getState();
    expect(s).toMatchObject({ project: null, filePath: null, fileName: null, canUndo: false, canRedo: false, workspacePath: null, revision: 0 });
    expect(s.recent).toEqual([{ path: join(dir, 'gone.cxp'), name: 'gone.cxp', exists: false }]);
    expect(windowTitle(s)).toBe('Cx Planner');
  });

  it('opens a store and broadcasts the project with its schedule', () => {
    openProject();
    const s = last();
    expect(s.fileName).toBe('Riverside.cxp');
    expect(windowTitle(s)).toBe('Cx Planner — Riverside.cxp');
    expect(s.project!.tasks.length).toBe(riversideProject().tasks.length);
    const first = s.project!.tasks[0]!;
    expect(s.schedule[first.id]).toMatchObject({ start: expect.any(String), finish: expect.any(String), critical: expect.any(Boolean) });
    expect(s.projectFinish).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.lastSavedAt).not.toBeNull();
  });

  it('saves every edit immediately, with undo and redo', () => {
    openProject();
    const task = session.project!.tasks[0]!;
    const before = session.getState().revision;
    const r = session.apply({ kind: 'updateTask', id: task.id, patch: { name: 'Renamed task' } });
    expect(r).toMatchObject({ ok: true, value: { changed: true } });
    expect(last()).toMatchObject({ canUndo: true, canRedo: false, revision: before + 1 });
    expect(last().undoLabel).toBe(r.ok ? r.value.summary : '');
    // Saved: a fresh read of the file has the edit.
    const path = session.filePath!;
    const stored = () => {
      session.dispose();
      const s = ProjectStore.open(path);
      const p = s.loadProject();
      s.close();
      session.openStore(ProjectStore.open(path));
      return p;
    };
    expect(stored().tasks[0]!.name).toBe('Renamed task');

    // Reopening clears the undo stack; edit again to test undo and redo.
    session.apply({ kind: 'updateTask', id: task.id, patch: { name: 'Second name' } });
    expect(session.undo()).toMatchObject({ ok: true, value: { summary: expect.stringMatching(/^Undo: /) } });
    expect(session.project!.tasks[0]!.name).toBe('Renamed task');
    expect(last()).toMatchObject({ canUndo: false, canRedo: true });
    expect(session.redo()).toMatchObject({ ok: true, value: { summary: expect.stringMatching(/^Redo: /) } });
    expect(session.project!.tasks[0]!.name).toBe('Second name');
    expect(stored().tasks[0]!.name).toBe('Second name');
  });

  it('logs every edit, undo and redo in the change log with its summary', () => {
    const store = openProject();
    const task = session.project!.tasks[0]!;
    session.apply({ kind: 'updateTask', id: task.id, patch: { durationDays: task.durationDays + 2 } });
    session.undo();
    session.redo();
    const summaries = store.changesSince().map((e) => e.summary).filter((s) => s !== undefined);
    expect(summaries.filter((s) => s.startsWith('Undo: ')).length).toBe(1);
    expect(summaries.filter((s) => s.startsWith('Redo: ')).length).toBe(1);
  });

  it('a new edit clears redo', () => {
    openProject();
    const [a, b] = session.project!.tasks;
    session.apply({ kind: 'updateTask', id: a!.id, patch: { name: 'A' } });
    session.undo();
    expect(session.getState().canRedo).toBe(true);
    session.apply({ kind: 'updateTask', id: b!.id, patch: { name: 'B' } });
    expect(session.getState().canRedo).toBe(false);
  });

  it('refuses invalid edits without saving or adding an undo step', () => {
    const store = openProject();
    const rev = store.getRevisionState().revision;
    const r = session.apply({ kind: 'updateTask', id: 'nope', patch: { name: 'x' } });
    expect(r).toMatchObject({ ok: false, code: 'unknown-task' });
    expect(store.getRevisionState().revision).toBe(rev);
    expect(session.getState().canUndo).toBe(false);
  });

  it('treats an edit that changes nothing as a no-op', () => {
    openProject();
    const task = session.project!.tasks[0]!;
    const n = sent.length;
    expect(session.apply({ kind: 'updateTask', id: task.id, patch: {} })).toEqual({ ok: true, value: { changed: false, summary: null } });
    expect(sent.length).toBe(n);
    expect(session.getState().canUndo).toBe(false);
  });

  it('reports nothing to undo or redo, and no project', () => {
    expect(session.undo()).toMatchObject({ ok: false, code: 'no-project' });
    openProject();
    expect(session.undo()).toMatchObject({ ok: false, code: 'nothing-to-undo' });
    expect(session.redo()).toMatchObject({ ok: false, code: 'nothing-to-redo' });
  });

  it('limits the undo history', () => {
    session.dispose();
    session = new Session({ broadcast: () => {}, undoLimit: 2 });
    openProject();
    const t = session.project!.tasks[0]!;
    for (const name of ['a', 'b', 'c']) session.apply({ kind: 'updateTask', id: t.id, patch: { name } });
    expect(session.undo().ok).toBe(true);
    expect(session.undo().ok).toBe(true);
    expect(session.undo()).toMatchObject({ ok: false, code: 'nothing-to-undo' });
    expect(session.project!.tasks[0]!.name).toBe('a');
  });

  it('renumbers task codes on open and logs that as its own save', () => {
    const p = riversideProject();
    p.tasks = p.tasks.map((t) => ({ ...t, code: `x${t.code}` }));
    const store = openProject(p);
    expect(session.project!.tasks[0]!.code).toBe('1.1');
    expect(store.changesSince().some((e) => e.summary === 'Renumbered task codes' && e.source === 'open')).toBe(true);
  });

  it('closes the project and releases its lock', () => {
    openProject();
    const path = session.filePath!;
    session.closeProject();
    expect(last().project).toBeNull();
    ProjectStore.open(path).close();
  });

  it('switches stores for Save As, keeping undo history', () => {
    openProject();
    const t = session.project!.tasks[0]!;
    session.apply({ kind: 'updateTask', id: t.id, patch: { name: 'Before copy' } });
    const copy = join(dir, 'Copy.cxp');
    session.copyFileTo(copy);
    session.replaceStore(ProjectStore.open(copy, { backup: false }));
    expect(last()).toMatchObject({ fileName: 'Copy.cxp', canUndo: true });
    session.undo();
    session.dispose();
    const s = ProjectStore.open(copy);
    expect(s.loadProject().tasks[0]!.name).toBe(t.name);
    s.close();
  });

  it('reports a schedule that cannot be computed instead of throwing', () => {
    const p = riversideProject();
    const [a, b] = p.tasks;
    p.dependencies = [
      { predecessorId: a!.id, successorId: b!.id, type: 'FS', lagDays: 0 },
      { predecessorId: b!.id, successorId: a!.id, type: 'FS', lagDays: 0 },
    ];
    const v = scheduleView(p);
    expect(v.schedule).toEqual({});
    expect(v.scheduleError).toMatch(/loop/i);
  });

  it('gives an empty project an empty schedule', () => {
    const v = scheduleView({ ...riversideProject(), assets: [], tasks: [], dependencies: [] });
    expect(v).toEqual({ schedule: {}, projectFinish: null, scheduleError: null });
  });

  it('adds assets from a template as one undoable step and stores the template snapshot', () => {
    session.setWorkspace(WorkspaceStore.open(join(dir, 'ws'), { create: true }));
    const store = openProject();
    const tpl = session.getTemplate('starter-panelboard');
    if (!tpl.ok) throw new Error(tpl.message);
    const before = session.project!;
    const r = session.apply({
      kind: 'addAssetsFromTemplate', template: tpl.value, followPrevious: true,
      assets: ['PNL-T-1', 'PNL-T-2', 'PNL-T-3'].map((tag) => ({ tag, description: 'Panelboard' })),
    });
    expect(r).toMatchObject({ ok: true, value: { changed: true } });
    expect(session.project!.tasks.length).toBe(before.tasks.length + 12);
    expect(store.getTemplateSnapshots()).toEqual([tpl.value]);
    expect(session.undo()).toMatchObject({ ok: true });
    expect(session.project).toEqual(before);
    expect(last().canRedo).toBe(true);
    // The snapshot stays: it is history of what the project used.
    expect(store.getTemplateSnapshots()).toEqual([tpl.value]);
    expect(session.apply({ kind: 'addAssetsFromTemplate', template: tpl.value, assets: [{ tag: before.assets[0]!.tag, description: '' }] }))
      .toMatchObject({ ok: false, code: 'duplicate-tag' });
  });

  describe('templates', () => {
    it('needs a workspace', () => {
      expect(session.listTemplates()).toMatchObject({ ok: false, code: 'no-workspace' });
    });

    it('lists, saves, duplicates and deletes templates', () => {
      session.setWorkspace(WorkspaceStore.open(join(dir, 'ws'), { create: true }));
      expect(last().workspacePath).toBe(join(dir, 'ws'));
      const list = session.listTemplates();
      if (!list.ok) throw new Error(list.message);
      expect(list.value.length).toBeGreaterThan(0);
      const id = list.value[0]!.id;
      const t = session.getTemplate(id);
      if (!t.ok) throw new Error(t.message);
      const saved = session.saveTemplate({ ...t.value, assetDescription: 'Edited' });
      expect(saved).toMatchObject({ ok: true, value: { version: t.value.version + 1 } });
      const dup = session.duplicateTemplate(id, 'Copy of it');
      expect(dup).toMatchObject({ ok: true, value: { name: 'Copy of it', kind: 'custom' } });
      expect(session.deleteTemplate(id)).toEqual({ ok: true, value: undefined });
      expect(session.getTemplate(id)).toMatchObject({ ok: false, code: 'unknown-template' });
      expect(session.restoreStarters()).toEqual({ ok: true, value: [id] });
      expect(session.saveTemplate({ ...t.value, tasks: [t.value.tasks[0]!, t.value.tasks[0]!] })).toMatchObject({ ok: false, code: 'invalid-template' });
    });
  });
});
