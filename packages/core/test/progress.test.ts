import { describe, expect, it } from 'vitest';
import { assetProgress, weightedPercent } from '../src/index.js';

const t = (assetId: string, durationDays: number, percentComplete: number) => ({ assetId, durationDays, percentComplete });

describe('progress', () => {
  it('weights percent complete by duration', () => {
    expect(weightedPercent([t('a', 2, 100), t('a', 2, 100), t('a', 2, 50), t('a', 4, 0)])).toBe(50);
    expect(weightedPercent([t('a', 4, 50), t('a', 2, 0)])).toBeCloseTo(33.33, 2);
    // Zero-day tasks add nothing next to real work.
    expect(weightedPercent([t('a', 3, 100), t('a', 0, 0)])).toBe(100);
  });

  it('counts milestones equally when nothing has a duration, and handles odd input', () => {
    expect(weightedPercent([t('a', 0, 100), t('a', 0, 0)])).toBe(50);
    expect(weightedPercent([])).toBe(0);
    expect(weightedPercent([t('a', 2, 150), t('a', 2, -10)])).toBe(50);
    expect(weightedPercent([t('a', 2, Number.NaN)])).toBe(0);
  });

  it('works out every asset, including ones with no tasks', () => {
    const project = {
      assets: [{ id: 'a', tag: 'A', description: '' }, { id: 'b', tag: 'B', description: '' }, { id: 'c', tag: 'C', description: '' }],
      tasks: [
        { ...t('a', 2, 100), id: '1', code: '1.1', name: 'x', type: 'task' as const },
        { ...t('a', 6, 0), id: '2', code: '1.2', name: 'y', type: 'task' as const },
        { ...t('b', 1, 40), id: '3', code: '2.1', name: 'z', type: 'task' as const },
      ],
    };
    const p = assetProgress(project);
    expect(p.get('a')).toBe(25);
    expect(p.get('b')).toBe(40);
    expect(p.get('c')).toBe(0);
  });
});
