/** The key under the Gantt (as in 01-Main): bar states, holds, witness points, critical path, and the T I M E S symbols. */
import type { ReadinessState } from '@cx/core';
import { ReadinessSymbol, typeDiamondMarkup } from '../../components/Symbols';

function BarSwatch({ kind }: { kind: 'complete' | 'progress' | 'not-started' | 'critical' }) {
  return (
    <svg className="sym" width={26} height={14} viewBox="0 0 26 14" aria-hidden="true">
      {kind === 'critical' && <rect className="gb-crit-ring" x={1} y={1} width={24} height={12} rx={3} />}
      <g className={`gb-${kind === 'critical' ? 'not-started gb-critical' : kind}`}>
        <rect className="gb-bar" x={3} y={3} width={20} height={8} rx={2} />
        {kind === 'progress' && <rect className="gb-fill" x={3} y={3} width={10} height={8} rx={2} />}
      </g>
    </svg>
  );
}

function DiamondSwatch({ type }: { type: 'hold' | 'witness' | 'milestone' }) {
  return (
    <svg className="sym" width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
      <g dangerouslySetInnerHTML={{ __html: typeDiamondMarkup(type, 7, 7, 6, 2) }} />
    </svg>
  );
}

const TIMES_LEGEND: Array<[ReadinessState, string]> = [
  ['ready', 'Ready'],
  ['progress', 'In progress / on order'],
  ['needed', 'Needed'],
  ['na', 'N/A'],
  ['blocked', 'Blocked'],
];

export function GanttLegend() {
  return (
    <div className="gantt-legend" aria-label="Legend" role="group">
      <div className="gantt-legend-row">
        <span className="legend-item"><BarSwatch kind="complete" />Complete</span>
        <span className="legend-item"><BarSwatch kind="progress" />In progress</span>
        <span className="legend-item"><BarSwatch kind="not-started" />Not started</span>
        <span className="legend-item"><DiamondSwatch type="hold" />Hold point</span>
        <span className="legend-item"><DiamondSwatch type="witness" />Witness point</span>
        <span className="legend-item"><DiamondSwatch type="milestone" />Milestone</span>
        <span className="legend-item"><BarSwatch kind="critical" />Critical path</span>
        <span className="legend-item"><span className="legend-dataline" aria-hidden="true" />Data date</span>
      </div>
      <div className="gantt-legend-row gantt-legend-times">
        <strong className="legend-times-title">T I M E S</strong>
        {TIMES_LEGEND.map(([state, label]) => (
          <span key={state} className="legend-item"><ReadinessSymbol state={state} size={13} />{label}</span>
        ))}
      </div>
    </div>
  );
}
