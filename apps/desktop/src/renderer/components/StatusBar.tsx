import { useMemo } from 'react';
import { statusText, type InView } from '../format';
import { effectiveView, useAssetFilter, useAppState, useSelect, useUi } from '../store';

/** Bottom line: counts on the left, data date and save state on the right (or the current view's own line). */
export function StatusBar() {
  const app = useAppState();
  const { status } = useUi();
  const onSchedule = useSelect((s) => effectiveView(s) === 'schedule');
  const filter = useAssetFilter();
  const project = app?.project;
  // On the Schedule view an asset filter narrows the counts to what is in view.
  const inView = useMemo((): InView | null => {
    if (!onSchedule || !filter || !project) return null;
    const shown = new Set(filter);
    return { assets: filter.length, tasks: project.tasks.filter((t) => shown.has(t.assetId)).length };
  }, [onSchedule, filter, project]);
  if (!app) return <footer className="statusbar" />;
  const t = status ? { ...status, savedDetail: '' } : statusText(app, undefined, inView);
  return (
    <footer className="statusbar" data-testid="statusbar">
      <span className="statusbar-left">{t.left}</span>
      <span className="statusbar-right" title={t.savedDetail || undefined}>
        {t.right}
      </span>
    </footer>
  );
}
