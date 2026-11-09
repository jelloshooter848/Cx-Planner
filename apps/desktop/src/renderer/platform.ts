/** True on macOS (Cmd instead of Ctrl in shortcut hints and handling). */
export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
