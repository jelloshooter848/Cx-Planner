import { useAppState } from '../store';

/**
 * The dark title bar, "Cx Planner — Riverside.cxp". The window has no native title bar
 * (see main.ts); the window buttons are drawn by the OS over the right end of this bar,
 * and the bar is the drag handle for moving the window.
 */
export function TitleBar() {
  const fileName = useAppState()?.fileName ?? null;
  return (
    <header className="titlebar" data-testid="titlebar">
      <span className="titlebar-app">Cx Planner</span>
      {fileName && <span className="titlebar-file">&nbsp;— {fileName}</span>}
    </header>
  );
}
