import { useEffect, useRef, useState } from 'react';
import { moveItem } from '@cx/core';

export interface ListEditorProps<T> {
  /** Accessible name of the list, e.g. "Checklist items". */
  label: string;
  items: readonly T[];
  onChange(items: T[]): void;
  text(item: T): string;
  withText(item: T, text: string): T;
  /** A new empty item. */
  create(items: readonly T[]): T;
  /** Button text, e.g. "Add checklist item". */
  addLabel: string;
  /** What one item is called in button names, e.g. "item", "stage". */
  noun: string;
  placeholder?: string;
  /** Item key for React (defaults to the index). */
  itemKey?(item: T, index: number): string;
}

/**
 * A numbered list of one-line entries with add, remove, reorder and edit in place. Used for
 * checklist items, certifications, stages and required documents.
 */
export function ListEditor<T>({
  label,
  items,
  onChange,
  text,
  withText,
  create,
  addLabel,
  noun,
  placeholder,
  itemKey,
}: ListEditorProps<T>) {
  const listRef = useRef<HTMLOListElement>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  useEffect(() => {
    if (focusIndex === null) return;
    listRef.current?.querySelectorAll<HTMLTextAreaElement>('textarea')[focusIndex]?.focus();
    setFocusIndex(null);
  }, [focusIndex]);
  const set = (i: number, value: string) => onChange(items.map((it, j) => (j === i ? withText(it, value) : it)));
  const move = (i: number, to: number) => {
    onChange(moveItem(items, i, to));
    setFocusIndex(Math.max(0, Math.min(items.length - 1, to)));
  };
  return (
    <div className="list-editor">
      {items.length > 0 && (
        <ol ref={listRef} className="list-editor-items" aria-label={label}>
          {items.map((item, i) => (
            <li key={itemKey ? itemKey(item, i) : i} className="list-editor-item">
              <span className="list-editor-num" aria-hidden="true">
                {i + 1}
              </span>
              <textarea
                className="list-editor-input"
                rows={1}
                value={text(item)}
                placeholder={placeholder}
                aria-label={`${label} ${i + 1}`}
                onChange={(e) => set(i, e.target.value.replace(/[\r\n]+/g, ' '))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const next = [...items];
                    next.splice(i + 1, 0, create(items));
                    onChange(next);
                    setFocusIndex(i + 1);
                  } else if (e.altKey && e.key === 'ArrowUp') {
                    e.preventDefault();
                    move(i, i - 1);
                  } else if (e.altKey && e.key === 'ArrowDown') {
                    e.preventDefault();
                    move(i, i + 1);
                  }
                }}
              />
              <span className="row-actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Move ${noun} ${i + 1} up`}
                  title="Move up (Alt+↑)"
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Move ${noun} ${i + 1} down`}
                  title="Move down (Alt+↓)"
                  disabled={i === items.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${noun} ${i + 1}`}
                  title="Remove"
                  onClick={() => onChange(items.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <button
        type="button"
        className="btn"
        onClick={() => {
          onChange([...items, create(items)]);
          setFocusIndex(items.length);
        }}
      >
        {addLabel}
      </button>
    </div>
  );
}
