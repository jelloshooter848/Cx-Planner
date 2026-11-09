import { statusText } from '../format';
import { useAppState, useUi } from '../store';

/** Bottom line: counts on the left, data date and save state on the right (or the current view's own line). */
export function StatusBar() {
  const app = useAppState();
  const { status } = useUi();
  if (!app) return <footer className="statusbar" />;
  const t = status ? { ...status, savedDetail: '' } : statusText(app);
  return (
    <footer className="statusbar" data-testid="statusbar">
      <span className="statusbar-left">{t.left}</span>
      <span className="statusbar-right" title={t.savedDetail || undefined}>
        {t.right}
      </span>
    </footer>
  );
}
