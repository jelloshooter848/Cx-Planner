import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHROME, TRAFFIC_LIGHT_POSITION } from '../src/shared/chrome.js';

const css = readFileSync(new URL('../src/renderer/tokens.css', import.meta.url), 'utf8');
const token = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();

describe('window chrome constants', () => {
  it('match the design tokens', () => {
    expect(token('--bg-app')).toBe(CHROME.background);
    expect(token('--bg-chrome')).toBe(CHROME.titleBar);
    expect(token('--ink-inverse-muted')).toBe(CHROME.titleBarSymbol);
    expect(token('--titlebar-h')).toBe(`${CHROME.titleBarHeight}px`);
  });

  it('centres the macOS traffic lights in the title bar', () => {
    expect(TRAFFIC_LIGHT_POSITION.y * 2 + 14).toBe(CHROME.titleBarHeight);
  });
});
