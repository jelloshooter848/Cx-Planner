/**
 * Lays out the prints the Print dialog makes (look-ahead, full schedule, test sheets) as one
 * HTML document each, with the revision block filled from the project's print records.
 * No Electron here, so it can be unit-tested; ./print.ts turns the HTML into a PDF.
 */
import { computeSchedule, taskChecklists, type Project, type ScheduleResult, type Template } from '@cx/core';
import {
  layoutSchedulePrint,
  layoutTestSheet,
  lookAheadTitle,
  lookAheadWindow,
  nextRevision,
  printDocumentHtml,
  revisionLetter,
  type Paper,
  type PaperId,
  type PrintDocument,
  type RevisionEntry,
} from '@cx/render';
import type { PrintRecord } from '@cx/storage';
import { PRINT_KINDS, type ChecklistTaskSummary, type PrintKind, type PrintRecordSummary, type PrintRequest, type PrintSetup } from '../shared/api.js';
import { InputError } from './session.js';

export interface BuildPrintInput {
  project: Project;
  /** Template snapshots stored in the project (test-sheet checklists come from these). */
  templates: readonly Template[];
  /** Every print issued from this project, oldest first. */
  history: readonly PrintRecord[];
  request: PrintRequest;
  fontCss?: string;
}

/** A print laid out with the revision it gets when issued. */
export interface BuiltPrint {
  kind: PrintKind;
  html: string;
  title: string;
  rev: string;
  /** The revision note, trimmed ('' for none). */
  note: string;
  /** Issued date: the project's data date. */
  issued: string;
  paper: Paper;
  paperId: PaperId;
  sheets: number;
  /** Test sheets: the tasks printed, recorded so each sheet counts its own revisions. */
  taskIds?: string[];
}

const isKind = (k: string): k is PrintKind => (PRINT_KINDS as readonly string[]).includes(k);

export function printRecordSummary(r: PrintRecord): PrintRecordSummary | null {
  if (!isKind(r.kind)) return null;
  return { id: r.id, kind: r.kind, rev: r.rev, issued: r.issued, printedAt: r.printedAt, paper: r.paper, sheets: r.sheets, note: r.note, title: r.title };
}

/** The revision the next print of `kind` gets: one after the highest issued. */
export function nextRevisionFor(history: readonly PrintRecord[], kind: PrintKind): string {
  return nextRevision(history.filter((r) => r.kind === kind).map((r) => r.rev));
}

/**
 * The revision a test sheet for `taskId` gets: one letter on from the number of earlier
 * test-sheet prints that covered that task, so a task's first sheet is always "A" whatever
 * else was printed before. Prints recorded without a task list (files from before schema 6)
 * cannot be told apart and are not counted.
 */
export function sheetRevision(history: readonly PrintRecord[], taskId: string): string {
  const issued = history.filter((r) => r.kind === 'test-sheets' && r.taskIds?.includes(taskId)).length;
  return revisionLetter(issued);
}

export function printSetup(project: Project, templates: readonly Template[], history: readonly PrintRecord[]): PrintSetup {
  const checklistTasks: ChecklistTaskSummary[] = taskChecklists(project, templates).map((c) => ({
    taskId: c.task.id,
    assetId: c.asset.id,
    code: c.task.code,
    name: c.task.name,
    testForm: c.templateTask.testForm ?? null,
    items: c.templateTask.checklist.length,
  }));
  const nextRev = Object.fromEntries(PRINT_KINDS.map((k) => [k, nextRevisionFor(history, k)])) as Record<PrintKind, string>;
  return {
    dataDate: project.dataDate,
    history: history.map(printRecordSummary).filter((r): r is PrintRecordSummary => r !== null),
    nextRevision: nextRev,
    checklistTasks,
    untrackedTestSheets: history.some((r) => r.kind === 'test-sheets' && r.taskIds === null),
  };
}

/** Asset ids to print: null for all, else those of `ids` that exist (at least one). */
function pickAssets(project: Project, ids: readonly string[] | null): string[] | undefined {
  if (ids === null) return undefined;
  const known = new Set(project.assets.map((a) => a.id));
  const picked = ids.filter((id) => known.has(id));
  if (picked.length === 0) throw new InputError('Choose at least one asset to print');
  return picked;
}

/** Sheets show this many revisions, the one being issued included. */
const REVISIONS_SHOWN = 3;

/**
 * The last two earlier revisions of this kind (in issue order, by record id) plus the one being
 * issued, for the sheets' revision history. Capping here keeps the current revision on its own
 * sheet even when the data date moved back before an earlier issue. A blank note reads "Issued".
 */
export function revisionHistory(history: readonly PrintRecord[], kind: PrintKind, current: RevisionEntry): RevisionEntry[] {
  const earlier = history
    .filter((r) => r.kind === kind)
    .sort((a, b) => a.id - b.id)
    .slice(-(REVISIONS_SHOWN - 1))
    .map((r) => ({ rev: r.rev, date: r.issued, note: r.note }));
  return [...earlier, current].map((r) => ({ ...r, note: r.note || 'Issued' }));
}

function scheduleOf(project: Project): ScheduleResult {
  try {
    return computeSchedule(project);
  } catch (e) {
    throw new InputError(`The schedule cannot be computed: ${(e as Error).message}`);
  }
}

export function buildPrint(input: BuildPrintInput): BuiltPrint {
  const { project, history, request: req } = input;
  const rev = nextRevisionFor(history, req.kind);
  const issued = project.dataDate;
  const note = req.note.trim();
  const revisions = revisionHistory(history, req.kind, { rev, date: issued, note });
  let doc: PrintDocument;
  let title: string;
  let paperId: PaperId;
  let taskIds: string[] | undefined;

  switch (req.kind) {
    case 'lookahead': {
      const schedule = scheduleOf(project);
      const window = lookAheadWindow(req.start, req.weeks, schedule.calendar);
      title = lookAheadTitle(window, req.weeks);
      paperId = req.paper;
      doc = layoutSchedulePrint({
        project, schedule, paper: req.paper, title, window,
        assetIds: pickAssets(project, req.assetIds), showTimes: req.showTimes,
        revision: { rev, issued }, revisions,
      });
      break;
    }
    case 'full-schedule': {
      title = 'Full Commissioning Schedule';
      paperId = req.paper;
      doc = layoutSchedulePrint({
        project, schedule: scheduleOf(project), paper: req.paper, title,
        assetIds: pickAssets(project, req.assetIds),
        ...(req.dayWidthIn !== null ? { dayWidthIn: req.dayWidthIn } : {}),
        revision: { rev, issued }, revisions,
      });
      break;
    }
    case 'test-sheets': {
      const wanted = new Set(req.taskIds);
      const chosen = taskChecklists(project, input.templates).filter((c) => wanted.has(c.task.id));
      if (chosen.length === 0) throw new InputError('Choose at least one task with a checklist');
      let schedule: ScheduleResult | null = null;
      try {
        schedule = computeSchedule(project);
      } catch {
        // Planned dates are left blank on the sheets.
      }
      const pages: Array<{ number: number; svg: string }> = [];
      let paper: Paper | null = null;
      for (const c of chosen) {
        const planned = schedule?.tasks.get(c.task.id);
        const layout = layoutTestSheet({
          project, asset: c.asset, task: c.task,
          // Acceptance criteria come from the template snapshot the asset was made from.
          checklist: c.templateTask.checklist.map(({ id, text, acceptance }) => ({ id, text, ...(acceptance ? { acceptance } : {}) })),
          revision: { rev: sheetRevision(history, c.task.id), issued },
          sheetId: `${c.asset.tag}-${c.task.code}`,
          ...(c.templateTask.testForm ? { sheetName: c.templateTask.testForm } : {}),
          ...(planned ? { scheduled: { start: planned.start, finish: planned.finish } } : {}),
        });
        paper = layout.paper;
        for (const s of layout.sheets) pages.push({ number: pages.length + 1, svg: s.svg });
      }
      title = chosen.length === 1 ? `Test Sheet ${chosen[0]!.asset.tag} ${chosen[0]!.task.code}` : `Test Sheets (${chosen.length})`;
      paperId = 'letter';
      doc = { paper: paper!, sheets: pages };
      taskIds = chosen.map((c) => c.task.id);
      break;
    }
  }
  return {
    kind: req.kind,
    html: printDocumentHtml(doc, { title, fontCss: input.fontCss }),
    title,
    rev,
    note,
    issued,
    paper: doc.paper,
    paperId,
    sheets: doc.sheets.length,
    ...(taskIds ? { taskIds } : {}),
  };
}
