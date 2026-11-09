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
 * project edits, except in a text field, which keeps its own undo. Ctrl+N, Ctrl+O and
 * Ctrl+Shift+S work everywhere.
 */
export function shortcutAction(e: KeyLike, inTextField: boolean): Action | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) return inTextField ? null : { type: 'undo' };
  if ((k === 'y' && !e.shiftKey) || (k === 'z' && e.shiftKey)) return inTextField ? null : { type: 'redo' };
  if (k === 'n' && !e.shiftKey) return { type: 'new-project' };
  if (k === 'o' && !e.shiftKey) return { type: 'open-project' };
  if (k === 's' && e.shiftKey) return { type: 'save-as' };
  return null;
}

/** True for elements that keep their own text undo (inputs, text areas, editable content). */
export function isTextField(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== 'string') return false;
  const h = el as HTMLElement;
  if (h.isContentEditable || h.tagName === 'TEXTAREA' || h.tagName === 'SELECT') return true;
  if (h.tagName !== 'INPUT') return false;
  const type = (h as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
}
