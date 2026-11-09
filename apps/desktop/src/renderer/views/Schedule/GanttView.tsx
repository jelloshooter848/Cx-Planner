/**
 * The interactive Gantt of the Schedule view (01-Main): a task table on the left and the
 * timeline on the right, in one scroll area. The table stays put when the timeline scrolls
 * sideways and the header stays put when the rows scroll.
 *
 * Only the rows in view are in the DOM, and the timeline is drawn as one SVG covering just
 * the visible window, so projects with thousands of tasks scroll smoothly.
 *
 * Selection: clicking a task row (or its bar) selects it; Up/Down, Page Up/Down, Home and
 * End move the selection while the grid has focus; Escape clears it. Clicking an asset's
 * group row selects the asset instead (ui.selectedAssetId): the panel then edits the asset,
 * and Delete asks to delete it (the task panel's Edit asset button gets there from the
 * keyboard). The selected task id
 * lives in the renderer store (ui.selectedTaskId) for the edit panel and other views.
 * Ctrl+click (Cmd+click on macOS) adds a task to the selection, or takes it out
 * (ui.selectedTaskIds; the toolbar's Link tasks links the first two). Alt+Up / Alt+Down move
 * the selected task up or down inside its asset.
 *
 * The look-ahead window chosen on the toolbar is shaded behind the bars.
 *
 * Splitter: the line between the table and the timeline can be dragged (or moved with Left /
 * Right while focused; Home / End for the narrowest / widest table) and double-clicked to
 * reset. The Task column takes up the slack; the width is kept in ui.scheduleLayout.gridWidth.
 *
 * Editing: double-click a task's name or duration (or press F2 for the name) to edit it in
 * place; Enter or leaving the cell saves (one undo step), Escape cancels. Delete asks to
 * remove the selected task.
 *
 * Progress mode (toolbar toggle, ui.progressMode): the table shows % and actual start /
 * finish columns in place of Pred and TIMES, and those cells edit on a single click (or
 * Enter on the selected row). Enter saves and moves down, Tab / Shift+Tab move across (see
 * progress-grid.ts). Edits follow core's progress rules (ProgressEdit.tsx).
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { parseIso, predecessorLabels, TIMES_KEYS, type Id, type ProgressChange, type Project, type Task, type TimesKey } from '@cx/core';
import type { LookAheadWindow } from '@cx/render';
import type { TaskScheduleSummary } from '../../../shared/api';
import { ReadinessSymbol } from '../../components/Symbols';
import { shortDate } from '../../format';
import { useSelect, useStore } from '../../store';
import { useProgressEditor } from './ProgressEdit';
import { isProgressField, nextProgressCell, type CellMove, type ProgressField } from './progress-grid';
import { moveTaskAction } from './schedule-actions';
import { parseActualDate, parseDuration, parsePercent } from './task-fields';
import { GanttBars, GanttHeaderTime, HEAD_BOTTOM_H, HEAD_H, HEAD_TOP_H, ROW_H } from './GanttBars';
import { GanttLegend } from './GanttLegend';
import {
  buildRows,
  clampGridWidth,
  dateAtX,
  GRID_MIN_W,
  headerTicks,
  makeScale,
  maxGridWidth,
  moveSelection,
  rowIndexOfTask,
  scrollToRow,
  splitterKeyWidth,
  taskColumnWidth,
  visibleRows,
  visibleSpan,
  weekendDays,
  xOf,
  type GanttRow,
} from './gantt-layout';

type ColumnKey = 'id' | 'task' | 'dur' | 'start' | 'pct' | 'astart' | 'afinish' | 'pred' | 'times';
interface Column {
  key: ColumnKey;
  label: string;
  width: number;
  num?: boolean;
  /** Spoken name of the column header, when the label is not enough. */
  aria?: string;
}
/** Table columns, left to right (widths in px). */
const PLAN_COLUMNS: readonly Column[] = [
  { key: 'id', label: 'ID', width: 58 },
  { key: 'task', label: 'Task', width: 222 },
  { key: 'dur', label: 'Dur', width: 44, num: true },
  { key: 'start', label: 'Start', width: 60 },
  { key: 'pct', label: '%', width: 52, num: true },
  { key: 'pred', label: 'Pred', width: 66 },
  { key: 'times', label: 'T I M E S', width: 112, aria: 'Readiness: tools, information, materials, expectations, safety' },
];
/** Progress mode: actual dates in place of Pred and TIMES. */
const PROGRESS_COLUMNS: readonly Column[] = [
  ...PLAN_COLUMNS.slice(0, 5),
  { key: 'astart', label: 'Act start', width: 72, aria: 'Actual start' },
  { key: 'afinish', label: 'Act finish', width: 72, aria: 'Actual finish' },
];
const tableWidth = (cols: readonly Column[]) => cols.reduce((n, c) => n + c.width, 0);
const TIMES_NAME: Record<TimesKey, string> = { T: 'Tools', I: 'Information', M: 'Materials', E: 'Expectations', S: 'Safety' };
/** Table cells that can be edited in place. */
type EditField = 'name' | 'dur' | ProgressField;
/** How an in-place edit ended: a key, the input losing focus, or the row scrolling away. */
type EditEnd = 'enter' | 'tab' | 'back-tab' | 'escape' | 'blur' | 'gone';
const MOVES: Partial<Record<EditEnd, CellMove>> = { enter: 'down', tab: 'next', 'back-tab': 'prev' };
const W = Object.fromEntries(PROGRESS_COLUMNS.concat(PLAN_COLUMNS).map((c) => [c.key, c.width])) as Record<ColumnKey, number>;

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
  /** Dates to shade as the look-ahead window; null or left out shades nothing. */
  lookAhead?: LookAheadWindow | null;
}

export function GanttView({ project, schedule, assetIds = null, lookAhead = null }: GanttViewProps) {
  const store = useStore();
  const zoom = useSelect((s) => s.ui.scheduleZoom);
  const selectedId = useSelect((s) => s.ui.selectedTaskId);
  const selectedIdList = useSelect((s) => s.ui.selectedTaskIds);
  const selectedAssetId = useSelect((s) => s.ui.selectedAssetId);
  const selectedIds = useMemo(() => new Set(selectedIdList), [selectedIdList]);
  const progressMode = useSelect((s) => s.ui.progressMode);
  const naturalColumns = progressMode ? PROGRESS_COLUMNS : PLAN_COLUMNS;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<Viewport>({ top: 0, left: 0, width: 1200, height: 800, measured: false });
  // The table's width: the splitter's (while dragging, or as remembered) or the columns' own,
  // kept between the table's and the timeline's minimum widths. The Task column takes the slack.
  const savedGridW = useSelect((s) => s.ui.scheduleLayout.gridWidth);
  const [dragW, setDragW] = useState<number | null>(null);
  const tableW = clampGridWidth(dragW ?? savedGridW ?? tableWidth(naturalColumns), vp.width);
  const taskW = taskColumnWidth(tableW, tableWidth(naturalColumns) - W.task);
  const columns = useMemo(() => naturalColumns.map((c) => (c.key === 'task' ? { ...c, width: taskW } : c)), [naturalColumns, taskW]);
  const [editing, setEditing] = useState<{ id: Id; field: EditField } | null>(null);
  // Keyboard multi-select: Ctrl+Up/Down moves this row cursor without changing the selection,
  // Ctrl+Space adds or removes the cursor's task (as Ctrl+click does). Null follows the selection.
  const [cursorId, setCursorId] = useState<Id | null>(null);
  const progressModeRef = useRef(progressMode);
  progressModeRef.current = progressMode;
  const projectRef = useRef(project);
  projectRef.current = project;
  // When the grid's "Mark complete" prompt closes, keyboard entry carries on in the grid:
  // after a save the next % cell down opens, as after Enter.
  const progress = useProgressEditor(project, schedule, (task, saved) => {
    const cell = saved ? nextProgressCell(rowsRef.current, { id: task.id, field: 'pct' }, 'down') : null;
    if (cell && progressModeRef.current) {
      selectRef.current(cell.id, true);
      setEditing(cell);
    } else scrollRef.current?.focus({ preventScroll: true });
  });
  const progressRef = useRef(progress);
  progressRef.current = progress;

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
  const timelineView = Math.max(0, vp.width - tableW);
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
  const activeId = cursorId && rowIndexOfTask(rows, cursorId) >= 0 ? cursorId : selectedId;
  const activeIndex = rowIndexOfTask(rows, activeId);
  const totalW = tableW + scale.width;
  const dataDateX = xOf(scale, project.dataDate);
  const lookAheadSpan = useMemo((): [number, number] | null => {
    if (!lookAhead) return null;
    const a = Math.max(0, xOf(scale, lookAhead.start));
    const b = Math.min(scale.width, xOf(scale, parseIso(lookAhead.end) + 1));
    return b > a ? [a, b] : null;
  }, [scale, lookAhead]);

  /** Scrolls the task's row (and its bar) into view. */
  const reveal = useCallback(
    (id: Id) => {
      const el = scrollRef.current;
      if (!el) return;
      const i = rowIndexOfTask(rows, id);
      if (i >= 0) el.scrollTop = scrollToRow(i, el.scrollTop, el.clientHeight, ROW_H, HEAD_H);
      // Bring the task's bar into view too when it is off to either side.
      const s = schedule[id];
      const view = el.clientWidth - tableW;
      if (s && view > 0) {
        const a = xOf(scale, s.start);
        const b = xOf(scale, parseIso(s.finish) + 1);
        if (a < el.scrollLeft || b > el.scrollLeft + view) el.scrollLeft = Math.max(0, a - 7 * scale.dayWidth);
      }
    },
    [rows, schedule, scale, tableW],
  );

  const select = useCallback(
    (id: Id | null, show: boolean) => {
      setCursorId(null);
      store.selectTask(id);
      if (show && id) reveal(id);
    },
    [store, reveal],
  );
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const selectRef = useRef(select);
  selectRef.current = select;

  /**
   * Ends an in-place edit: saves `text` (null = cancelled), then gives focus back to the grid
   * if the edit ended by key. A progress cell ended by Enter or Tab opens the next cell instead.
   */
  const finishEdit = useCallback(
    (id: Id, field: EditField, text: string | null, end: EditEnd, changed: boolean) => {
      setEditing(null);
      const task = projectRef.current.tasks.find((t) => t.id === id);
      if (isProgressField(field)) {
        // An untouched cell saves nothing: its text may predate an edit still being saved
        // (Tab off a % entry opens the actual start before the start it fills in arrives).
        const ok = text === null || !changed || !task || saveProgressCellRef.current(task, field, text);
        const next = ok && text !== null ? MOVES[end] : undefined;
        const cell = next ? nextProgressCell(rowsRef.current, { id, field }, next) : null;
        if (cell) {
          selectRef.current(cell.id, true);
          setEditing(cell);
        } else if (end !== 'blur') scrollRef.current?.focus({ preventScroll: true });
        return;
      }
      if (end !== 'blur') scrollRef.current?.focus({ preventScroll: true });
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

  /** Saves a progress cell; false (with a notice) when the text or the change is refused or needs the finish prompt. */
  const saveProgressCell = (task: Task, field: ProgressField, text: string): boolean => {
    const s = schedule[task.id];
    let change: ProgressChange;
    if (field === 'pct') {
      const p = parsePercent(text);
      if (!p.ok) return fail(`${task.code}: ${p.error}`);
      if (p.value === task.percentComplete) return true;
      change = { percentComplete: p.value };
    } else {
      const key = field === 'astart' ? 'actualStart' : 'actualFinish';
      const p = parseActualDate(text, task[key] ?? s?.start ?? project.dataDate);
      if (!p.ok) return fail(`${task.code}: ${p.error}`);
      if (p.value === (task[key] ?? null)) return true;
      change = { [key]: p.value };
    }
    const r = progressRef.current.edit(task, change);
    // Clearing the actual start resets the task to not started, wiping its % and actual
    // finish too: say so, since one stray clear during weekly entry loses recorded progress.
    const resets = change.actualStart === null && r.outcome.kind === 'patch' && (task.percentComplete > 0 || task.actualFinish != null);
    void r.saved.then((m) => {
      if (m) store.notify(`${task.code}: ${m}`);
      else if (resets) store.notify(`${task.code} reset to not started (Ctrl+Z to undo)`);
    });
    return r.outcome.kind === 'patch';
  };
  const fail = (message: string) => {
    store.notify(message);
    return false;
  };
  // finishEdit stays the same function across renders (rows are memoised); it reaches the
  // current project and schedule through this ref.
  const saveProgressCellRef = useRef(saveProgressCell);
  saveProgressCellRef.current = saveProgressCell;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Keys typed in an in-place editor are its own.
    if (e.target !== e.currentTarget) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const a = moveTaskAction(projectRef.current, selectedId, e.key === 'ArrowUp' ? -1 : 1);
      if (a.ok) void store.run(() => store.api.apply(a.command));
      return;
    }
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
    if (mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const next = moveSelection(rows, activeId, e.key === 'ArrowUp' ? -1 : 1);
      if (next) {
        setCursorId(next);
        reveal(next);
      }
      return;
    }
    if (mod && e.key === ' ') {
      e.preventDefault();
      if (activeId) store.toggleTaskSelection(activeId);
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (progressMode && activeId && e.key === 'Enter' && activeIndex >= 0) {
      // Enter opens the % cell of the row under the keyboard cursor (the selected row unless
      // Ctrl+Up/Down moved the cursor), selecting it.
      e.preventDefault();
      select(activeId, true);
      setEditing({ id: activeId, field: 'pct' });
      return;
    }
    if (selectedAssetId && !selectedId && (e.key === 'Delete' || e.key === 'Escape')) {
      e.preventDefault();
      if (e.key === 'Delete') void store.dispatch({ type: 'delete-asset' });
      else store.selectAsset(null);
      return;
    }
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

  // ---- Splitter ----
  const drag = useRef<{ x: number; w: number } | null>(null);
  const onSplitDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    drag.current = { x: e.clientX, w: tableW };
    setDragW(tableW);
  };
  const onSplitMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) setDragW(clampGridWidth(d.w + e.clientX - d.x, vp.width));
  };
  const onSplitUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const w = clampGridWidth(d.w + e.clientX - d.x, vp.width);
    // A click without a move leaves the remembered width alone (it may be the default).
    if (w !== d.w) store.setScheduleLayout({ gridWidth: w });
    setDragW(null);
  };
  const onSplitKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const w = splitterKeyWidth(e.key, tableW, vp.width);
    if (w === null) return;
    e.preventDefault();
    store.setScheduleLayout({ gridWidth: w });
  };

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    const id = target.closest('[data-task-id]')?.getAttribute('data-task-id');
    if (!id) {
      const assetId = target.closest('.gantt-row.is-group[data-asset-id]')?.getAttribute('data-asset-id');
      if (assetId) {
        setCursorId(null);
        store.selectAsset(assetId);
      }
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setCursorId(id);
      store.toggleTaskSelection(id);
      return;
    }
    select(id, false);
    // In progress mode one click opens a progress cell.
    const field = target.closest('[data-edit]')?.getAttribute('data-edit');
    if (progressMode && field && isProgressField(field) && !(editing?.id === id && editing.field === field)) setEditing({ id, field });
  };

  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    const field = target.closest('[data-edit]')?.getAttribute('data-edit') as EditField | null | undefined;
    const id = target.closest('.gantt-row[data-task-id]')?.getAttribute('data-task-id');
    if (!field || !id || isProgressField(field)) return;
    select(id, false);
    setEditing({ id, field });
  };

  return (
    <div className={`gantt${progressMode ? ' is-progress-mode' : ''}${dragW !== null ? ' is-resizing' : ''}`} style={{ '--gantt-table-w': `${tableW}px` } as CSSProperties}>
      <div className="gantt-main">
        <div
          ref={scrollRef}
          id="gantt-scroll"
          className="gantt-scroll"
          role="grid"
          aria-label="Tasks"
          aria-rowcount={rows.length + 1}
          aria-colcount={columns.length + 1}
          aria-activedescendant={activeIndex >= first && activeIndex < last && activeId ? `gantt-row-${activeId}` : undefined}
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
                  {columns.map((c) => (
                    <span key={c.key} role="columnheader" aria-label={c.aria} className={`gc gc-${c.key}${c.num ? ' num' : ''}`} style={{ width: c.width }}>
                      {c.key === 'times' ? TIMES_KEYS.map((k) => <span key={k}>{k}</span>) : c.label}
                    </span>
                  ))}
                  <span role="columnheader" className="sr-only">
                    Timeline
                  </span>
                </div>
              </div>
              <div className="gantt-head-timeline" style={{ left: tableW, width: scale.width }}>
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
                  columns={columns}
                  tableWidth={tableW}
                  taskWidth={taskW}
                  progressMode={progressMode}
                  summary={row.kind === 'task' ? schedule[row.task.id] : undefined}
                  pred={row.kind === 'task' ? (preds.get(row.task.id) ?? '') : ''}
                  selected={row.kind === 'task' ? selectedIds.has(row.task.id) : row.asset.id === selectedAssetId}
                  cursor={row.kind === 'task' && cursorId !== null && row.task.id === cursorId}
                  editing={row.kind === 'task' && editing?.id === row.task.id ? editing.field : null}
                  onEditDone={finishEdit}
                />
              ))}
              <div className="gantt-timeline" style={{ left: tableW, width: scale.width, height: rows.length * ROW_H }}>
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
                  lookAheadSpan={lookAheadSpan}
                  lookAheadTitle={lookAhead ? `Look-ahead window ${shortDate(lookAhead.start)} – ${shortDate(lookAhead.end)}` : undefined}
                />
              </div>
            </div>
          </div>
        </div>
        {/* The part of the scroll area the timeline shows (for layout checks; draws nothing). */}
        <div className="gantt-timeline-pane" data-testid="gantt-timeline-pane" aria-hidden="true" style={{ left: tableW, width: Math.max(0, vp.width - tableW) }} />
        <div
          className="gantt-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize task table"
          aria-controls="gantt-scroll"
          aria-valuenow={tableW}
          aria-valuemin={GRID_MIN_W}
          aria-valuemax={maxGridWidth(vp.width)}
          tabIndex={0}
          title="Drag to resize the task table · double-click to reset"
          style={{ left: tableW }}
          onPointerDown={onSplitDown}
          onPointerMove={onSplitMove}
          onPointerUp={onSplitUp}
          onPointerCancel={() => {
            drag.current = null;
            setDragW(null);
          }}
          onKeyDown={onSplitKey}
          onDoubleClick={() => store.setScheduleLayout({ gridWidth: null })}
        />
      </div>
      <GanttLegend />
      {progress.prompt}
    </div>
  );
}

interface RowProps {
  row: GanttRow;
  index: number;
  width: number;
  columns: readonly Column[];
  tableWidth: number;
  /** Width of the Task column (it takes up the table's slack). */
  taskWidth: number;
  /** Progress mode: % and actual dates edit on a single click. */
  progressMode: boolean;
  /** The task's schedule (task rows only). */
  summary: TaskScheduleSummary | undefined;
  /** The task's predecessor field (task rows only). */
  pred: string;
  selected: boolean;
  /** The keyboard row cursor is on this row (Ctrl+Up/Down). */
  cursor: boolean;
  /** The cell being edited in place, if any. */
  editing: EditField | null;
  onEditDone: (id: Id, field: EditField, text: string | null, end: EditEnd, changed: boolean) => void;
}

/** One table row; memoised so rows already in view are not redrawn on every scroll step. */
const Row = memo(function Row({ row, index, width, columns, tableWidth, taskWidth, progressMode, summary: s, pred, selected, cursor, editing, onEditDone }: RowProps) {
  const style = { top: index * ROW_H, width };
  if (row.kind === 'group') {
    const a = row.asset;
    const detail = [a.description, a.location].filter(Boolean).join(' · ');
    return (
      <div
        className={`gantt-row is-group${selected ? ' is-selected' : ''}`}
        role="row"
        aria-rowindex={index + 2}
        aria-selected={selected}
        style={style}
        data-asset-id={a.id}
        title="Click to edit this asset"
      >
        <div className="gantt-cells">
          <span role="gridcell" className="gc gc-id" style={{ width: W.id }}>
            {row.number}
          </span>
          <span role="gridcell" aria-colspan={columns.length - 1} className="gc gc-group" style={{ width: tableWidth - W.id }}>
            <b className="gantt-tag">{a.tag}</b>
            {detail && <span className="gantt-asset-detail">{detail}</span>}
          </span>
        </div>
      </div>
    );
  }
  const t = row.task;
  const ready = t.readiness;
  const done = (field: EditField) => (v: string | null, end: EditEnd, changed: boolean) => onEditDone(t.id, field, v, end, changed);
  /** A progress cell: editable on one click in progress mode. */
  const progressCell = (field: ProgressField, text: string, edit: string, label: string, className: string) => (
    <span
      key={field}
      role="gridcell"
      className={`gc ${className}${progressMode ? ' is-editable' : ''}`}
      style={{ width: W[field] }}
      data-edit={progressMode ? field : undefined}
      title={progressMode && editing !== field ? `Click to edit ${label.toLowerCase()}` : undefined}
    >
      {editing === field ? <InlineEdit initial={edit} label={`${label} of task ${t.code}`} numeric={field === 'pct'} tabbable onDone={done(field)} /> : text}
    </span>
  );
  const cell = (key: ColumnKey) => {
    switch (key) {
      case 'id':
        return (
          <span key={key} role="gridcell" className="gc gc-id" style={{ width: W.id }}>
            {t.code}
          </span>
        );
      case 'task':
        return (
          <span key={key} role="gridcell" className="gc gc-task" style={{ width: taskWidth }} title={editing === 'name' ? undefined : t.name} data-edit="name">
            {editing === 'name' ? <InlineEdit initial={t.name} label={`Name of task ${t.code}`} onDone={done('name')} /> : t.name}
          </span>
        );
      case 'dur':
        return (
          <span key={key} role="gridcell" className="gc num gc-dur" style={{ width: W.dur }} data-edit="dur">
            {editing === 'dur' ? <InlineEdit initial={String(t.durationDays)} label={`Duration of task ${t.code} in working days`} numeric onDone={done('dur')} /> : `${t.durationDays} d`}
          </span>
        );
      case 'start':
        return (
          <span key={key} role="gridcell" className="gc" style={{ width: W.start }}>
            {s ? shortDate(s.start) : '—'}
          </span>
        );
      case 'pct':
        return progressCell('pct', `${t.percentComplete}%`, String(t.percentComplete), '% complete', 'num gc-pct');
      case 'astart':
        return progressCell('astart', t.actualStart ? shortDate(t.actualStart) : '—', t.actualStart ? shortDate(t.actualStart) : '', 'Actual start', 'gc-astart');
      case 'afinish':
        return progressCell('afinish', t.actualFinish ? shortDate(t.actualFinish) : '—', t.actualFinish ? shortDate(t.actualFinish) : '', 'Actual finish', 'gc-afinish');
      case 'pred':
        return (
          <span key={key} role="gridcell" className="gc gc-pred" style={{ width: W.pred }} title={pred || undefined}>
            {pred || '—'}
          </span>
        );
      case 'times':
        return (
          <span key={key} role="gridcell" className="gc gc-times" style={{ width: W.times }}>
            {ready ? TIMES_KEYS.map((k) => <ReadinessSymbol key={k} state={ready[k]} size={15} label={TIMES_NAME[k]} />) : null}
          </span>
        );
    }
  };
  return (
    <div
      id={`gantt-row-${t.id}`}
      className={`gantt-row is-task${selected ? ' is-selected' : ''}${s?.critical ? ' is-critical' : ''}${cursor ? ' is-cursor' : ''}`}
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      style={style}
      data-task-id={t.id}
    >
      <div className="gantt-cells">{columns.map((c) => cell(c.key))}</div>
    </div>
  );
});

interface InlineEditProps {
  initial: string;
  label: string;
  numeric?: boolean;
  /** Tab and Shift+Tab end the edit (to move to the next cell) instead of leaving the grid. */
  tabbable?: boolean;
  /**
   * Called once: the text to save (null = cancelled), how the edit ended, and whether the
   * text was changed from `initial` (an untouched cell is not a change).
   */
  onDone: (text: string | null, end: EditEnd, changed: boolean) => void;
}

/**
 * The in-place editor of a grid cell. Enter or blur saves, Escape cancels. While the text is
 * untouched it follows `initial`, so a value filled in by an edit still being saved (say the
 * actual start a % entry sets) shows up in the cell opened next.
 */
function InlineEdit({ initial, label, numeric, tabbable, onDone }: InlineEditProps) {
  const [text, setText] = useState(initial);
  const touched = useRef(false);
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef({ text, onDone, initial });
  latest.current = { text, onDone, initial };
  useEffect(() => {
    if (touched.current || done.current) return;
    setText(initial);
    if (document.activeElement === input.current) input.current?.select();
  }, [initial]);
  const changed = (value: string | null) => touched.current && value !== null && value !== latest.current.initial;
  const finish = (value: string | null, end: EditEnd) => {
    if (done.current) return;
    done.current = true;
    onDone(value, end, changed(value));
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
        latest.current.onDone(latest.current.text, 'gone', changed(latest.current.text));
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
      onChange={(e) => {
        touched.current = true;
        setText(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(text, 'enter');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(null, 'escape');
        } else if (e.key === 'Tab' && tabbable) {
          e.preventDefault();
          finish(text, e.shiftKey ? 'back-tab' : 'tab');
        }
      }}
      onBlur={() => finish(text, 'blur')}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
