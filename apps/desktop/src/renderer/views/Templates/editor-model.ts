/**
 * Plain helpers for the template editor (no React), so they can be unit-tested. The
 * template edits themselves (add, remove, move tasks, predecessor text, preview) are in
 * @cx/core template-edit.ts.
 */
import { validateTemplate, type Asset, type Template, type TemplateProblem, type TemplateProblemCode } from '@cx/core';

/** A problem shown in the editor: a template rule, or a missing name. */
export interface EditorProblem extends Omit<TemplateProblem, 'code'> {
  code: TemplateProblemCode | 'empty-name';
}

/** True when two templates hold the same content (and id, name, version). */
export function sameTemplate(a: Template, b: Template): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Trims names and drops empty list entries (stages, documents, certifications, checklist lines) before saving. */
export function cleanTemplate(t: Template): Template {
  const list = (items: string[]) => items.map((s) => s.trim()).filter((s) => s !== '');
  return {
    ...t,
    name: t.name.trim(),
    assetDescription: t.assetDescription.trim(),
    stages: list(t.stages),
    requiredDocs: list(t.requiredDocs),
    tasks: t.tasks.map((task) => ({
      ...task,
      name: task.name.trim(),
      trade: task.trade.trim(),
      requiredCerts: list(task.requiredCerts),
      checklist: task.checklist.map((c) => ({ ...c, text: c.text.trim() })).filter((c) => c.text !== ''),
    })),
  };
}

/**
 * Everything that stops a template being saved: the rules in validateTemplate plus a name
 * on the template and on every task. Checked on the cleaned template.
 */
export function templateProblems(t: Template): EditorProblem[] {
  const c = cleanTemplate(t);
  const problems: EditorProblem[] = [];
  if (c.name === '') problems.push({ code: 'empty-name', message: 'The template needs a name' });
  c.tasks.forEach((task, i) => {
    if (task.name === '') problems.push({ code: 'empty-name', message: `Task ${i + 1} needs a name`, taskKey: task.key });
  });
  const label = new Map(c.tasks.map((task, i) => [task.key, `${i + 1} ${task.name || '(no name)'}`]));
  for (const p of validateTemplate(c)) {
    // Keys mean nothing to the user; name loops by row number and task name.
    const loop = p.code === 'cycle' ? CYCLE_PREFIX.exec(p.message) : null;
    if (loop) {
      const rows = loop[1]!.split(', ').map((k) => label.get(k) ?? k);
      problems.push({ ...p, message: `Predecessor loop between tasks ${rows.join(', ')}` });
    } else {
      problems.push(p);
    }
  }
  return problems;
}

const CYCLE_PREFIX = /^Predecessor loop between tasks: (.*)$/;

/** `base`, or `base 2`, `base 3` ... whichever no name in `taken` uses (compared without case). */
export function uniqueName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  let n = 2;
  while (used.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

/** Assets of the project made from the template. */
export function assetsUsing(assets: readonly Asset[] | undefined, templateId: string): Asset[] {
  return (assets ?? []).filter((a) => a.templateId === templateId);
}

/** "one", "two" ... "ten", then digits, for the "Three existing assets use this template" note. */
export function countWord(n: number): string {
  const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  return words[n] ?? String(n);
}

/** The editor's working copy of one template, with its own undo history. */
export interface Draft {
  /** The template as stored in the workspace. */
  base: Template;
  /** What the editor shows; differs from base until saved. */
  draft: Template;
  selectedKey: string | null;
  /** Earlier drafts, oldest first (Ctrl+Z goes back through them). */
  past: Template[];
  /** Drafts undone, next first (Ctrl+Y). */
  future: Template[];
  /**
   * Coalesce key of the last edit (e.g. "name:<taskKey>"), or null. Typing in one field
   * makes one undo step, not one per keystroke.
   */
  lastEdit: string | null;
}

/** How many template edits Ctrl+Z can go back. */
export const DRAFT_UNDO_LIMIT = 100;

/** A clean draft of `t` (just opened or saved): no history. */
export function freshDraft(t: Template, selectedKey: string | null = t.tasks[0]?.key ?? null): Draft {
  return { base: t, draft: t, selectedKey, past: [], future: [], lastEdit: null };
}

/**
 * `d` with `draft` as its new content, the old one kept for undo. Edits with the same
 * `coalesce` key in a row (keystrokes in one text field) share one undo step: only the
 * content before the first of them is kept.
 */
export function editDraft(d: Draft, draft: Template, selectedKey: string | null = d.selectedKey, coalesce: string | null = null): Draft {
  if (draft === d.draft) return { ...d, selectedKey };
  const merge = coalesce !== null && coalesce === d.lastEdit && d.past.length > 0;
  const past = merge ? d.past : [...d.past, d.draft].slice(-DRAFT_UNDO_LIMIT);
  return { ...d, draft, selectedKey, past, future: [], lastEdit: coalesce };
}

/** Steps the draft back (or forward) one edit; null when there is nothing to step to. */
export function stepDraft(d: Draft, dir: 'undo' | 'redo'): Draft | null {
  const from = dir === 'undo' ? d.past : d.future;
  const to = from === d.past ? from[from.length - 1] : from[0];
  if (!to) return null;
  const selectedKey = d.selectedKey && to.tasks.some((t) => t.key === d.selectedKey) ? d.selectedKey : (to.tasks[0]?.key ?? null);
  return dir === 'undo'
    ? { ...d, draft: to, selectedKey, past: d.past.slice(0, -1), future: [d.draft, ...d.future], lastEdit: null }
    : { ...d, draft: to, selectedKey, past: [...d.past, d.draft], future: d.future.slice(1), lastEdit: null };
}

/** Status bar line for the Templates view, e.g. "Library: 8 starters · 1 custom". */
export function libraryStatus(list: ReadonlyArray<{ kind: string }> | null): { left: string; right: string } {
  const right = 'Template library stored in the workspace · Export to share';
  if (!list) return { left: 'Library: loading…', right };
  const starters = list.filter((t) => t.kind === 'starter').length;
  return { left: `Library: ${starters} ${starters === 1 ? 'starter' : 'starters'} · ${list.length - starters} custom`, right };
}
