/**
 * Window chrome values the main process needs before the page loads (the window background
 * and the title bar overlay the OS draws its window buttons on). They must match the design
 * tokens in renderer/tokens.css; test/chrome.test.ts checks that they do.
 */
export const CHROME = {
  /** --bg-app */
  background: '#eef0f3',
  /** --bg-chrome */
  titleBar: '#1b1f24',
  /** --ink-inverse-muted */
  titleBarSymbol: '#c9ced6',
  /** --titlebar-h, in px */
  titleBarHeight: 36,
} as const;
