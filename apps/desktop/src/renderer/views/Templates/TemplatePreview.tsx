import type { TemplatePreview as Preview } from '@cx/core';
import { taskTypeLabel } from '../../components/Symbols';

/**
 * "Preview of the schedule it generates": the template laid out on its own, one column per
 * working day (from previewTemplate in @cx/core). Plain tasks are solid bars, holds are
 * amber bars with a dark outline, witness points are open bars and milestones are
 * diamonds, so the types read without colour.
 */
export function TemplatePreview({ preview, selectedKey }: { preview: Preview; selectedKey: string | null }) {
  return (
    <section className="panel tpl-preview" aria-label="Schedule preview">
      <h2 className="section-label">Preview of the schedule it generates</h2>
      {!preview.ok ? (
        <p className="hint">The preview shows once the problems listed above are fixed.</p>
      ) : preview.rows.length === 0 ? (
        <p className="hint">Add tasks to see the schedule they generate.</p>
      ) : (
        <PreviewChart preview={preview} selectedKey={selectedKey} />
      )}
      <p className="hint tpl-preview-note">Each column is one working day. Durations and links come from the table above.</p>
    </section>
  );
}

function PreviewChart({ preview, selectedKey }: { preview: Extract<Preview, { ok: true }>; selectedKey: string | null }) {
  // A milestone sits in the column of its day, so one at the very end needs a column of its own.
  const cols = Math.max(1, ...preview.rows.map((r) => (r.type === 'milestone' ? r.start + 1 : r.finish)));
  const pct = (n: number) => `${(n / cols) * 100}%`;
  return (
    <div className="tpl-chart" role="list" aria-label={`${preview.spanDays} working days`} data-columns={cols}>
      {preview.rows.map((r) => (
        <div key={r.key} role="listitem" className={`tpl-chart-row${r.key === selectedKey ? ' is-selected' : ''}`} data-key={r.key}>
          <span className="tpl-chart-name" title={r.name}>
            {r.name}
          </span>
          <span
            className="tpl-chart-track"
            role="img"
            style={{ backgroundSize: `${100 / cols}% 100%` }}
            aria-label={
              r.type === 'milestone'
                ? `${taskTypeLabel(r.type)} on day ${r.start + 1}`
                : `${taskTypeLabel(r.type)}, days ${r.start + 1} to ${r.finish}`
            }
          >
            {r.type === 'milestone' ? (
              <span className="tpl-diamond" style={{ left: pct(r.start + 0.5) }} />
            ) : (
              <span
                className={`tpl-bar tpl-bar-${r.type}`}
                data-start={r.start}
                data-finish={r.finish}
                style={{ left: pct(r.start), width: pct(Math.max(r.finish - r.start, 0.15)) }}
              />
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
