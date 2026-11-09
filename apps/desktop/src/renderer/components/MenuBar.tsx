import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { MenuDef, MenuItem } from '../menus';
import type { Action } from '../store';

/** The items of one menu level (submenu triggers sit one level down, inside .menu-sub). */
const ITEMS = ':scope > [role^="menuitem"]:not(:disabled), :scope > .menu-sub > [role^="menuitem"]:not(:disabled)';

/**
 * The menu row under the title bar (File, Edit, View, Schedule, Templates, Reports, Help).
 * Schedule and Templates switch views; the others open dropdowns. Mouse: click to open,
 * hover to move between open menus. Keyboard: arrows move, Enter/Space choose, Escape closes.
 *
 * The row is one tab stop (roving tabindex: only the current top item has tabIndex 0). F10, or
 * a lone Alt press, moves focus to it, as the hidden native menu bar would on Windows/Linux;
 * a lone Alt while the row has focus closes any menu and gives focus back to the page.
 */
export function MenuBar({ menus, onAction }: { menus: MenuDef[]; onAction: (a: Action) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const barRef = useRef<HTMLElement>(null);
  const rovingId = (menus.find((m) => m.enabled && m.id === currentId) ?? menus.find((m) => m.enabled))?.id;

  // F10 or a lone Alt press: focus the menu row (or leave it, for Alt while it has focus).
  const rovingRef = useRef(rovingId);
  rovingRef.current = rovingId;
  useEffect(() => {
    let altArmed = false;
    const blocked = () => !!document.querySelector('[role="dialog"]');
    const focusBar = () => barRef.current?.querySelector<HTMLElement>(`[data-top="${rovingRef.current}"]`)?.focus();
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      altArmed = e.key === 'Alt' && !e.repeat && !e.ctrlKey && !e.shiftKey && !e.metaKey;
      if (e.key === 'F10' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && !blocked()) {
        e.preventDefault();
        focusBar();
      }
    };
    const onKeyUp = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Alt' || !altArmed) return;
      altArmed = false;
      if (blocked()) return;
      e.preventDefault();
      const active = document.activeElement;
      if (active instanceof HTMLElement && barRef.current?.contains(active)) {
        setOpenId(null);
        active.blur();
      } else {
        focusBar();
      }
    };
    const disarm = () => (altArmed = false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', disarm);
    window.addEventListener('blur', disarm);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', disarm);
      window.removeEventListener('blur', disarm);
    };
  }, []);

  useEffect(() => {
    if (!openId) return;
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenId(null);
    };
    const onBlur = () => setOpenId(null);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', onBlur);
    };
  }, [openId]);

  // Focus the first item of a menu opened from the keyboard.
  const focusFirst = useRef(false);
  useEffect(() => {
    if (!openId || !focusFirst.current) return;
    focusFirst.current = false;
    barRef.current?.querySelector(`[data-menu="${openId}"]`)?.querySelector<HTMLElement>(ITEMS)?.focus();
  }, [openId]);

  const topButton = (id: string) => barRef.current?.querySelector<HTMLElement>(`[data-top="${id}"]`);
  const choose = (a: Action) => {
    setOpenId(null);
    onAction(a);
  };
  const moveTop = (from: string, dir: 1 | -1) => {
    const enabled = menus.filter((m) => m.enabled);
    const i = enabled.findIndex((m) => m.id === from);
    const next = enabled[(i + dir + enabled.length) % enabled.length];
    if (!next) return;
    if (next.items && openId) {
      focusFirst.current = true;
      setOpenId(next.id);
    } else {
      setOpenId(null);
    }
    topButton(next.id)?.focus();
  };

  const onTopKey = (e: KeyboardEvent, m: MenuDef) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      moveTop(m.id, e.key === 'ArrowRight' ? 1 : -1);
    } else if (m.items && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      if (openId === m.id) {
        barRef.current?.querySelector(`[data-menu="${m.id}"]`)?.querySelector<HTMLElement>(ITEMS)?.focus();
        return;
      }
      focusFirst.current = true;
      setOpenId(m.id);
    } else if (e.key === 'Escape') {
      setOpenId(null);
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>, m: MenuDef) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(ITEMS)];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      items[(i + d + items.length) % items.length]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpenId(null);
      topButton(m.id)?.focus();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      // A submenu handles its own arrows first; here they move along the menu row.
      e.preventDefault();
      moveTop(m.id, e.key === 'ArrowRight' ? 1 : -1);
    } else if (e.key === 'Tab') {
      setOpenId(null);
    }
  };

  return (
    <nav className="menubar" role="menubar" aria-label="Main menu" ref={barRef}>
      {menus.map((m) => {
        const isOpen = openId === m.id;
        if (!m.items) {
          return (
            <button
              key={m.id}
              type="button"
              role="menuitem"
              data-top={m.id}
              tabIndex={m.id === rovingId ? 0 : -1}
              onFocus={() => setCurrentId(m.id)}
              className={`menubar-item${m.active ? ' is-active' : ''}`}
              aria-current={m.active ? 'page' : undefined}
              disabled={!m.enabled}
              onKeyDown={(e) => onTopKey(e, m)}
              onClick={() => m.view && choose({ type: 'view', view: m.view })}
              onMouseEnter={() => openId && setOpenId(null)}
            >
              {m.label}
            </button>
          );
        }
        return (
          <div key={m.id} className="menubar-slot">
            <button
              type="button"
              role="menuitem"
              data-top={m.id}
              tabIndex={m.id === rovingId ? 0 : -1}
              onFocus={() => setCurrentId(m.id)}
              className={`menubar-item${isOpen ? ' is-open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              disabled={!m.enabled}
              onKeyDown={(e) => onTopKey(e, m)}
              onClick={() => setOpenId(isOpen ? null : m.id)}
              onMouseEnter={() => openId && openId !== m.id && setOpenId(m.id)}
            >
              {m.label}
            </button>
            {isOpen && (
              <div className="menu" role="menu" aria-label={m.label} data-menu={m.id} tabIndex={-1} onKeyDown={(e) => onMenuKey(e, m)}>
                <MenuItems items={m.items} onChoose={choose} />
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function MenuItems({ items, onChoose }: { items: MenuItem[]; onChoose: (a: Action) => void }) {
  return (
    <>
      {items.map((it, i) => {
        if (it.kind === 'separator') return <div key={i} className="menu-sep" role="separator" />;
        if (it.kind === 'submenu') return <Submenu key={i} item={it} onChoose={onChoose} />;
        const checkable = it.checked !== undefined;
        return (
          <button
            key={i}
            type="button"
            role={checkable ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={checkable ? it.checked : undefined}
            aria-keyshortcuts={it.shortcut}
            className="menu-item"
            disabled={!it.enabled}
            title={it.detail}
            onClick={() => onChoose(it.action)}
          >
            <span className="menu-check" aria-hidden="true">
              {it.checked ? '✓' : ''}
            </span>
            <span className="menu-label">
              {it.label}
              {it.detail && <span className="menu-detail">{it.detail}</span>}
            </span>
            {it.shortcut && (
              <span className="menu-shortcut" aria-hidden="true">
                {it.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

function Submenu({ item, onChoose }: { item: Extract<MenuItem, { kind: 'submenu' }>; onChoose: (a: Action) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const openAndFocus = () => {
    setOpen(true);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(ITEMS)?.focus());
  };
  return (
    <div className="menu-sub" onMouseEnter={() => item.enabled && setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className="menu-item"
        disabled={!item.enabled}
        onClick={() => (open ? setOpen(false) : openAndFocus())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            openAndFocus();
          }
        }}
      >
        <span className="menu-check" aria-hidden="true" />
        <span className="menu-label">{item.label}</span>
        <span className="menu-shortcut" aria-hidden="true">
          ▸
        </span>
      </button>
      {open && (
        <div
          className="menu menu-flyout"
          role="menu"
          aria-label={item.label}
          ref={ref}
          onKeyDown={(e) => {
            const items = [...e.currentTarget.querySelectorAll<HTMLElement>(ITEMS)];
            const i = items.indexOf(document.activeElement as HTMLElement);
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              e.stopPropagation();
              items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
            } else if (e.key === 'ArrowLeft' || e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              (ref.current?.parentElement?.firstElementChild as HTMLElement | null)?.focus();
            }
          }}
        >
          <MenuItems items={item.items} onChoose={onChoose} />
        </div>
      )}
    </div>
  );
}
