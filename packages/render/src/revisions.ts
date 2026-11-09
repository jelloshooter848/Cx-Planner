/**
 * Revision letters of issued prints: A, B, … Z, then AA, AB, … (like spreadsheet columns).
 * Each print kind (look-ahead, full schedule, test sheets) counts its own revisions.
 */

/** The letter for a 0-based revision index: 0 → "A", 25 → "Z", 26 → "AA". */
export function revisionLetter(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid revision index ${index}`);
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** The 0-based index of a revision letter ("A" → 0, "AA" → 26), or null when it is not one (one or two capitals, so "IFC" is not). */
export function revisionIndex(rev: string): number | null {
  if (!/^[A-Z]{1,2}$/.test(rev)) return null;
  let n = 0;
  for (const c of rev) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * The revision after the highest one already issued: "A" for the first print, then "B", "C" …
 * Entries that are not revision letters (hand-typed "0", "IFC") are ignored.
 */
export function nextRevision(issued: Iterable<string>): string {
  let max = -1;
  for (const rev of issued) {
    const i = revisionIndex(rev);
    if (i !== null && i > max) max = i;
  }
  return revisionLetter(max + 1);
}
