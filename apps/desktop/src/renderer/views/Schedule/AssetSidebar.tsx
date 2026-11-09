/**
 * The Schedule view's "Assets in view" sidebar (01-Main): a filter box (tag or system), the
 * assets grouped by system with a tick box each (and one per system), and each asset's
 * duration-weighted percent complete. The ticks and the text make the renderer store's asset
 * filter, which the Gantt, the status bar and the Print dialog read.
 */
import { useEffect, useMemo, useRef } from 'react';
import { assetProgress, type Asset, type Project } from '@cx/core';
import { groupAssetsBySystem, matchesAssetQuery } from '../../asset-filter';
import { useSelect, useStore } from '../../store';
import { PanelCollapseButton } from './SidePanels';

/** `onCollapse` folds the sidebar to a strip (ScheduleView owns that state). */
export function AssetSidebar({ project, onCollapse }: { project: Project; onCollapse(): void }) {
  const store = useStore();
  const query = useSelect((s) => s.ui.assetQuery);
  const hiddenIds = useSelect((s) => s.ui.hiddenAssetIds);
  const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const progress = useMemo(() => assetProgress(project), [project]);
  const groups = useMemo(
    () =>
      groupAssetsBySystem(project.assets)
        .map((g) => ({ ...g, assets: g.assets.filter((a) => matchesAssetQuery(a, query)) }))
        .filter((g) => g.assets.length > 0),
    [project.assets, query],
  );

  return (
    <aside className="asset-sidebar" aria-label="Assets in view">
      <div className="asset-sidebar-filter">
        <div className="asset-sidebar-head">
          <label className="field-label" htmlFor="asset-filter-input">
            Assets in view
          </label>
          <PanelCollapseButton panel="assets" onToggle={onCollapse} />
        </div>
        <input
          id="asset-filter-input"
          className="input"
          type="search"
          placeholder="Filter by tag or system"
          value={query}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => store.setAssetQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.preventDefault();
              e.stopPropagation();
              store.setAssetQuery('');
            }
          }}
        />
      </div>
      <div className="asset-sidebar-list">
        {groups.length === 0 && <p className="hint asset-sidebar-empty">{project.assets.length === 0 ? 'No assets yet.' : 'No assets match the filter.'}</p>}
        {groups.map((g) => (
          <SystemGroup key={g.system} system={g.system} assets={g.assets} hidden={hidden} progress={progress} onShow={(ids, shown) => store.setAssetsShown(ids, shown)} />
        ))}
      </div>
    </aside>
  );
}

interface GroupProps {
  system: string;
  assets: Asset[];
  hidden: ReadonlySet<string>;
  progress: ReadonlyMap<string, number>;
  onShow(ids: string[], shown: boolean): void;
}

function SystemGroup({ system, assets, hidden, progress, onShow }: GroupProps) {
  const shownCount = assets.filter((a) => !hidden.has(a.id)).length;
  const all = shownCount === assets.length;
  const some = shownCount > 0 && !all;
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current) box.current.indeterminate = some;
  }, [some]);
  const ids = assets.map((a) => a.id);
  return (
    <section className="asset-group" aria-label={system}>
      <label className="asset-group-head">
        <input ref={box} type="checkbox" checked={all} aria-label={`Show all ${system} assets`} onChange={() => onShow(ids, !all)} />
        <span>{system}</span>
      </label>
      <ul className="asset-list">
        {assets.map((a) => {
          const pct = Math.round(progress.get(a.id) ?? 0);
          const shown = !hidden.has(a.id);
          return (
            <li key={a.id}>
              <label className={`asset-item${shown ? ' is-shown' : ''}`} data-asset-id={a.id} title={[a.tag, a.description, a.location].filter(Boolean).join(' · ')}>
                <input type="checkbox" checked={shown} aria-label={`${a.tag}, ${pct}% complete`} onChange={() => onShow([a.id], !shown)} />
                <span className="asset-item-tag">{a.tag}</span>
                <span className="asset-progress" aria-hidden="true">
                  <span style={{ width: `${pct}%` }} />
                </span>
                <span className="asset-pct" aria-hidden="true">
                  {pct}%
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
