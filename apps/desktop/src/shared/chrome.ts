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

/** Height of the macOS traffic-light buttons, in px. */
const TRAFFIC_LIGHT_SIZE = 14;

/** Where macOS draws its traffic lights so they sit centred in the custom title bar. */
export const TRAFFIC_LIGHT_POSITION = {
  x: 14,
  y: Math.round((CHROME.titleBarHeight - TRAFFIC_LIGHT_SIZE) / 2),
} as const;
