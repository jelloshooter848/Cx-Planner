import { useId, useState, type FormEvent } from 'react';
import { Modal } from '../components/Modal';
import { longDate, todayIso } from '../format';
import { useProject, useStore } from '../store';

/**
 * The project data date picker (status bar "Data as of …", File > Set data date…). Progress
 * is reported as of this date and work not yet done is scheduled from it. Saving sends one
 * setDataDate command: one undo step and one change-log entry.
 */
export function DataDateDialog() {
  const store = useStore();
  const info = useProject();
  const id = useId();
  const errId = useId();
  const [date, setDate] = useState(info?.project.dataDate ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => store.closeDialog();
  if (!info) return null;
  const current = info.project.dataDate;
  const today = todayIso();

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!date) return setError('Choose a date');
    if (date === current) return close();
    setBusy(true);
    try {
      const r = await store.api.apply({ kind: 'setDataDate', date });
      if (r.ok) close();
      else setError(r.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Data date" onClose={close} width={380}>
      <form className="form" onSubmit={(e) => void save(e)}>
        <p className="hint">
          Progress is reported as of this date. Work not done yet is scheduled from it. Now {longDate(current)}.
        </p>
        <div className="field">
          <label className="field-label" htmlFor={id}>
            Data as of
          </label>
          <div className="data-date-row">
            <input
              id={id}
              className="input"
              type="date"
              required
              value={date}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errId : undefined}
              onChange={(e) => {
                setDate(e.target.value);
                setError(null);
              }}
            />
            <button type="button" className="btn" disabled={date === today} onClick={() => setDate(today)}>
              Today
            </button>
          </div>
          {error && (
            <p id={errId} className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !date}>
            Set data date
          </button>
        </div>
      </form>
    </Modal>
  );
}
