import { useEffect, useId, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  /** A line under the title. With it, title and line sit in a header band (mockup 05). */
  description?: string;
  /** Extra class on the dialog box, for dialogs that lay out their own body and footer. */
  className?: string;
}

/**
 * A centred modal dialog. Escape and the backdrop close it, and Tab / Shift+Tab stay inside
 * it (wrapping at the ends). Shared by everything in dialogs/.
 */
export function Modal({ title, onClose, children, width = 440, description, className }: ModalProps) {
  const titleId = useId();
  const descId = useId();
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
        className={className ? `modal ${className}` : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        style={{ width }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          } else if (e.key === 'Tab') {
            const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
            const first = items[0];
            const last = items[items.length - 1];
            if (!first || !last) {
              e.preventDefault();
              return;
            }
            const active = document.activeElement;
            if (e.shiftKey && (active === first || active === e.currentTarget)) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && active === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        {description ? (
          <header className="modal-head">
            <h2 id={titleId} className="modal-title">
              {title}
            </h2>
            <p id={descId} className="modal-desc">
              {description}
            </p>
          </header>
        ) : (
          <h2 id={titleId} className="modal-title">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}
