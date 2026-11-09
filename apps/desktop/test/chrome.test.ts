import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHROME } from '../src/shared/chrome.js';

const css = readFileSync(new URL('../src/renderer/tokens.css', import.meta.url), 'utf8');
const token = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();

describe('window chrome constants', () => {
  it('match the design tokens', () => {
    expect(token('--bg-app')).toBe(CHROME.background);
    expect(token('--bg-chrome')).toBe(CHROME.titleBar);
    expect(token('--ink-inverse-muted')).toBe(CHROME.titleBarSymbol);
    expect(token('--titlebar-h')).toBe(`${CHROME.titleBarHeight}px`);
  });
});
