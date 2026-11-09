import { useState } from 'react';
import { Modal } from '../components/Modal';
import { plural } from '../format';
import { useProject, useSelectedTask, useStore } from '../store';

/** Confirms deleting the selected task (Delete key, Edit menu or the task panel). One undo step. */
export function DeleteTaskDialog() {
  const store = useStore();
  const info = useProject();
  const task = useSelectedTask();
  const [busy, setBusy] = useState(false);
  const close = () => store.closeDialog();
  if (!info || !task) return null;
  const links = info.project.dependencies.filter((d) => d.predecessorId === task.id || d.successorId === task.id).length;
  const remove = async () => {
    setBusy(true);
    const r = await store.run(() => store.api.apply({ kind: 'removeTask', id: task.id }));
    setBusy(false);
    if (r.ok) close();
  };
  return (
    <Modal title={`Delete task ${task.code}?`} onClose={close} width={420}>
      <p>
        <b>{task.name}</b> will be removed from the schedule
        {links > 0 ? <>, with its {plural(links, 'link')} to other tasks</> : null}. The tasks after it in this asset are renumbered.
      </p>
      <p className="hint">You can undo this with Edit › Undo.</p>
      <div className="form-actions">
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void remove()}>
          Delete task
        </button>
      </div>
    </Modal>
  );
}
