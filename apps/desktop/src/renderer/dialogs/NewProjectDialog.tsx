import { useState, type FormEvent } from 'react';
import { Modal } from '../components/Modal';
import { todayIso } from '../format';
import { useStore } from '../store';

/** File > New project: name and start date, then a save dialog (shown by the main process). */
export function NewProjectDialog() {
  const store = useStore();
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => store.closeDialog();
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await store.api.newProject({ name: name.trim(), startDate });
      if (r.ok) close();
      else if (r.code !== 'canceled' && r.code !== 'file-error' && r.code !== 'locked') setError(r.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="New project" onClose={close}>
      <form className="form" onSubmit={create} aria-label="New project">
        <label className="field">
          <span className="field-label">Project name</span>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Riverside Data Center – Bldg A" />
        </label>
        <label className="field">
          <span className="field-label">Start date</span>
          <input className="input" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <p className="hint">You choose where to save the file next. Every change is saved as you go.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || name.trim() === ''}>
            Create…
          </button>
        </div>
      </form>
    </Modal>
  );
}
