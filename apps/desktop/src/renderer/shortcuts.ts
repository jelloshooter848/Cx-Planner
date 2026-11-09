/** Keyboard shortcuts the renderer handles itself (the native menu only shows them as hints). */
import type { Action } from './store';

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * The action for a key press, or null. Ctrl (Cmd on macOS) + Z / Y / Shift+Z undo and redo
 * project edits, except in a text field, which keeps its own undo. Ctrl+N, Ctrl+O,
 * Ctrl+Shift+S and Ctrl+P work everywhere. On macOS (`mac`) the native menu owns Cmd+N, Cmd+O,
 * Cmd+Shift+S and Cmd+P (see main/menu.ts), so they are left to it here and do not run twice.
 */
export function shortcutAction(e: KeyLike, inTextField: boolean, mac = false): Action | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) return inTextField ? null : { type: 'undo' };
  if ((k === 'y' && !e.shiftKey) || (k === 'z' && e.shiftKey)) return inTextField ? null : { type: 'redo' };
  if (mac && (k === 'n' || k === 'o' || k === 's' || k === 'p')) return null;
  if (k === 'n' && !e.shiftKey) return { type: 'new-project' };
  if (k === 'o' && !e.shiftKey) return { type: 'open-project' };
  if (k === 's' && e.shiftKey) return { type: 'save-as' };
  if (k === 'p' && !e.shiftKey) return { type: 'print' };
  return null;
}

/** True for elements that keep their own text undo (text inputs, text areas, editable content; not selects). */
export function isTextField(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== 'string') return false;
  const h = el as HTMLElement;
  if (h.isContentEditable || h.tagName === 'TEXTAREA') return true;
  if (h.tagName !== 'INPUT') return false;
  const type = (h as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
}
