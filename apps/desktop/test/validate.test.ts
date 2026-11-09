import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Template } from '@cx/core';
import { STARTER_TEMPLATES } from '@cx/templates';
import { RECENT_LIMIT, RecentFiles, SettingsFile } from '../src/main/prefs.js';
import { failure, InputError } from '../src/main/session.js';
import { checkCommand, checkDate, checkId, checkName, checkNewProject, checkPaper, checkPath, checkTemplate } from '../src/main/validate.js';

describe('IPC input checks', () => {
  it('passes ordinary edits through to applyCommand', () => {
    const cmd = { kind: 'updateTask', id: 't1', patch: { name: 'x' } };
    expect(checkCommand(cmd)).toBe(cmd);
    expect(checkCommand({ kind: 'batch', commands: [cmd, { kind: 'unlink', predecessorId: 'a', successorId: 'b' }] })).toBeTruthy();
  });

  it('passes asset edits and deletes from the Schedule view', () => {
    const update = { kind: 'updateAsset', id: 'swgr-1a', patch: { tag: 'SWGR-1C', location: null } };
    const remove = { kind: 'removeAsset', id: 'xfmr-1a' };
    expect(checkCommand(update)).toBe(update);
    expect(checkCommand(remove)).toBe(remove);
  });

  it('refuses undo-only commands, also inside batches', () => {
    const refused = [
      { kind: 'restoreTask', task: {}, index: 0, dependencies: [] },
      { kind: 'restoreAsset', asset: {}, index: 0, tasks: [], dependencies: [] },
      { kind: 'restoreAssets', assets: [], tasks: [{ index: 0, item: { percentComplete: 150 } }], dependencies: [] },
      { kind: 'updateTask', id: 't', patch: {}, restore: true },
      { kind: 'updateAsset', id: 'a', patch: {}, restore: true },
      { kind: 'moveTask', id: 't', toAssetId: 'a', toIndex: 0, restoreArrayIndex: 3 },
      { kind: 'link', predecessorId: 'a', successorId: 'b', type: 'FS', lagDays: 0, index: 0 },
    ];
    for (const c of refused) {
      expect(() => checkCommand(c)).toThrow(InputError);
      expect(() => checkCommand({ kind: 'batch', commands: [{ kind: 'batch', commands: [c] }] })).toThrow(InputError);
    }
  });

  it('answers a restoreAssets edit from the renderer with invalid-input, as the IPC handler does', () => {
    const restoreAssets = { kind: 'restoreAssets', assets: [], tasks: [{ index: 0, item: { percentComplete: 150 } }], dependencies: [] };
    const viaIpc = (cmd: unknown) => {
      try {
        checkCommand(cmd);
        return { ok: true };
      } catch (err) {
        return failure(err);
      }
    };
    expect(viaIpc(restoreAssets)).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(viaIpc({ kind: 'batch', commands: [{ kind: 'setDataDate', date: '2026-01-01' }, restoreAssets] })).toMatchObject({ ok: false, code: 'invalid-input' });
  });

  it('refuses things that are not commands', () => {
    for (const bad of [null, 'x', [], {}, { kind: 3 }, { kind: 'batch', commands: 'no' }]) expect(() => checkCommand(bad)).toThrow(InputError);
    let deep: unknown = { kind: 'setDataDate', date: '2026-01-01' };
    for (let i = 0; i < 20; i++) deep = { kind: 'batch', commands: [deep] };
    expect(() => checkCommand(deep)).toThrow(/nested/);
  });

  it('checks names, ids, dates, paths and paper', () => {
    expect(checkName('  Job  ')).toBe('Job');
    expect(() => checkName('  ')).toThrow(InputError);
    expect(() => checkName('x'.repeat(201))).toThrow(/too long/);
    expect(() => checkId('')).toThrow(InputError);
    expect(() => checkId(5)).toThrow(InputError);
    expect(checkDate('2026-02-28')).toBe('2026-02-28');
    expect(() => checkDate('2026-02-31')).toThrow(InputError);
    expect(() => checkDate('Nov 2')).toThrow(InputError);
    expect(() => checkPath('a\0b')).toThrow(InputError);
    expect(checkPaper('tabloid')).toBe('tabloid');
    expect(() => checkPaper('toString')).toThrow(InputError);
    expect(checkNewProject({ name: ' A ', startDate: '2026-11-02', extra: 1 })).toEqual({ name: 'A', startDate: '2026-11-02' });
    expect(() => checkNewProject(null)).toThrow(InputError);
  });

  it('reads templates field by field, dropping unknown fields', () => {
    const t = structuredClone(STARTER_TEMPLATES[0]) as Template;
    const checked = checkTemplate({ ...t, sneaky: 'x' });
    expect(checked).not.toHaveProperty('sneaky');
    expect(checked.tasks.length).toBe(t.tasks.length);
    try {
      checkTemplate({ ...t, tasks: 'nope' });
      expect.unreachable();
    } catch (e) {
      expect(failure(e)).toMatchObject({ ok: false, code: 'invalid-template' });
    }
  });
});

describe('prefs', () => {
  it('keeps the last ten recent paths, newest first, without duplicates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cx-prefs-'));
    const r = new RecentFiles(join(dir, 'recent.json'));
    expect(r.list()).toEqual([]);
    for (let i = 0; i < 12; i++) r.add(join(dir, `p${i}.cxp`));
    r.add(join(dir, 'p5.cxp'));
    const list = r.list();
    expect(list.length).toBe(RECENT_LIMIT);
    expect(list[0]).toBe(join(dir, 'p5.cxp'));
    expect(list.filter((p) => p.endsWith('p5.cxp')).length).toBe(1);
    r.remove(join(dir, 'p5.cxp'));
    expect(r.has(join(dir, 'p5.cxp'))).toBe(false);
  });

  it('remembers when each recent file was opened, and reads the older list format', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cx-prefs-'));
    let now = new Date('2026-11-06T14:00:00.000Z');
    const r = new RecentFiles(join(dir, 'recent.json'), () => now);
    r.add(join(dir, 'a.cxp'));
    now = new Date('2026-11-09T08:30:00.000Z');
    r.add(join(dir, 'b.cxp'));
    expect(r.entries()).toEqual([
      { path: join(dir, 'b.cxp'), openedAt: '2026-11-09T08:30:00.000Z' },
      { path: join(dir, 'a.cxp'), openedAt: '2026-11-06T14:00:00.000Z' },
    ]);
    writeFileSync(join(dir, 'old.json'), JSON.stringify({ paths: ['/x/one.cxp', '', 3, '/x/two.cxp'] }));
    expect(new RecentFiles(join(dir, 'old.json')).entries()).toEqual([{ path: '/x/one.cxp' }, { path: '/x/two.cxp' }]);
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ entries: [{ path: '/x/a.cxp', openedAt: 'soon' }, { nope: 1 }, null] }));
    expect(new RecentFiles(join(dir, 'bad.json')).entries()).toEqual([{ path: '/x/a.cxp' }]);
  });

  it('survives a damaged settings file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cx-prefs-'));
    writeFileSync(join(dir, 'settings.json'), '{ not json');
    const s = new SettingsFile(join(dir, 'settings.json'));
    expect(s.get()).toEqual({});
    s.update({ workspacePath: '/ws' });
    expect(s.get()).toEqual({ workspacePath: '/ws' });
  });
});
