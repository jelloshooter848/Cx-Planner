import { WorkCalendar } from './calendar.js';
import { applyCommand, CommandError, tagKey, type Command, type NewAssetInput } from './commands.js';
import type { IsoDate, Project } from './model.js';
import { computeSchedule } from './schedule.js';
import type { Template } from './template.js';

/**
 * Helpers for the add-assets dialog (mockup 05): tag patterns, rows pasted from Excel,
 * duplicate-tag checks, building the `addAssetsFromTemplate` command and previewing it.
 * All pure; the dialog only wires them to inputs.
 */

/** Most tags one pattern may expand to, so a typo like "1..100000" cannot freeze the dialog. */
export const MAX_PATTERN_TAGS = 500;

export class TagPatternError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TagPatternError';
  }
}

/**
 * Expands a tag pattern with one "a..b" range into tags, in order:
 *
 * - "PNL-L1-01..12" -> PNL-L1-01 ... PNL-L1-12 (numbers keep the start's zero padding)
 * - "PNL-1..3" -> PNL-1, PNL-2, PNL-3
 * - "SWGR-1A..1D" or "SWGR-1A..D" -> SWGR-1A ... SWGR-1D (single letters, same case)
 *
 * The end names the trailing run (digits or one letter) to count to, optionally after
 * text that must repeat the characters just before the start's run ("1A..1D").
 * Text with no ".." is one tag (trimmed); empty text gives no tags.
 * Throws TagPatternError with a plain-language message when the pattern cannot be read,
 * counts backwards, or gives more than `max` tags.
 */
export function expandTagPattern(pattern: string, max = MAX_PATTERN_TAGS): string[] {
  const text = pattern.trim();
  if (text === '') return [];
  const at = text.indexOf('..');
  if (at < 0) return [text];
  if (text.indexOf('..', at + 2) >= 0) throw new TagPatternError(`"${text}" has more than one ".." range`);
  const left = text.slice(0, at).trim();
  const right = text.slice(at + 2).trim();
  if (left === '' || right === '') throw new TagPatternError(`"${text}" needs a start and an end, like PNL-01..12`);

  const endRun = /(\d+|[A-Za-z])$/.exec(right);
  if (!endRun) throw new TagPatternError(`"${text}" must end in a number or a letter`);
  const endHead = right.slice(0, endRun.index);
  const isNumber = /\d/.test(endRun[1]!);
  const startRun = (isNumber ? /\d+$/ : /[A-Za-z]$/).exec(left);
  if (!startRun || !left.slice(0, startRun.index).endsWith(endHead)) {
    throw new TagPatternError(`The end of "${text}" does not match its start`);
  }
  const prefix = left.slice(0, startRun.index);
  const from = startRun[0];
  const to = endRun[1]!;

  let values: string[];
  if (isNumber) {
    const a = Number(from);
    const b = Number(to);
    if (b < a) throw new TagPatternError(`"${text}" counts backwards`);
    if (b - a + 1 > max) throw new TagPatternError(`"${text}" makes ${b - a + 1} tags; at most ${max} at a time`);
    const width = from.length > 1 && from.startsWith('0') ? from.length : 0;
    values = [];
    for (let n = a; n <= b; n++) values.push(String(n).padStart(width, '0'));
  } else {
    const upper = (c: string) => c === c.toUpperCase();
    if (upper(from) !== upper(to)) throw new TagPatternError(`"${text}" mixes upper- and lower-case letters`);
    const a = from.charCodeAt(0);
    const b = to.charCodeAt(0);
    if (b < a) throw new TagPatternError(`"${text}" counts backwards`);
    values = [];
    for (let c = a; c <= b; c++) values.push(String.fromCharCode(c));
  }
  return values.map((v) => `${prefix}${v}`);
}

/** One asset row in the dialog. Empty strings mean "not given". */
export interface AssetRowInput {
  tag: string;
  description: string;
  location: string;
  system: string;
}

/**
 * Rows copied from Excel (or any tab-separated text): Tag, Description, Location, System
 * per line. Blank lines are skipped, and so is a first line whose first cell is "Tag"
 * (a header row). Missing cells are empty strings; cells are trimmed.
 */
export function parseAssetRows(text: string): AssetRowInput[] {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '');
  const rows = lines.map((line) => {
    const cells = line.split('\t').map(unquote);
    return { tag: cells[0] ?? '', description: cells[1] ?? '', location: cells[2] ?? '', system: cells[3] ?? '' };
  });
  if (rows[0] && /^tags?$/i.test(rows[0].tag)) rows.shift();
  return rows;
}

/** Excel quotes cells holding tabs, quotes or line breaks: "a ""b""" -> a "b". */
function unquote(cell: string): string {
  const c = cell.trim();
  if (c.length >= 2 && c.startsWith('"') && c.endsWith('"')) return c.slice(1, -1).replace(/""/g, '"').trim();
  return c;
}

/**
 * Problems with the tags of the rows to add, by row index: empty, used twice in the
 * dialog, or already used in the project (compared trimmed and case-insensitively, see
 * `tagKey`). Rows with no problem are missing from the map.
 */
export function findTagProblems(project: Pick<Project, 'assets'>, tags: string[]): Map<number, string> {
  const inProject = new Set(project.assets.map((a) => tagKey(a.tag)));
  const counts = new Map<string, number>();
  for (const t of tags) counts.set(tagKey(t), (counts.get(tagKey(t)) ?? 0) + 1);
  const problems = new Map<number, string>();
  tags.forEach((t, i) => {
    const key = tagKey(t);
    if (key === '') problems.set(i, 'Enter a tag');
    else if (inProject.has(key)) problems.set(i, `${t.trim()} is already in the project`);
    else if ((counts.get(key) ?? 0) > 1) problems.set(i, `${t.trim()} is listed more than once`);
  });
  return problems;
}

/**
 * The problem with renaming asset `assetId` to `tag`, or null when the tag can be used:
 * empty, or already used by another asset (trimmed, case-insensitive, see `tagKey`).
 * Changing only the case or spacing of the asset's own tag is fine.
 */
export function assetTagProblem(project: Pick<Project, 'assets'>, assetId: string, tag: string): string | null {
  const key = tagKey(tag);
  if (key === '') return 'An asset needs a tag';
  const other = project.assets.find((a) => a.id !== assetId && tagKey(a.tag) === key);
  return other ? `${tag.trim()} is already used by another asset` : null;
}

/** How the new assets are placed in time relative to each other. */
export type AssetSequence =
  /** All start as soon as allowed (at the start-no-earlier-than date). */
  | { kind: 'together' }
  /** Each asset's first task follows the previous asset's last task (finish-to-start). */
  | { kind: 'follow' }
  /** Each asset starts `days` working days after the previous one's start date. */
  | { kind: 'stagger'; days: number };

export interface AddAssetsPlan {
  template: Template;
  rows: AssetRowInput[];
  /** Start no earlier than this date. Required for a stagger. */
  startNoEarlierThan?: IsoDate;
  sequence: AssetSequence;
}

/**
 * The `addAssetsFromTemplate` command for the dialog's input. Tags and text are trimmed;
 * an empty description takes the template's asset description. With a stagger, asset i
 * (from 0) starts no earlier than `startNoEarlierThan` plus i × days working days on the
 * project calendar.
 */
export function buildAddAssetsCommand(project: Pick<Project, 'calendar'>, plan: AddAssetsPlan): Extract<Command, { kind: 'addAssetsFromTemplate' }> {
  const { sequence } = plan;
  if (sequence.kind === 'stagger' && (!Number.isInteger(sequence.days) || sequence.days < 0)) {
    throw new CommandError('invalid-field', 'Stagger must be a whole number of working days, 0 or more');
  }
  let snet: (i: number) => IsoDate | undefined = () => plan.startNoEarlierThan;
  if (sequence.kind === 'stagger' && plan.startNoEarlierThan !== undefined && sequence.days > 0) {
    const base = plan.startNoEarlierThan;
    const cal = new WorkCalendar(base, project.calendar);
    const first = cal.indexOf(base);
    snet = (i) => (i === 0 ? base : cal.dateAt(first + i * sequence.days));
  }
  const assets = plan.rows.map((row, i): NewAssetInput => {
    const a: NewAssetInput = { tag: row.tag.trim(), description: row.description.trim() || plan.template.assetDescription };
    if (row.location.trim() !== '') a.location = row.location.trim();
    if (row.system.trim() !== '') a.system = row.system.trim();
    const date = snet(i);
    if (date !== undefined) a.startNoEarlierThan = date;
    return a;
  });
  return {
    kind: 'addAssetsFromTemplate',
    template: plan.template,
    assets,
    ...(sequence.kind === 'follow' ? { followPrevious: true } : {}),
  };
}

export interface AddAssetsPreview {
  assets: number;
  tasks: number;
  /** Last working day of the new assets' tasks, or null when it cannot be computed. */
  finish: IsoDate | null;
  /** Project finish after the add, or null when it cannot be computed. */
  projectFinish: IsoDate | null;
  /** Why the command or the schedule failed, in plain language. */
  error: string | null;
}

/**
 * What applying `cmd` would do: counts, and the finish date from the core scheduler run
 * on the resulting copy of the project (the project itself is not changed).
 */
export function previewAddAssets(project: Project, cmd: Extract<Command, { kind: 'addAssetsFromTemplate' }>): AddAssetsPreview {
  const tasks = cmd.assets.length * cmd.template.tasks.length;
  const base: AddAssetsPreview = { assets: cmd.assets.length, tasks, finish: null, projectFinish: null, error: null };
  let next: Project;
  try {
    next = applyCommand(project, cmd).project;
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    const r = computeSchedule(next);
    const before = new Set(project.tasks.map((t) => t.id));
    // Like the project finish: the last working day before the latest early finish, so a
    // closing milestone counts as finishing with the task before it.
    let ef: number | null = null;
    for (const t of next.tasks) {
      if (before.has(t.id)) continue;
      const s = r.tasks.get(t.id);
      if (s && (ef === null || s.ef > ef)) ef = s.ef;
    }
    const finish = ef === null ? null : r.calendar.dateAt(Math.max(ef - 1, 0));
    return { ...base, finish, projectFinish: r.projectFinish };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
}
