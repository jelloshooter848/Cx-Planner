/**
 * Status symbols for the screen, drawn by the same functions as the prints
 * (packages/render symbols.ts), so a state has the same shape everywhere and never relies
 * on colour alone.
 */
import type { ReadinessState, TaskType } from '@cx/core';
import { diamond, timesSymbol } from '@cx/render';

const READINESS_LABEL: Record<ReadinessState, string> = {
  ready: 'Ready',
  progress: 'In progress / on order',
  needed: 'Needed',
  na: 'N/A',
  blocked: 'Blocked',
};

const READINESS_INK: Record<ReadinessState, string> = {
  ready: 'var(--ok)',
  progress: 'var(--accent)',
  needed: 'var(--ink-muted)',
  na: 'var(--ink-muted)',
  blocked: 'var(--danger)',
};

/** One TIMES readiness symbol (filled, half, open circle, dash or "!" square). */
export function ReadinessSymbol({ state, size = 14 }: { state: ReadinessState; size?: number }) {
  const r = size / 2 - 1;
  return (
    <svg className="sym" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={READINESS_LABEL[state]}>
      <g dangerouslySetInnerHTML={{ __html: timesSymbol(state, size / 2, size / 2, r, READINESS_INK[state]) }} />
    </svg>
  );
}

const TYPE_LABEL: Record<TaskType, string> = { task: 'Task', hold: 'Hold', witness: 'Witness', milestone: 'Milestone' };

/** Diamond for holds (filled, amber), witness points (open) and milestones (filled); nothing for plain tasks. */
export function TaskTypeSymbol({ type, size = 12 }: { type: TaskType; size?: number }) {
  if (type === 'task') return null;
  const r = size / 2 - 1;
  const ink = type === 'hold' ? 'var(--hold)' : 'var(--ink)';
  const svg = diamond(size / 2, size / 2, r, type !== 'witness', ink);
  // The hold diamond gets a dark outline so it still reads as a filled diamond in grey.
  const outlined = type === 'hold' ? svg.replace('/>', ' stroke="var(--ink)" stroke-width="1"/>') : svg;
  return (
    <svg className="sym" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={TYPE_LABEL[type]}>
      <g dangerouslySetInnerHTML={{ __html: outlined }} />
    </svg>
  );
}

export const taskTypeLabel = (type: TaskType): string => TYPE_LABEL[type];
