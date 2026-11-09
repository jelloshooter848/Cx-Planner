/** Escape text for SVG/HTML. */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Approximate advance width of a string in the bundled Inter font, in px.
 * Good enough to truncate cell text without a layout engine; errs slightly wide.
 */
export function textWidth(s: string, fontSize: number, bold = false): number {
  let em = 0;
  for (const ch of s) {
    if (' '.includes(ch)) em += 0.28;
    else if ("iIl.,:;'|!()[]".includes(ch)) em += 0.3;
    else if ('mwMW@'.includes(ch)) em += 0.86;
    else if (/[A-Z0-9&%#]/.test(ch)) em += 0.66;
    else em += 0.55;
  }
  return em * fontSize * (bold ? 1.05 : 1);
}

/** Truncate with an ellipsis so that the text fits in `maxWidth` px. */
export function fit(s: string, maxWidth: number, fontSize: number, bold = false): string {
  if (textWidth(s, fontSize, bold) <= maxWidth) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textWidth(s.slice(0, mid) + '…', fontSize, bold) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? '' : s.slice(0, lo).trimEnd() + '…';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function shortDate(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
}

export function longDate(iso: string): string {
  return `${shortDate(iso)}, ${iso.slice(0, 4)}`;
}

export function weekdayLetter(iso: string): string {
  return WEEKDAY_LETTER[new Date(`${iso}T00:00:00Z`).getUTCDay()]!;
}
