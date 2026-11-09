/**
 * The Schedule view's asset filter (the "Assets in view" sidebar) as plain functions: which
 * assets match the filter text, how the sidebar groups them, and which assets the Gantt
 * shows. Kept free of React so it can be unit-tested.
 */
import type { Asset, Id } from '@cx/core';

/** Sidebar heading for assets with no system. */
export const NO_SYSTEM = 'No system';

/**
 * True when the asset's tag or system contains every word of `query` (any case, any
 * order). An empty query matches every asset.
 */
export function matchesAssetQuery(asset: Pick<Asset, 'tag' | 'system'>, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = `${asset.tag} ${asset.system ?? ''}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

/**
 * The assets the Gantt shows, in project order: those matching `query` and not in `hidden`.
 * Null when that is every asset (no filter), so prints and views can tell "all" apart.
 */
export function assetsInView(assets: readonly Asset[], query: string, hidden: readonly Id[]): Id[] | null {
  if (query.trim() === '' && hidden.length === 0) return null;
  const off = new Set(hidden);
  const shown = assets.filter((a) => !off.has(a.id) && matchesAssetQuery(a, query)).map((a) => a.id);
  return shown.length === assets.length ? null : shown;
}

export interface SystemGroup {
  /** The system name, or NO_SYSTEM. */
  system: string;
  assets: Asset[];
}

/**
 * Assets grouped by system for the sidebar. Groups come in the order their first asset
 * appears in the project (assets with no system last); assets keep project order.
 */
export function groupAssetsBySystem(assets: readonly Asset[]): SystemGroup[] {
  const groups = new Map<string, Asset[]>();
  let none: Asset[] | null = null;
  for (const a of assets) {
    const system = a.system?.trim();
    if (!system) {
      (none ??= []).push(a);
      continue;
    }
    const list = groups.get(system);
    if (list) list.push(a);
    else groups.set(system, [a]);
  }
  const out = [...groups].map(([system, list]) => ({ system, assets: list }));
  if (none) out.push({ system: NO_SYSTEM, assets: none });
  return out;
}
