/** Shared pieces of the Schedule view's right-hand panel (task and asset forms). */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Command } from '@cx/core';
import type { Store } from '../../store';

/** An error message to show under the field, or null when the edit was saved (or changed nothing). */
export type Commit = (text: string) => Promise<string | null>;

/** Applies an edit; returns the refusal message (not shown as a notice: the field shows it). */
export async function edit(store: Store, cmd: Command): Promise<string | null> {
  try {
    const r = await store.api.apply(cmd);
    return r.ok ? null : r.message;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export interface FieldProps {
  label: string;
  /** The saved value, shown whenever the field is not being edited. */
  value: string;
  commit: Commit;
  /** Data attribute for tests and styling. */
  name: string;
  multiline?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  inputMode?: 'numeric';
  hint?: ReactNode;
  title?: string;
}

/**
 * A text field that commits on blur and on Enter (Ctrl+Enter in a multi-line field).
 * Escape puts the saved value back. A refused edit keeps the typed text and shows why.
 */
export function Field({ label, value, commit, name, multiline, readOnly, placeholder, inputMode, hint, title }: FieldProps) {
  const id = useId();
  const errId = useId();
  /** The text being edited, or null to show the saved value. */
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The text being committed, while a commit is in flight. */
  const saving = useRef<string | null>(null);
  // A new saved value (an undo, an edit elsewhere) replaces an unchanged draft.
  useEffect(() => {
    setDraft((d) => (d === value ? null : d));
  }, [value]);

  const save = async () => {
    if (draft === null || readOnly) return;
    const typed = draft;
    if (typed === value) {
      setDraft(null);
      setError(null);
      return;
    }
    // Enter then blur (or Tab) before the commit returns would save the same text twice;
    // the second command, built from the old project, could be refused and show a false error.
    if (saving.current !== null) return;
    saving.current = typed;
    try {
      const problem = await commit(typed);
      setError(problem);
      // Keep the text while there is a problem so it can be fixed; otherwise show the saved value.
      if (!problem) setDraft((d) => (d === typed ? null : d));
    } finally {
      saving.current = null;
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && (draft !== null || error)) {
      e.preventDefault();
      e.stopPropagation();
      setDraft(null);
      setError(null);
    } else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void save();
    }
  };
  const common = {
    id,
    className: 'input',
    value: draft ?? value,
    readOnly,
    placeholder,
    title,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errId : undefined,
    onChange: (e: { target: { value: string } }) => {
      setDraft(e.target.value);
    },
    onBlur: () => void save(),
    onKeyDown,
  };
  return (
    <div className="field task-field" data-field={name}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {multiline ? <textarea {...common} rows={4} /> : <input {...common} type="text" inputMode={inputMode} autoComplete="off" spellCheck={false} />}
      {error ? (
        <p id={errId} className="field-error" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="field-hint">{hint}</p>
      )}
    </div>
  );
}

