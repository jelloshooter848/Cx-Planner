/** Physical sheet sizes, landscape (width > height), in inches. */
export const PAPER = {
  letter: { id: 'letter', label: 'Letter', widthIn: 11, heightIn: 8.5 },
  tabloid: { id: 'tabloid', label: 'Tabloid', widthIn: 17, heightIn: 11 },
  'ansi-d': { id: 'ansi-d', label: 'ANSI D', widthIn: 34, heightIn: 22 },
  'arch-d': { id: 'arch-d', label: 'ARCH D', widthIn: 36, heightIn: 24 },
} as const;

export type PaperId = keyof typeof PAPER;
export type Paper = (typeof PAPER)[PaperId];

/** CSS pixels per inch. All print geometry is laid out in CSS px. */
export const PX_PER_IN = 96;
export const inch = (n: number): number => n * PX_PER_IN;
