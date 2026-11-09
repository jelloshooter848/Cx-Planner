import { useEffect, useState } from 'react';
import type { TemplateSummary } from '../../../shared/api';
import { plural } from '../../format';
import { useAppState, useStore } from '../../store';

/** The template library. For now the list only; the template editor fills the main area. */
export function TemplatesView() {
  const store = useStore();
  const app = useAppState();
  const [list, setList] = useState<TemplateSummary[] | null>(null);
  const workspace = app?.workspacePath ?? null;
  useEffect(() => {
    let live = true;
    void store.run(() => store.api.templates.list()).then((r) => live && setList(r.ok ? r.value : []));
    return () => {
      live = false;
    };
  }, [store, workspace]);
  const starters = list?.filter((t) => t.kind === 'starter') ?? [];
  const custom = list?.filter((t) => t.kind === 'custom') ?? [];
  const group = (title: string, items: TemplateSummary[]) => (
    <>
      <h2 className="section-label">{title}</h2>
      <ul className="side-list">
        {items.map((t) => (
          <li key={t.id} className="side-item">
            <span>{t.name}</span>
            <span className="muted small">{plural(t.taskCount, 'task')}</span>
          </li>
        ))}
        {items.length === 0 && <li className="side-item muted">None</li>}
      </ul>
    </>
  );
  return (
    <div className="view view-split" aria-label="Templates">
      <aside className="sidebar" aria-label="Template library">
        {list === null ? <p className="hint">Loading…</p> : (
          <>
            {group('Starter templates', starters)}
            {group('My templates', custom)}
          </>
        )}
      </aside>
      <main className="view-main">
        <div className="empty">
          <h2>Templates</h2>
          <p className="hint">The template editor will open here. Starters are editable copies stored in your workspace.</p>
        </div>
      </main>
    </div>
  );
}
