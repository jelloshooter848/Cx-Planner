/**
 * The in-window menu row as plain data, built from the current state. Kept free of React so
 * it can be unit-tested; components/MenuBar.tsx draws it.
 */
import type { AppState } from '../shared/api';
import type { Action, ViewId } from './store';

export type MenuItem =
  | { kind: 'separator' }
  | {
      kind: 'item';
      label: string;
      action: Action;
      enabled: boolean;
      /** Shortcut hint shown on the right, e.g. "Ctrl+Z". */
      shortcut?: string;
      checked?: boolean;
      /** Extra text shown under the label (e.g. the full path of a recent file). */
      detail?: string;
    }
  | { kind: 'submenu'; label: string; enabled: boolean; items: MenuItem[] };

export interface MenuDef {
  id: string;
  label: string;
  /** A dropdown menu, or a view tab (Schedule, Templates) when `view` is set. */
  items?: MenuItem[];
  view?: ViewId;
  /** For view tabs: this view is showing. */
  active?: boolean;
  enabled: boolean;
}

/** "Ctrl+Z", or "⌘Z" on macOS. */
export function keyHint(keys: string, mac: boolean): string {
  if (!mac) return keys;
  return keys.replace('Ctrl+Shift+', '⇧⌘').replace('Ctrl+', '⌘');
}

const sep: MenuItem = { kind: 'separator' };

export function buildMenus(state: AppState | null, view: ViewId | 'welcome', mac = false): MenuDef[] {
  const open = !!state?.project;
  const hasWorkspace = !!state?.workspacePath;
  const k = (keys: string) => keyHint(keys, mac);
  const item = (label: string, action: Action, o: { enabled?: boolean; shortcut?: string; checked?: boolean; detail?: string } = {}): MenuItem => ({
    kind: 'item',
    label,
    action,
    enabled: o.enabled ?? true,
    ...(o.shortcut ? { shortcut: k(o.shortcut) } : {}),
    ...(o.checked !== undefined ? { checked: o.checked } : {}),
    ...(o.detail ? { detail: o.detail } : {}),
  });
  const recent = state?.recent ?? [];

  const file: MenuItem[] = [
    item('New project…', { type: 'new-project' }, { shortcut: 'Ctrl+N' }),
    item('Open…', { type: 'open-project' }, { shortcut: 'Ctrl+O' }),
    {
      kind: 'submenu',
      label: 'Open recent',
      enabled: recent.length > 0,
      items: recent.map((r) => item(r.name, { type: 'open-recent', path: r.path }, { detail: r.exists ? r.path : `${r.path} (not found)` })),
    },
    item('Open sample project', { type: 'open-sample' }),
    sep,
    item('Save As…', { type: 'save-as' }, { enabled: open, shortcut: 'Ctrl+Shift+S' }),
    item('Close project', { type: 'close-project' }, { enabled: open }),
    sep,
    item('Print / Export PDF…', { type: 'print' }, { enabled: open, shortcut: 'Ctrl+P' }),
    sep,
    item('Workspace folder…', { type: 'choose-workspace' }),
    sep,
    item('Exit', { type: 'exit' }),
  ];
  // In the Templates view Ctrl+Z / Ctrl+Y undo template edits (see TemplatesView), so the
  // project's Undo / Redo show no shortcut there.
  const projectKeys = view !== 'templates';
  const edit: MenuItem[] = [
    item(state?.undoLabel ? `Undo ${state.undoLabel}` : 'Undo', { type: 'undo' }, { enabled: !!state?.canUndo, ...(projectKeys ? { shortcut: 'Ctrl+Z' } : {}) }),
    item(state?.redoLabel ? `Redo ${state.redoLabel}` : 'Redo', { type: 'redo' }, { enabled: !!state?.canRedo, ...(projectKeys ? { shortcut: 'Ctrl+Y' } : {}) }),
    sep,
    item('Add assets from template…', { type: 'add-assets' }, { enabled: open }),
  ];
  // With no project open, Schedule (tab and View item) leads back to the welcome screen.
  const viewItems: MenuItem[] = [
    ...(open ? [] : [item('Start page', { type: 'view', view: 'schedule' }, { checked: view === 'welcome' })]),
    item('Schedule', { type: 'view', view: 'schedule' }, { checked: view === 'schedule' }),
    item('Templates', { type: 'view', view: 'templates' }, { enabled: open || hasWorkspace, checked: view === 'templates' }),
  ];
  const reports: MenuItem[] = [item('3-week look-ahead', { type: 'view', view: 'lookahead' }, { enabled: open, checked: view === 'lookahead' })];
  const help: MenuItem[] = [item('About Cx Planner', { type: 'about' })];

  return [
    { id: 'file', label: 'File', items: file, enabled: true },
    { id: 'edit', label: 'Edit', items: edit, enabled: true },
    { id: 'view', label: 'View', items: viewItems, enabled: true },
    { id: 'schedule', label: 'Schedule', view: 'schedule', active: view === 'schedule', enabled: true },
    { id: 'templates', label: 'Templates', view: 'templates', active: view === 'templates', enabled: open || hasWorkspace },
    { id: 'reports', label: 'Reports', items: reports, enabled: true },
    { id: 'help', label: 'Help', items: help, enabled: true },
  ];
}
