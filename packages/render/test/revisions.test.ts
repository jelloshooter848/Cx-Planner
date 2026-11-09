import { describe, expect, it } from 'vitest';
import { nextRevision, revisionIndex, revisionLetter } from '../src/index.js';

describe('revision letters', () => {
  it('counts A to Z, then AA', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(revisionLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });

  it('reads letters back', () => {
    for (const i of [0, 5, 25, 26, 100, 701]) expect(revisionIndex(revisionLetter(i))).toBe(i);
    expect(revisionIndex('b')).toBeNull();
    expect(revisionIndex('0')).toBeNull();
    expect(revisionIndex('IFC')).toBeNull();
  });

  it('follows the highest issued revision', () => {
    expect(nextRevision([])).toBe('A');
    expect(nextRevision(['A'])).toBe('B');
    expect(nextRevision(['A', 'C', 'B'])).toBe('D');
    expect(nextRevision(['Z'])).toBe('AA');
    expect(nextRevision(['IFC', '0'])).toBe('A');
  });

  it('refuses a negative index', () => {
    expect(() => revisionLetter(-1)).toThrow();
  });
});
