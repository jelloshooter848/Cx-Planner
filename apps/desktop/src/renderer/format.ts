/** Display formatting for the shell. Dates are ISO calendar dates (YYYY-MM-DD), no time zone. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? [Number(m[1]), month, Number(m[3])] : null;
}

/** "Nov 6, 2026". Unparseable input is returned unchanged. */
export function longDate(iso: string): string {
  const p = parts(iso);
  return p ? `${MONTHS[p[1] - 1]} ${p[2]}, ${p[0]}` : iso;
}

/** "Nov 6". Unparseable input is returned unchanged. */
export function shortDate(iso: string): string {
  const p = parts(iso);
  return p ? `${MONTHS[p[1] - 1]} ${p[2]}` : iso;
}

/** "1 asset", "9 assets". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Today in local time as YYYY-MM-DD. */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * When a recent file was last opened, in local time: "Today 2:14 PM", "Yesterday 9:05 AM",
 * or "Nov 6, 2026". Empty for null or an unreadable timestamp.
 */
export function lastOpenedText(
  iso: string | null,
  now = new Date(),
  formatTime: (d: Date) => string = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = todayIso(d);
  if (day === todayIso(now)) return `Today ${formatTime(d)}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (day === todayIso(yesterday)) return `Yesterday ${formatTime(d)}`;
  return longDate(day);
}

export interface StatusText {
  left: string;
  right: string;
  /** Tooltip on the right side: when the last edit was saved and the file revision. */
  savedDetail: string;
}

/** What the Schedule view's asset filter shows: how many assets and tasks are in view. */
export interface InView {
  assets: number;
  tasks: number;
}

/**
 * The status bar line, e.g. "9 assets · 19 tasks · Critical path ends Dec 7" / "Data as of Nov 6, 2026 · Saved".
 * With `inView` (the Schedule view's asset filter is set) the counts read "4 of 9 assets in view · 19 tasks".
 */
export function statusText(
  s: { project: { assets: unknown[]; tasks: unknown[]; dataDate: string } | null; projectFinish: string | null; scheduleError: string | null; revision: number; lastSavedAt: string | null; workspacePath: string | null },
  formatTime: (iso: string) => string = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  inView: InView | null = null,
): StatusText {
  const p = s.project;
  if (!p) return { left: 'No project open', right: s.workspacePath ? `Workspace: ${s.workspacePath}` : '', savedDetail: '' };
  const left = inView
    ? [`${inView.assets} of ${plural(p.assets.length, 'asset')} in view`, plural(inView.tasks, 'task')]
    : [plural(p.assets.length, 'asset'), plural(p.tasks.length, 'task')];
  if (s.scheduleError) left.push(`Schedule not computed: ${s.scheduleError}`);
  else if (s.projectFinish) left.push(`Critical path ends ${shortDate(s.projectFinish)}`);
  const savedDetail = `${s.lastSavedAt ? `Last edit saved at ${formatTime(s.lastSavedAt)}` : 'No edits this session'} · Revision ${s.revision}`;
  // "Saved" holds because the main process commits every edit (apply/undo/redo) to the file
  // before it pushes the new state. If saving ever becomes deferred or can fail after the push,
  // derive this word from a save-state field in AppState instead.
  return { left: left.join(' · '), right: `Data as of ${longDate(p.dataDate)} · Saved`, savedDetail };
}
