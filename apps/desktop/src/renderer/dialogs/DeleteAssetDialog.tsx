import { useState } from 'react';
import { Modal } from '../components/Modal';
import { plural } from '../format';
import { assetToDelete, useSelect, useStore } from '../store';

/**
 * Confirms deleting an asset with all its tasks (Edit menu or the asset panel): the selected
 * asset, or the selected task's asset. One undo step.
 */
export function DeleteAssetDialog() {
  const store = useStore();
  const asset = useSelect(assetToDelete);
  const project = useSelect((s) => s.app?.project);
  const [busy, setBusy] = useState(false);
  const close = () => store.closeDialog();
  if (!asset || !project) return null;
  const taskIds = new Set(project.tasks.filter((t) => t.assetId === asset.id).map((t) => t.id));
  const links = project.dependencies.filter((d) => taskIds.has(d.predecessorId) !== taskIds.has(d.successorId)).length;
  const remove = async () => {
    setBusy(true);
    const r = await store.run(() => store.api.apply({ kind: 'removeAsset', id: asset.id }));
    setBusy(false);
    if (r.ok) close();
  };
  const detail = [asset.description, asset.location].filter(Boolean).join(' · ');
  return (
    <Modal title={`Delete asset ${asset.tag}?`} onClose={close} width={440}>
      <p>
        <b>{asset.tag}</b>
        {detail ? ` (${detail})` : ''} will be removed from the schedule with its {plural(taskIds.size, 'task')}
        {links > 0 ? <>, and {plural(links, 'link')} to tasks of other assets</> : null}. The tasks of the assets after it are renumbered.
      </p>
      <p className="hint">You can undo this with Edit › Undo.</p>
      <div className="form-actions">
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void remove()}>
          Delete asset
        </button>
      </div>
    </Modal>
  );
}
