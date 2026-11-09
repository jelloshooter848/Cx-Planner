import type { ReadinessState } from '@cx/core';

/**
 * Grayscale-safe readiness symbols. Every state differs in shape, not just colour:
 * ready = filled circle, progress = half-filled circle, needed = open circle,
 * N/A = dash, blocked = square with "!".
 */
export function timesSymbol(state: ReadinessState, cx: number, cy: number, r: number, ink = '#111'): string {
  const sw = Math.max(1, r * 0.28);
  switch (state) {
    case 'ready':
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${ink}"/>`;
    case 'progress':
      return (
        `<circle cx="${cx}" cy="${cy}" r="${r - sw / 2}" fill="#fff" stroke="${ink}" stroke-width="${sw}"/>` +
        `<path d="M${cx} ${cy - r} A${r} ${r} 0 0 0 ${cx} ${cy + r} Z" fill="${ink}"/>`
      );
    case 'needed':
      return `<circle cx="${cx}" cy="${cy}" r="${r - sw / 2}" fill="#fff" stroke="${ink}" stroke-width="${sw}"/>`;
    case 'na':
      return `<line x1="${cx - r * 0.8}" y1="${cy}" x2="${cx + r * 0.8}" y2="${cy}" stroke="${ink}" stroke-width="${sw}"/>`;
    case 'blocked': {
      const s = r * 1.8;
      return (
        `<rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" fill="${ink}"/>` +
        `<rect x="${cx - s * 0.07}" y="${cy - s * 0.34}" width="${s * 0.14}" height="${s * 0.42}" fill="#fff"/>` +
        `<rect x="${cx - s * 0.07}" y="${cy + s * 0.17}" width="${s * 0.14}" height="${s * 0.14}" fill="#fff"/>`
      );
    }
  }
}

/** Diamond for holds (filled), witness points (open) and milestones (filled). */
export function diamond(cx: number, cy: number, r: number, filled: boolean, ink = '#111'): string {
  const d = `M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z`;
  return filled
    ? `<path d="${d}" fill="${ink}"/>`
    : `<path d="${d}" fill="#fff" stroke="${ink}" stroke-width="1.6"/>`;
}
