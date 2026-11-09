/**
 * Collapse controls of the Schedule view's side panels (the "Assets in view" sidebar on the
 * left, the details panel on the right): a chevron button on the panel's inner edge folds it
 * to a thin strip, and the strip's button opens it again. View > Assets panel / Details panel
 * do the same. Both buttons carry data-panel-toggle so ScheduleView can move focus from one
 * to the other when the panel folds or opens.
 */
import type { SchedulePanel } from '../../layout-prefs';

const NAMES: Record<SchedulePanel, string> = { assets: 'assets in view', details: 'details' };

/** Which way the panel folds: the left panel folds left, the right one right. */
const sideOf = (panel: SchedulePanel): 'left' | 'right' => (panel === 'assets' ? 'left' : 'right');

/** A chevron pointing left or right (drawn in currentColor, so it follows the button's ink). */
function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <path d={dir === 'left' ? 'M8.5 3 4.5 7l4 4' : 'M5.5 3l4 4-4 4'} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The button inside an open panel that folds it away. */
export function PanelCollapseButton({ panel, onToggle, className = '' }: { panel: SchedulePanel; onToggle(): void; className?: string }) {
  const label = `Hide ${NAMES[panel]} panel`;
  return (
    <button type="button" className={`panel-toggle ${className}`.trim()} data-panel-toggle={panel} aria-expanded={true} aria-label={label} title={label} onClick={onToggle}>
      <Chevron dir={sideOf(panel)} />
    </button>
  );
}

/** A folded panel: a thin strip with a button that opens it again and the panel's name. */
export function CollapsedPanel({ panel, title, onToggle }: { panel: SchedulePanel; title: string; onToggle(): void }) {
  const side = sideOf(panel);
  const label = `Show ${NAMES[panel]} panel`;
  return (
    <aside className={`panel-strip panel-strip-${side}`} aria-label={`${title} (collapsed)`} data-panel={panel}>
      <button type="button" className="panel-toggle" data-panel-toggle={panel} aria-expanded={false} aria-label={label} title={label} onClick={onToggle}>
        <Chevron dir={side === 'left' ? 'right' : 'left'} />
      </button>
      {/* The name doubles as a larger click target; the button above is the keyboard's way in. */}
      <span className="panel-strip-name" aria-hidden="true" onClick={onToggle}>
        {title}
      </span>
    </aside>
  );
}
