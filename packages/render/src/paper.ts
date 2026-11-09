/** Physical sheet sizes, landscape (width > height), in inches. */
export const PAPER = {
  letter: { id: 'letter', label: 'Letter', widthIn: 11, heightIn: 8.5 },
  tabloid: { id: 'tabloid', label: 'Tabloid', widthIn: 17, heightIn: 11 },
  'ansi-d': { id: 'ansi-d', label: 'ANSI D', widthIn: 34, heightIn: 22 },
  'arch-d': { id: 'arch-d', label: 'ARCH D', widthIn: 36, heightIn: 24 },
} as const;

export type PaperId = keyof typeof PAPER;

/** A sheet size as laid out. `PAPER` entries are landscape; `portrait()` turns one upright. */
export interface Paper {
  readonly id: PaperId;
  readonly label: string;
  readonly widthIn: number;
  readonly heightIn: number;
}

export type Orientation = 'landscape' | 'portrait';

export function orientationOf(paper: Paper): Orientation {
  return paper.heightIn > paper.widthIn ? 'portrait' : 'landscape';
}

/** The same sheet stood upright (height > width), e.g. Letter 8.5 × 11 in. */
export function portrait(paper: Paper): Paper {
  return orientationOf(paper) === 'portrait' ? paper : { ...paper, widthIn: paper.heightIn, heightIn: paper.widthIn };
}

/** CSS pixels per inch. All print geometry is laid out in CSS px. */
export const PX_PER_IN = 96;
export const inch = (n: number): number => n * PX_PER_IN;
