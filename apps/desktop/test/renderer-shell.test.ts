import { describe, expect, it } from 'vitest';
import type { AppState } from '../src/shared/api.js';
import { longDate, shortDate, statusText } from '../src/renderer/format.js';
import { buildMenus, keyHint, type MenuItem } from '../src/renderer/menus.js';
import { isTextField, shortcutAction } from '../src/renderer/shortcuts.js';
import { riversideProject } from '@cx/fixtures';

const key = (k: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
  key: k,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
});

describe('shortcuts', () => {
  it('maps Ctrl/Cmd keys to actions', () => {
    expect(shortcutAction(key('z', { ctrl: true }), false)).toEqual({ type: 'undo' });
    expect(shortcutAction(key('Z', { ctrl: true, shift: true }), false)).toEqual({ type: 'redo' });
    expect(shortcutAction(key('y', { ctrl: true }), false)).toEqual({ type: 'redo' });
    expect(shortcutAction(key('z', { meta: true }), false)).toEqual({ type: 'undo' });
    expect(shortcutAction(key('n', { ctrl: true }), false)).toEqual({ type: 'new-project' });
    expect(shortcutAction(key('o', { ctrl: true }), false)).toEqual({ type: 'open-project' });
    expect(shortcutAction(key('S', { ctrl: true, shift: true }), false)).toEqual({ type: 'save-as' });
  });

  it('leaves text-field undo, plain keys and Alt combinations alone', () => {
    expect(shortcutAction(key('z', { ctrl: true }), true)).toBeNull();
    expect(shortcutAction(key('y', { ctrl: true }), true)).toBeNull();
    expect(shortcutAction(key('n', { ctrl: true }), true)).toEqual({ type: 'new-project' });
    expect(shortcutAction(key('z'), false)).toBeNull();
    expect(shortcutAction(key('z', { ctrl: true, alt: true }), false)).toBeNull();
    expect(shortcutAction(key('s', { ctrl: true }), false)).toBeNull();
  });

  it('leaves Cmd+N, Cmd+O and Cmd+Shift+S to the native menu on macOS', () => {
    expect(shortcutAction(key('n', { meta: true }), false, true)).toBeNull();
    expect(shortcutAction(key('o', { meta: true }), false, true)).toBeNull();
    expect(shortcutAction(key('S', { meta: true, shift: true }), false, true)).toBeNull();
    expect(shortcutAction(key('z', { meta: true }), false, true)).toEqual({ type: 'undo' });
  });

  it('treats selects as having no text undo', () => {
    expect(isTextField({ tagName: 'SELECT', isContentEditable: false } as unknown as EventTarget)).toBe(false);
    expect(isTextField({ tagName: 'TEXTAREA', isContentEditable: false } as unknown as EventTarget)).toBe(true);
  });
});

describe('format', () => {
  it('formats ISO dates like the mockups', () => {
    expect(longDate('2026-11-06')).toBe('Nov 6, 2026');
    expect(shortDate('2026-12-07')).toBe('Dec 7');
    expect(longDate('not a date')).toBe('not a date');
    expect(shortDate('2026-13-01')).toBe('2026-13-01');
  });

  it('builds the status bar line', () => {
    const project = riversideProject();
    const t = statusText(
      { project, projectFinish: '2026-12-07', scheduleError: null, revision: 3, lastSavedAt: '2026-11-06T15:41:00Z', workspacePath: '/ws' },
      () => '3:41 PM',
    );
    expect(t.left).toBe(`4 assets · ${project.tasks.length} tasks · Critical path ends Dec 7`);
    expect(t.right).toBe('Data as of Nov 6, 2026 · Saved');
    expect(t.savedDetail).toBe('Last edit saved at 3:41 PM · Revision 3');
    const broken = statusText({ project: { assets: [{}], tasks: [], dataDate: '2026-11-02' }, projectFinish: null, scheduleError: 'Dependency loop', revision: 0, lastSavedAt: null, workspacePath: null });
    expect(broken.left).toBe('1 asset · 0 tasks · Schedule not computed: Dependency loop');
    expect(broken.savedDetail).toBe('No edits this session · Revision 0');
    expect(statusText({ project: null, projectFinish: null, scheduleError: null, revision: 0, lastSavedAt: null, workspacePath: '/ws' }).left).toBe('No project open');
  });
});

describe('menu row', () => {
  const base: AppState = {
    seq: 1,
    project: riversideProject(),
    schedule: {},
    projectFinish: null,
    scheduleError: null,
    filePath: '/p/Riverside.cxp',
    fileName: 'Riverside.cxp',
    revision: 2,
    lastSavedAt: null,
    canUndo: true,
    canRedo: false,
    undoLabel: 'Renamed 1.3',
    redoLabel: null,
    workspacePath: '/ws',
    recent: [
      { path: '/p/Riverside.cxp', name: 'Riverside.cxp', exists: true },
      { path: '/old/Gone.cxp', name: 'Gone.cxp', exists: false },
    ],
  };
  const items = (menus: ReturnType<typeof buildMenus>, id: string) => menus.find((m) => m.id === id)!.items!;
  const find = (list: MenuItem[], label: string) => list.find((i) => i.kind !== 'separator' && i.label === label) as Exclude<MenuItem, { kind: 'separator' }> | undefined;

  it('has the mockup menus in order, with Schedule and Templates as view tabs', () => {
    const menus = buildMenus(base, 'schedule');
    expect(menus.map((m) => m.label)).toEqual(['File', 'Edit', 'View', 'Schedule', 'Templates', 'Reports', 'Help']);
    expect(menus.find((m) => m.id === 'schedule')).toMatchObject({ view: 'schedule', active: true, enabled: true });
    expect(menus.find((m) => m.id === 'templates')).toMatchObject({ view: 'templates', active: false });
  });

  it('labels undo and redo with the edit they reverse', () => {
    const edit = items(buildMenus(base, 'schedule'), 'edit');
    expect(find(edit, 'Undo Renamed 1.3')).toMatchObject({ enabled: true, shortcut: 'Ctrl+Z', action: { type: 'undo' } });
    expect(find(edit, 'Redo')).toMatchObject({ enabled: false, shortcut: 'Ctrl+Y' });
    const after = items(buildMenus({ ...base, canUndo: false, undoLabel: null, canRedo: true, redoLabel: 'Renamed 1.3' }, 'schedule'), 'edit');
    expect(find(after, 'Undo')).toMatchObject({ enabled: false });
    expect(find(after, 'Redo Renamed 1.3')).toMatchObject({ enabled: true });
  });

  it('offers Add assets from template with a project and a workspace', () => {
    const label = 'Add assets from template…';
    expect(find(items(buildMenus(base, 'schedule'), 'edit'), label)).toMatchObject({ enabled: true, action: { type: 'add-assets' } });
    expect(find(items(buildMenus({ ...base, workspacePath: null }, 'schedule'), 'edit'), label)).toMatchObject({ enabled: false });
    expect(find(items(buildMenus({ ...base, project: null }, 'welcome'), 'edit'), label)).toMatchObject({ enabled: false });
  });

  it('lists recent files and disables project items with no project', () => {
    const file = items(buildMenus(base, 'schedule'), 'file');
    const recent = file.find((i) => i.kind === 'submenu');
    expect(recent?.kind === 'submenu' && recent.items.map((i) => i.kind === 'item' && [i.label, i.detail])).toEqual([
      ['Riverside.cxp', '/p/Riverside.cxp'],
      ['Gone.cxp', '/old/Gone.cxp (not found)'],
    ]);
    const closed = buildMenus({ ...base, project: null, filePath: null, fileName: null, recent: [] }, 'welcome');
    const f = items(closed, 'file');
    expect(find(f, 'Save As…')?.enabled).toBe(false);
    expect(find(f, 'Close project')?.enabled).toBe(false);
    expect(find(f, 'New project…')?.enabled).toBe(true);
    expect(find(f, 'Open recent')).toMatchObject({ kind: 'submenu', enabled: false });
    // Schedule stays enabled with no project: it leads back to the welcome screen.
    expect(closed.find((m) => m.id === 'schedule')?.enabled).toBe(true);
    expect(find(items(closed, 'view'), 'Start page')).toMatchObject({ enabled: true, checked: true, action: { type: 'view', view: 'schedule' } });
    expect(find(items(buildMenus(base, 'schedule'), 'view'), 'Start page')).toBeUndefined();
    expect(closed.find((m) => m.id === 'templates')?.enabled).toBe(true);
  });

  it('shows macOS key hints on a Mac', () => {
    expect(keyHint('Ctrl+Z', true)).toBe('⌘Z');
    expect(keyHint('Ctrl+Shift+S', true)).toBe('⇧⌘S');
    expect(keyHint('Ctrl+Z', false)).toBe('Ctrl+Z');
    expect(find(items(buildMenus(base, 'schedule', true), 'edit'), 'Undo Renamed 1.3')).toMatchObject({ shortcut: '⌘Z' });
  });
});
