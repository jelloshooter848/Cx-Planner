import { useMemo, useState } from 'react';
import {
  isEmptyReapplyPlan,
  planReapply,
  type Asset,
  type Project,
  type ReapplyAssetPlan,
  type ReapplyFieldChange,
  type Template,
} from '@cx/core';
import { Modal } from '../../components/Modal';
import { plural } from '../../format';
import { useCommand } from '../../store';

const FIELD_LABEL: Record<ReapplyFieldChange['field'], string> = {
  name: 'name',
  type: 'type',
  durationDays: 'duration',
  responsible: 'trade',
  startNoEarlierThan: 'start no earlier than',
};

function changeText(c: ReapplyFieldChange): string {
  const v = (x: string | number | undefined) => (x === undefined || x === '' ? '—' : c.field === 'durationDays' ? `${x} d` : String(x));
  return `${FIELD_LABEL[c.field]} ${v(c.from)} → ${v(c.to)}`;
}

/**
 * Template editor > "Re-apply to existing assets…": lists the open project's assets made from
 * the template, shows what re-applying the saved template would do to each (planReapply in
 * @cx/core) and applies it to the ticked ones as one undoable edit.
 */
export function ReapplyDialog({
  template,
  project,
  assets,
  onClose,
  onDone,
}: {
  template: Template;
  project: Project;
  assets: Asset[];
  onClose: () => void;
  onDone: (summary: string) => void;
}) {
  const { apply } = useCommand();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(assets.map((a) => a.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const plans = useMemo(() => {
    try {
      return new Map(
        planReapply(
          project,
          assets.map((a) => a.id),
          template,
        ).map((p) => [p.assetId, p]),
      );
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [project, assets, template]);
  const taskName = (id: string) => project.tasks.find((t) => t.id === id)?.name ?? id;
  const chosen = assets.filter((a) => picked.has(a.id));
  const changing = typeof plans === 'string' ? [] : chosen.filter((a) => !isEmptyReapplyPlan(plans.get(a.id)!));

  const run = async () => {
    setBusy(true);
    setError('');
    const r = await apply({ kind: 'reapplyTemplate', assetIds: changing.map((a) => a.id), template });
    setBusy(false);
    if (r.ok) onDone(r.value.summary ?? `Re-applied ${template.name}`);
    else setError(r.message);
  };

  return (
    <Modal title="Re-apply template to existing assets" onClose={onClose} width={640}>
      <p className="hint">
        Brings <b>{template.name}</b> (version {template.version}) into the assets below. Progress is never lost: tasks with actual dates or
        percent complete are kept, and anything the template disagrees with is listed as a conflict. It is one step, so Edit &gt; Undo takes
        it back.
      </p>
      {typeof plans === 'string' ? (
        <p className="form-error" role="alert">
          {plans}
        </p>
      ) : (
        <ul className="reapply-list" aria-label="Affected assets">
          {assets.map((a) => (
            <AssetPlan
              key={a.id}
              asset={a}
              plan={plans.get(a.id)!}
              version={template.version}
              checked={picked.has(a.id)}
              taskName={taskName}
              onToggle={(on) =>
                setPicked((s) => {
                  const next = new Set(s);
                  if (on) next.add(a.id);
                  else next.delete(a.id);
                  return next;
                })
              }
            />
          ))}
        </ul>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || changing.length === 0} onClick={() => void run()}>
          {changing.length === 0 ? 'Nothing to re-apply' : `Re-apply to ${plural(changing.length, 'asset')}`}
        </button>
      </div>
    </Modal>
  );
}

function AssetPlan({
  asset,
  plan,
  version,
  checked,
  onToggle,
  taskName,
}: {
  asset: Asset;
  plan: ReapplyAssetPlan;
  version: number;
  checked: boolean;
  onToggle: (on: boolean) => void;
  taskName: (id: string) => string;
}) {
  const empty = isEmptyReapplyPlan(plan);
  const linkCount = plan.links.added.length + plan.links.changed.length + plan.links.removed.length;
  return (
    <li className="reapply-asset">
      <label className="reapply-head">
        <input type="checkbox" checked={checked && !empty} disabled={empty} onChange={(e) => onToggle(e.target.checked)} />
        <b>{asset.tag}</b>
        <span className="muted">{asset.description}</span>
        <span className="muted small reapply-version">{empty ? 'Up to date' : `v${asset.templateVersion ?? '—'} → v${version}`}</span>
      </label>
      {(!empty || plan.conflicts.length > 0) && (
        <ul className="reapply-details">
          {plan.added.length > 0 && <li>Adds {plan.added.map((t) => t.name).join(', ')}</li>}
          {plan.updated.map((u) => (
            <li key={u.taskId}>
              Updates {taskName(u.taskId)}: {u.changes.map(changeText).join('; ')}
            </li>
          ))}
          {plan.removed.length > 0 && <li>Removes {plan.removed.map((r) => taskName(r.taskId)).join(', ')}</li>}
          {linkCount > 0 && <li>{plural(linkCount, 'link')} added, changed or removed</li>}
          {!empty && plan.added.length === 0 && plan.updated.length === 0 && plan.removed.length === 0 && linkCount === 0 && (
            <li>Records the new template version only</li>
          )}
          {plan.conflicts.map((c) => (
            <li key={c.taskId} className="reapply-conflict">
              <span className="conflict-mark" aria-label="Conflict">
                !
              </span>
              {c.message}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
