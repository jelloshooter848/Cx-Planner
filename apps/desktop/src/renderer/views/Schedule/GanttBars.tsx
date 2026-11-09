/**
 * The timeline drawings of the Gantt: header ticks and the bars of the rows in view. Each is
 * one SVG covering only the visible window (rows [first, last), x in [x0, x1)), so the cost
 * of a frame does not grow with the size of the project.
 *
 * States never rely on colour alone: complete bars are solid, in-progress bars are outlined
 * with a partial fill, not-started bars are outlined and empty, critical bars get a heavy
 * outline plus a red ring, holds a filled diamond and "Hold", witness points an open diamond
 * and "Witness".
 */
import { memo } from 'react';
import { parseIso, type Id } from '@cx/core';
import type { TaskScheduleSummary } from '../../../shared/api';
import { typeDiamondMarkup } from '../../components/Symbols';
import { shortDate } from '../../format';
import { barShape, xOf, type GanttRow, type HeaderTicks, type Tick, type TimeScale } from './gantt-layout';

export const ROW_H = 31;
export const HEAD_TOP_H = 26;
export const HEAD_BOTTOM_H = 28;
export const HEAD_H = HEAD_TOP_H + HEAD_BOTTOM_H;

/** Rough text width at the header font size, to decide whether a label fits its tick. */
const textW = (s: string) => s.length * 6.6;

function tickLabel(t: Tick, room: number): string {
  if (textW(t.label) + 10 <= room) return t.label;
  if (t.short && textW(t.short) + 10 <= room) return t.short;
  return '';
}

export interface HeaderProps {
  scale: TimeScale;
  /** headerTicks(scale), computed once per scale by the caller. */
  ticks: HeaderTicks;
  x0: number;
  x1: number;
  /** Timeline x at the left edge of the viewport; upper-row labels stick to it. */
  scrolled: number;
}

export const GanttHeaderTime = memo(function GanttHeaderTime({ scale, ticks, x0, x1, scrolled }: HeaderProps) {
  const { top, bottom } = ticks;
  const inView = (t: Tick) => t.x < x1 && t.x + t.width > x0;
  return (
    <svg className="gantt-head-time" width={x1 - x0} height={HEAD_H} viewBox={`${x0} 0 ${x1 - x0} ${HEAD_H}`} style={{ left: x0 }} aria-hidden="true" data-testid="gantt-time-header">
      {top.filter(inView).map((t) => {
        // Keep the month (or year) name in view while its span is.
        const labelX = Math.max(t.x, Math.min(scrolled, t.x + t.width - 40));
        const label = tickLabel(t, t.x + t.width - labelX);
        return (
          <g key={`t${t.x}`}>
            {t.x > 0 && <line className="gh-line" x1={t.x + 0.5} x2={t.x + 0.5} y1={0} y2={HEAD_TOP_H} />}
            {label && (
              <text className="gh-text" x={labelX + 6} y={HEAD_TOP_H / 2 + 4}>
                {label}
              </text>
            )}
          </g>
        );
      })}
      <line className="gh-line" x1={x0} x2={x1} y1={HEAD_TOP_H - 0.5} y2={HEAD_TOP_H - 0.5} />
      {bottom.filter(inView).map((t) => {
        const label = tickLabel(t, t.width);
        return (
          <g key={`b${t.x}`}>
            <line className="gh-line" x1={t.x + 0.5} x2={t.x + 0.5} y1={HEAD_TOP_H} y2={HEAD_H} />
            {label && (
              <text className="gh-text" x={scale.zoom === 'day' ? t.x + t.width / 2 : t.x + 6} y={HEAD_TOP_H + HEAD_BOTTOM_H / 2 + 4} textAnchor={scale.zoom === 'day' ? 'middle' : 'start'}>
                {label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
});

export interface BarsProps {
  rows: readonly GanttRow[];
  schedule: Record<Id, TaskScheduleSummary>;
  scale: TimeScale;
  /** headerTicks(scale), computed once per scale by the caller. */
  ticks: HeaderTicks;
  /** Timeline x of each weekend day (day zoom only), computed once per scale by the caller. */
  weekendXs: readonly number[];
  first: number;
  last: number;
  x0: number;
  x1: number;
  /** Timeline x of the data date; null or left out when it is off the scale. */
  dataDateX?: number | null;
  /** Hover text of the data-date line. */
  dataDateTitle?: string;
  /** Timeline x range [from, to) of the look-ahead window to shade; null or left out for none. */
  lookAheadSpan?: readonly [number, number] | null;
  lookAheadTitle?: string;
}

export const GanttBars = memo(function GanttBars({ rows, schedule, scale, ticks, weekendXs, first, last, x0, x1, dataDateX = null, dataDateTitle = 'Data date', lookAheadSpan = null, lookAheadTitle = 'Look-ahead window' }: BarsProps) {
  const y0 = first * ROW_H;
  const h = Math.max(1, (last - first) * ROW_H);
  const months = new Set(scale.zoom === 'month' ? [] : ticks.top.filter((t) => t.x >= x0 && t.x <= x1).map((t) => t.x));
  const grid = ticks.bottom.filter((t) => t.x >= x0 && t.x <= x1);
  const shade = weekendXs.filter((x) => x + scale.dayWidth > x0 && x < x1);

  const items = [];
  for (let i = first; i < last; i++) {
    const row = rows[i];
    if (!row) continue;
    const y = i * ROW_H;
    if (row.kind === 'group') {
      if (!row.start || !row.finish) continue;
      const a = xOf(scale, row.start);
      const b = xOf(scale, parseIso(row.finish) + 1);
      if (b < x0 || a > x1) continue;
      items.push(<rect key={row.key} className="gb-summary" x={a} y={y + 12} width={Math.max(2, b - a)} height={6} rx={1} />);
      continue;
    }
    const s = schedule[row.task.id];
    if (!s) continue;
    const bar = barShape(row.task, s, scale);
    // Leave room for labels drawn to the right of the bar.
    if (bar.x1 + 80 < x0 || bar.x0 - 12 > x1) continue;
    items.push(<TaskBar key={row.key} row={row} s={s} y={y} bar={bar} />);
  }

  return (
    <svg className="gantt-bars" width={x1 - x0} height={h} viewBox={`${x0} ${y0} ${x1 - x0} ${h}`} style={{ left: x0, top: y0 }} data-testid="gantt-bars">
      {shade.map((x) => (
        <rect key={`w${x}`} className="gb-weekend" x={x} y={y0} width={scale.dayWidth} height={h} />
      ))}
      {lookAheadSpan && lookAheadSpan[1] > x0 && lookAheadSpan[0] < x1 && (
        <rect className="gb-lookahead" x={lookAheadSpan[0]} y={y0} width={lookAheadSpan[1] - lookAheadSpan[0]} height={h} data-testid="gantt-lookahead">
          <title>{lookAheadTitle}</title>
        </rect>
      )}
      {grid.map((t) => (
        <line key={`g${t.x}`} className={months.has(t.x) ? 'gb-grid gb-grid-month' : 'gb-grid'} x1={t.x + 0.5} x2={t.x + 0.5} y1={y0} y2={y0 + h} />
      ))}
      {/* Under the bars, so their labels (with a paper-coloured halo) stay readable over it. */}
      {dataDateX !== null && (
        <line className="gantt-datadate" x1={dataDateX} x2={dataDateX} y1={y0} y2={y0 + h} data-testid="gantt-data-date">
          <title>{dataDateTitle}</title>
        </line>
      )}
      {items}
    </svg>
  );
});

function TaskBar({ row, s, y, bar }: { row: Extract<GanttRow, { kind: 'task' }>; s: TaskScheduleSummary; y: number; bar: ReturnType<typeof barShape> }) {
  const t = row.task;
  const cy = y + ROW_H / 2;
  const title = `${t.code} ${t.name} · ${s.start === s.finish ? shortDate(s.start) : `${shortDate(s.start)} – ${shortDate(s.finish)}`}${s.critical ? ' · Critical path' : ''}`;
  const cls = `gb-task gb-${bar.progress}${bar.critical ? ' gb-critical' : ''}`;

  if (bar.kind === 'milestone') {
    // A 0-day hold or witness point keeps its own diamond and label; a milestone shows its date.
    const label = bar.marker === 'hold' ? 'Hold' : bar.marker === 'witness' ? 'Witness' : shortDate(s.start);
    return (
      <g className={cls} data-task-id={t.id}>
        <title>{title}</title>
        {bar.critical && <path className="gb-crit-ring" d={`M${bar.x0} ${cy - 11} L${bar.x0 + 11} ${cy} L${bar.x0} ${cy + 11} L${bar.x0 - 11} ${cy} Z`} />}
        <g className="gb-ms" dangerouslySetInnerHTML={{ __html: typeDiamondMarkup(bar.marker ?? 'milestone', bar.x0, cy, 7, 2) }} />
        <text className="gb-label" x={bar.x0 + 13} y={cy + 4}>
          {label}
        </text>
      </g>
    );
  }

  const w = Math.max(2, bar.x1 - bar.x0);
  const by = y + 8;
  const bh = 14;
  let label = '';
  if (bar.marker === 'hold') label = 'Hold';
  else if (bar.marker === 'witness') label = 'Witness';
  else if (bar.progress !== 'not-started') label = `${bar.percent}%`;
  // On a bar too short to hold it, the diamond sits just past the bar's end instead of on it.
  const markerX = bar.x0 + w + (w < 14 ? 8 : 0);
  const labelX = bar.marker ? markerX + 13 : bar.x0 + w + 5;
  return (
    <g className={cls} data-task-id={t.id}>
      <title>{title}</title>
      {bar.critical && <rect className="gb-crit-ring" x={bar.x0 - 3} y={by - 3} width={w + 6} height={bh + 6} rx={4} />}
      <rect className="gb-bar" x={bar.x0} y={by} width={w} height={bh} rx={3} />
      {bar.progress === 'progress' && bar.percent > 0 && <rect className="gb-fill" x={bar.x0} y={by} width={(w * bar.percent) / 100} height={bh} rx={3} />}
      {bar.marker && <g dangerouslySetInnerHTML={{ __html: typeDiamondMarkup(bar.marker, markerX, cy, 7, 2) }} />}
      {label && (
        <text className="gb-label" x={labelX} y={cy + 4}>
          {label}
        </text>
      )}
    </g>
  );
}
