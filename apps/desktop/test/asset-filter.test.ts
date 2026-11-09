import { describe, expect, it } from 'vitest';
import type { Asset } from '@cx/core';
import { assetsInView, groupAssetsBySystem, matchesAssetQuery, NO_SYSTEM } from '../src/renderer/asset-filter.js';

const assets: Asset[] = [
  { id: 's1', tag: 'SWGR-1A', description: 'Switchgear', system: 'Normal power' },
  { id: 'u1', tag: 'UPS-1A', description: 'UPS', system: 'Critical power' },
  { id: 'x', tag: 'PNL-9', description: 'Panel' },
  { id: 's2', tag: 'SWGR-1B', description: 'Switchgear', system: 'Normal power' },
  { id: 'g1', tag: 'GEN-1', description: 'Generator', system: ' ' },
];

describe('asset filter', () => {
  it('matches tag or system, any case, every word', () => {
    expect(matchesAssetQuery(assets[0]!, '')).toBe(true);
    expect(matchesAssetQuery(assets[0]!, 'swgr')).toBe(true);
    expect(matchesAssetQuery(assets[0]!, 'NORMAL')).toBe(true);
    expect(matchesAssetQuery(assets[0]!, 'normal 1a')).toBe(true);
    expect(matchesAssetQuery(assets[0]!, 'critical')).toBe(false);
    // The description is not searched.
    expect(matchesAssetQuery(assets[0]!, 'switchgear')).toBe(false);
    expect(matchesAssetQuery(assets[2]!, 'pnl')).toBe(true);
  });

  it('says which assets are in view, or null for all', () => {
    expect(assetsInView(assets, '', [])).toBeNull();
    expect(assetsInView(assets, '  ', [])).toBeNull();
    expect(assetsInView(assets, 'swgr', [])).toEqual(['s1', 's2']);
    expect(assetsInView(assets, 'swgr', ['s2'])).toEqual(['s1']);
    expect(assetsInView(assets, '', ['u1', 'gone'])).toEqual(['s1', 'x', 's2', 'g1']);
    expect(assetsInView(assets, '', ['gone'])).toBeNull();
    expect(assetsInView(assets, 'nothing', [])).toEqual([]);
  });

  it('groups by system in project order, with no-system assets last', () => {
    const groups = groupAssetsBySystem(assets);
    expect(groups.map((g) => [g.system, g.assets.map((a) => a.id)])).toEqual([
      ['Normal power', ['s1', 's2']],
      ['Critical power', ['u1']],
      [NO_SYSTEM, ['x', 'g1']],
    ]);
    expect(groupAssetsBySystem([])).toEqual([]);
  });
});
