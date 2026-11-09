/**
 * The interactive Gantt of the Schedule view (01-Main): a task table on the left and the
 * timeline on the right, in one scroll area. The table stays put when the timeline scrolls
 * sideways and the header stays put when the rows scroll.
 *
 * Only the rows in view are in the DOM, and the timeline is drawn as one SVG covering just
 * the visible window, so projects with thousands of tasks scroll smoothly.
 *
 * Selection: clicking a task row (or its bar) selects it; Up/Down, Page Up/Down, Home and
 * End move the selection while the grid has focus; Escape clears it. The selected task id
 * lives in the renderer store (ui.selectedTaskId) for the edit panel and other views.
 *
 * Editing: double-click a task's name or duration (or press F2 for the name) to edit it in
 * place; Enter or leaving the cell saves (one undo step), Escape cancels. Delete asks to
 * remove the selected task.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { parseIso, predecessorLabels, TIMES_KEYS, type Id, type Project, type TimesKey } from '@cx/core';
import type { TaskScheduleSummary } from '../../../shared/api';
import { ReadinessSymbol } from '../../components/Symbols';
import { shortDate } from '../../format';
import { useSelect, useStore } from '../../store';
import { parseDuration } from './task-fields';
import { GanttBars, GanttHeaderTime, HEAD_BOTTOM_H, HEAD_H, HEAD_TOP_H, ROW_H } from './GanttBars';
import { GanttLegend } from './GanttLegend';
import { buildRows, dateAtX, headerTicks, makeScale, moveSelection, rowIndexOfTask, scrollToRow, visibleRows, visibleSpan, weekendDays, xOf, type GanttRow } from './gantt-layout';

/** Table columns, left to right (widths in px). */
const COLUMNS = [
  { key: 'id', label: 'ID', width: 58 },
  { key: 'task', label: 'Task', width: 222 },
  { key: 'dur', label: 'Dur', width: 44, num: true },
  { key: 'start', label: 'Start', width: 60 },
  { key: 'pct', label: '%', width: 52, num: true },
  { key: 'pred', label: 'Pred', width: 66 },
  { key: 'times', label: 'T I M E S', width: 112 },
] as const;
export const TABLE_W = COLUMNS.reduce((n, c) => n + c.width, 0);
const TIMES_NAME: Record<TimesKey, string> = { T: 'Tools', I: 'Information', M: 'Materials', E: 'Expectations', S: 'Safety' };
/** Table cells that can be edited in place. */
type EditField = 'name' | 'dur';
const W = Object.fromEntries(COLUMNS.map((c) => [c.key, c.width])) as Record<(typeof COLUMNS)[number]['key'], number>;

interface Viewport {
  top: number;
  left: number;
  width: number;
  height: number;
  /** False until the scroll area has been read once; the default size is only a guess. */
  measured: boolean;
}

export interface GanttViewProps {
  project: Project;
  schedule: Record<Id, TaskScheduleSummary>;
  /** Only show these assets; null shows all. */
  assetIds?: ReadonlySet<Id> | null;
}

export function GanttView({ project, schedule, assetIds = null }: GanttViewProps) {
  const store = useStore();
  const zoom = useSelect((s) => s.ui.scheduleZoom);
  const selectedId = useSelect((s) => s.ui.selectedTaskId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<Viewport>({ top: 0, left: 0, width: 1200, height: 800, measured: false });
  const [editing, setEditing] = useState<{ id: Id; field: EditField } | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  // Follow the scroll position (once per frame) and the size of the scroll area.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      setVp((p) =>
        p.measured && p.top === el.scrollTop && p.left === el.scrollLeft && p.width === el.clientWidth && p.height === el.clientHeight
          ? p
          : { top: el.scrollTop, left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight, measured: true },
      );
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const rows = useMemo(() => buildRows(project, schedule, assetIds), [project, schedule, assetIds]);
  const preds = useMemo(() => predecessorLabels(project), [project]);
  const timelineView = Math.max(0, vp.width - TABLE_W);
  const scale = useMemo(() => makeScale(project, schedule, zoom, timelineView), [project, schedule, zoom, timelineView]);
  // Ticks and weekend shading for the whole scale, worked out once per scale rather than on
  // every scroll step; the drawings pick out the ones in view.
  const ticks = useMemo(() => headerTicks(scale), [scale]);
  const weekendXs = useMemo(() => (scale.zoom === 'day' ? weekendDays(scale).map((d) => xOf(scale, d)) : []), [scale]);

  // When the zoom changes, keep the date at the left edge of the timeline in place.
  const lastScale = useRef(scale);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const prev = lastScale.current;
    lastScale.current = scale;
    if (!el || prev.zoom === scale.zoom) return;
    el.scrollLeft = Math.max(0, xOf(scale, dateAtX(prev, el.scrollLeft)));
  }, [scale]);

  // On first show, bring the data date into view if it is off to the right. Wait for the
  // real size of the scroll area so the threshold uses the measured width.
  const scrolledToDataDate = useRef(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !vp.measured || scrolledToDataDate.current || timelineView === 0) return;
    scrolledToDataDate.current = true;
    const x = xOf(scale, project.dataDate);
    if (x > timelineView * 0.6) el.scrollLeft = x - 7 * scale.dayWidth;
  }, [scale, project.dataDate, timelineView, vp.measured]);

  const bodyH = vp.height - HEAD_H;
  const [first, last] = visibleRows(vp.top, bodyH, ROW_H, rows.length);
  const [x0, x1] = visibleSpan(vp.left, timelineView, scale.width);
  const selectedIndex = rowIndexOfTask(rows, selectedId);
  const totalW = TABLE_W + scale.width;
  const dataDateX = xOf(scale, project.dataDate);

  const select = useCallback(
    (id: Id | null, reveal: boolean) => {
      store.selectTask(id);
      const el = scrollRef.current;
      if (!reveal || !el || !id) return;
      const i = rowIndexOfTask(rows, id);
      if (i >= 0) el.scrollTop = scrollToRow(i, el.scrollTop, el.clientHeight, ROW_H, HEAD_H);
      // Bring the task's bar into view too when it is off to either side.
      const s = schedule[id];
      const view = el.clientWidth - TABLE_W;
      if (s && view > 0) {
        const a = xOf(scale, s.start);
        const b = xOf(scale, parseIso(s.finish) + 1);
        if (a < el.scrollLeft || b > el.scrollLeft + view) el.scrollLeft = Math.max(0, a - 7 * scale.dayWidth);
      }
    },
    [store, rows, schedule, scale],
  );

  /** Ends an in-place edit: saves `text` (null = cancelled), then gives focus back to the grid if the edit ended by key. */
  const finishEdit = useCallback(
    (id: Id, field: EditField, text: string | null, byKey: boolean) => {
      setEditing(null);
      if (byKey) scrollRef.current?.focus({ preventScroll: true });
      const task = projectRef.current.tasks.find((t) => t.id === id);
      if (text === null || !task) return;
      if (field === 'name') {
        const name = text.trim();
        if (name === task.name) return;
        if (name === '') return store.notify('A task needs a name');
        void store.run(() => store.api.apply({ kind: 'updateTask', id, patch: { name } }));
      } else {
        const p = parseDuration(text);
        if (!p.ok) return store.notify(`${task.code}: ${p.error}`);
        if (p.value !== task.durationDays) void store.run(() => store.api.apply({ kind: 'updateTask', id, patch: { durationDays: p.value } }));
      }
    },
    [store],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Keys typed in an in-place editor are its own.
    if (e.target !== e.currentTarget) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (selectedId && (e.key === 'Delete' || e.key === 'F2')) {
      e.preventDefault();
      if (e.key === 'Delete') void store.dispatch({ type: 'delete-task' });
      else if (selectedIndex >= 0) {
        // Bring the row into view first: only rows in view are drawn, so only they can hold the editor.
        select(selectedId, true);
        setEditing({ id: selectedId, field: 'name' });
      }
      return;
    }
    const page = Math.max(1, Math.floor(bodyH / ROW_H) - 1);
    const moves: Record<string, number | 'home' | 'end'> = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page, Home: 'home', End: 'end' };
    const move = moves[e.key];
    if (move !== undefined) {
      e.preventDefault();
      select(moveSelection(rows, selectedId, move), true);
    } else if (e.key === 'Escape' && selectedId) {
      e.preventDefault();
      select(null, false);
    }
  };

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const hit = (e.target as Element).closest('[data-task-id]');
    const id = hit?.getAttribute('data-task-id');
    if (id) select(id, false);
  };

  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    const field = target.closest('[data-edit]')?.getAttribute('data-edit') as EditField | null | undefined;
    const id = target.closest('.gantt-row[data-task-id]')?.getAttribute('data-task-id');
    if (!field || !id) return;
    select(id, false);
    setEditing({ id, field });
  };

  return (
    <div className="gantt" style={{ '--gantt-table-w': `${TABLE_W}px` } as CSSProperties}>
      <div
        ref={scrollRef}
        className="gantt-scroll"
        role="grid"
        aria-label="Tasks"
        aria-rowcount={rows.length + 1}
        aria-colcount={COLUMNS.length + 1}
        aria-activedescendant={selectedIndex >= first && selectedIndex < last && selectedId ? `gantt-row-${selectedId}` : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-zoom={zoom}
        data-day-width={scale.dayWidth}
        data-timeline-width={scale.width}
      >
        <div className="gantt-canvas" style={{ width: totalW, height: HEAD_H + rows.length * ROW_H }}>
          <div className="gantt-head" role="rowgroup" style={{ width: totalW }}>
            <div className="gantt-head-cells" role="row" aria-rowindex={1}>
              <div style={{ height: HEAD_TOP_H }} />
              <div className="gantt-colheads" style={{ height: HEAD_BOTTOM_H }}>
                {COLUMNS.map((c) => (
                  <span key={c.key} role="columnheader" aria-label={c.key === 'times' ? 'Readiness: tools, information, materials, expectations, safety' : undefined} className={`gc gc-${c.key}${'num' in c ? ' num' : ''}`} style={{ width: c.width }}>
                    {c.key === 'times' ? TIMES_KEYS.map((k) => <span key={k}>{k}</span>) : c.label}
                  </span>
                ))}
                <span role="columnheader" className="sr-only">
                  Timeline
                </span>
              </div>
            </div>
            <div className="gantt-head-timeline" style={{ left: TABLE_W, width: scale.width }}>
              <GanttHeaderTime scale={scale} ticks={ticks} x0={x0} x1={x1} scrolled={vp.left} />
            </div>
          </div>

          <div className="gantt-body" role="rowgroup" style={{ height: rows.length * ROW_H }} onClick={onClick} onDoubleClick={onDoubleClick}>
            {rows.slice(first, last).map((row, k) => (
              <Row
                key={row.key}
                row={row}
                index={first + k}
                width={totalW}
                summary={row.kind === 'task' ? schedule[row.task.id] : undefined}
                pred={row.kind === 'task' ? (preds.get(row.task.id) ?? '') : ''}
                selected={row.kind === 'task' && row.task.id === selectedId}
                editing={row.kind === 'task' && editing?.id === row.task.id ? editing.field : null}
                onEditDone={finishEdit}
              />
            ))}
            <div className="gantt-timeline" style={{ left: TABLE_W, width: scale.width, height: rows.length * ROW_H }}>
              <GanttBars
                rows={rows}
                schedule={schedule}
                scale={scale}
                ticks={ticks}
                weekendXs={weekendXs}
                first={first}
                last={last}
                x0={x0}
                x1={x1}
                dataDateX={dataDateX >= 0 && dataDateX <= scale.width ? dataDateX : null}
                dataDateTitle={`Data date ${shortDate(project.dataDate)}`}
              />
            </div>
          </div>
        </div>
      </div>
      <GanttLegend />
    </div>
  );
}

interface RowProps {
  row: GanttRow;
  index: number;
  width: number;
  /** The task's schedule (task rows only). */
  summary: TaskScheduleSummary | undefined;
  /** The task's predecessor field (task rows only). */
  pred: string;
  selected: boolean;
  /** The cell being edited in place, if any. */
  editing: EditField | null;
  onEditDone: (id: Id, field: EditField, text: string | null, byKey: boolean) => void;
}

/** One table row; memoised so rows already in view are not redrawn on every scroll step. */
const Row = memo(function Row({ row, index, width, summary: s, pred, selected, editing, onEditDone }: RowProps) {
  const style = { top: index * ROW_H, width };
  if (row.kind === 'group') {
    const a = row.asset;
    const detail = [a.description, a.location].filter(Boolean).join(' · ');
    return (
      <div className="gantt-row is-group" role="row" aria-rowindex={index + 2} style={style} data-asset-id={a.id}>
        <div className="gantt-cells">
          <span role="gridcell" className="gc gc-id" style={{ width: W.id }}>
            {row.number}
          </span>
          <span role="gridcell" aria-colspan={COLUMNS.length - 1} className="gc gc-group" style={{ width: TABLE_W - W.id }}>
            <b className="gantt-tag">{a.tag}</b>
            {detail && <span className="gantt-asset-detail">{detail}</span>}
          </span>
        </div>
      </div>
    );
  }
  const t = row.task;
  const ready = t.readiness;
  return (
    <div
      id={`gantt-row-${t.id}`}
      className={`gantt-row is-task${selected ? ' is-selected' : ''}${s?.critical ? ' is-critical' : ''}`}
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      style={style}
      data-task-id={t.id}
    >
      <div className="gantt-cells">
        <span role="gridcell" className="gc gc-id" style={{ width: W.id }}>
          {t.code}
        </span>
        <span role="gridcell" className="gc gc-task" style={{ width: W.task }} title={editing === 'name' ? undefined : t.name} data-edit="name">
          {editing === 'name' ? <InlineEdit initial={t.name} label={`Name of task ${t.code}`} onDone={(v, k) => onEditDone(t.id, 'name', v, k)} /> : t.name}
        </span>
        <span role="gridcell" className="gc num gc-dur" style={{ width: W.dur }} data-edit="dur">
          {editing === 'dur' ? (
            <InlineEdit initial={String(t.durationDays)} label={`Duration of task ${t.code} in working days`} numeric onDone={(v, k) => onEditDone(t.id, 'dur', v, k)} />
          ) : (
            `${t.durationDays} d`
          )}
        </span>
        <span role="gridcell" className="gc" style={{ width: W.start }}>
          {s ? shortDate(s.start) : '—'}
        </span>
        <span role="gridcell" className="gc num" style={{ width: W.pct }}>
          {t.percentComplete}%
        </span>
        <span role="gridcell" className="gc gc-pred" style={{ width: W.pred }} title={pred || undefined}>
          {pred || '—'}
        </span>
        <span role="gridcell" className="gc gc-times" style={{ width: W.times }}>
          {ready ? TIMES_KEYS.map((k) => <ReadinessSymbol key={k} state={ready[k]} size={15} label={TIMES_NAME[k]} />) : null}
        </span>
      </div>
    </div>
  );
});

interface InlineEditProps {
  initial: string;
  label: string;
  numeric?: boolean;
  /** Called once: the text to save (null = cancelled), and whether a key (Enter/Escape) ended the edit. */
  onDone: (text: string | null, byKey: boolean) => void;
}

/** The in-place editor of a grid cell. Enter or blur saves, Escape cancels. */
function InlineEdit({ initial, label, numeric, onDone }: InlineEditProps) {
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef({ text, onDone });
  latest.current = { text, onDone };
  const finish = (value: string | null, byKey: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(value, byKey);
  };
  // Only rows in view are drawn: scrolling the row away removes the editor without a blur.
  // Save what was typed then, and give focus back to the grid rather than the page.
  // (The check waits a tick and asks whether the input left the page, so StrictMode's
  // trial unmount, which keeps the element, does not end the edit.)
  useEffect(() => {
    const el = input.current;
    return () => {
      queueMicrotask(() => {
        if (done.current || el?.isConnected) return;
        done.current = true;
        latest.current.onDone(latest.current.text, true);
      });
    };
  }, []);
  return (
    <input
      ref={input}
      className="gantt-edit"
      aria-label={label}
      value={text}
      inputMode={numeric ? 'numeric' : undefined}
      autoFocus
      autoComplete="off"
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(text, true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(null, true);
        }
      }}
      onBlur={() => finish(text, false)}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
