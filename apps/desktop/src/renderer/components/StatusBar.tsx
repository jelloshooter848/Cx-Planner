import { statusText } from '../format';
import { useAppState } from '../store';

/** Bottom line: counts on the left, data date and save state on the right. */
export function StatusBar() {
  const app = useAppState();
  if (!app) return <footer className="statusbar" />;
  const t = statusText(app);
  return (
    <footer className="statusbar" data-testid="statusbar">
      <span className="statusbar-left">{t.left}</span>
      <span className="statusbar-right" title={t.savedDetail || undefined}>
        {t.right}
      </span>
    </footer>
  );
}
