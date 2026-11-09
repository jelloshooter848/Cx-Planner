import { useEffect, useMemo } from 'react';
import { Dialogs } from './dialogs';
import { MenuBar } from './components/MenuBar';
import { NoticeBar } from './components/NoticeBar';
import { StatusBar } from './components/StatusBar';
import { TitleBar } from './components/TitleBar';
import { buildMenus } from './menus';
import { isTextField, shortcutAction } from './shortcuts';
import { effectiveView, useSnapshot, useStore } from './store';
import { LookAheadView } from './views/LookAhead/LookAheadView';
import { ScheduleView } from './views/Schedule/ScheduleView';
import { TemplatesView } from './views/Templates/TemplatesView';
import { WelcomeView } from './views/Welcome/WelcomeView';

export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

/** The window frame: title bar, menu row, the current view, status bar, and any open dialog. */
export function App() {
  const store = useStore();
  const snap = useSnapshot();
  const view = effectiveView(snap);
  const menus = useMemo(() => buildMenus(snap.app, view, isMac), [snap.app, view]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While a dialog is open only its own keys apply; Escape closes it wherever focus is.
      if (store.getSnapshot().ui.dialog) {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          store.closeDialog();
        }
        return;
      }
      const action = shortcutAction(e, isTextField(e.target), isMac);
      if (!action) return;
      e.preventDefault();
      void store.dispatch(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  if (!snap.app) return <div className={`app${isMac ? ' is-mac' : ''}`}><TitleBar /></div>;
  return (
    <div className={`app${isMac ? ' is-mac' : ''}`}>
      <TitleBar />
      <MenuBar menus={menus} onAction={(a) => void store.dispatch(a)} />
      <NoticeBar />
      <div className="workarea">
        {view === 'welcome' && <WelcomeView />}
        {view === 'schedule' && <ScheduleView />}
        {view === 'templates' && <TemplatesView />}
        {view === 'lookahead' && <LookAheadView />}
      </div>
      <StatusBar />
      <Dialogs />
    </div>
  );
}
