import { useEffect, useId, useRef, type ReactNode } from 'react';

/** A centred modal dialog. Escape and the backdrop close it. Shared by everything in dialogs/. */
export function Modal({ title, onClose, children, width = 440 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    // Focus the first field, or the dialog itself.
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(:disabled)');
    (first ?? ref.current)?.focus();
    return () => before?.focus?.();
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <h2 id={titleId} className="modal-title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
