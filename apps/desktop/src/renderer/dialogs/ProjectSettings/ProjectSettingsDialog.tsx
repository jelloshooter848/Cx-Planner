import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { weekday, type Project } from '@cx/core';
import { Modal } from '../../components/Modal';
import { longDate, plural } from '../../format';
import { useProject, useStore } from '../../store';
import {
  addHolidays,
  draftChanged,
  draftFrom,
  draftProblem,
  holidayRows,
  holidayYears,
  isIsoDate,
  missingFederalHolidays,
  removeHoliday,
  settingsCommand,
  toggleWeekday,
  WEEKDAYS,
  type SettingsDraft,
} from './settings-draft';
import './ProjectSettings.css';

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLabel = (iso: string) => (isIsoDate(iso) ? `${DAY_SHORT[weekday(iso)] ?? ''} ${longDate(iso)}` : iso);

/**
 * File > Project settings (also opened from the project name in the status bar): the
 * project's name, subtitle and start date, its working weekdays and its holidays. Saving
 * sends one undoable edit (updateProjectInfo and/or setCalendar) and the schedule is
 * recomputed by the main process. Cancel, Escape or the backdrop ask before throwing away
 * unsaved edits.
 */
export function ProjectSettingsDialog() {
  const store = useStore();
  const info = useProject();
  // No project (closed, or not loaded yet when the menu event arrived): nothing to edit, so
  // drop the dialog rather than leave it open and invisible.
  const missing = !info;
  useEffect(() => {
    if (missing) store.closeDialog();
  }, [missing, store]);
  return info ? <SettingsForm project={info.project} /> : null;
}

function SettingsForm({ project }: { project: Project }) {
  const store = useStore();
  // The form starts from the project as it was when the dialog opened.
  const [draft, setDraft] = useState<SettingsDraft>(() => draftFrom(project));
  const [newHoliday, setNewHoliday] = useState('');
  // Years for the federal-holiday helper follow the start date being edited.
  const validStart = isIsoDate(draft.startDate) ? draft.startDate : project.startDate;
  const years = useMemo(() => holidayYears(validStart), [validStart]);
  const [pickedYear, setYear] = useState(years[0] ?? new Date().getFullYear());
  const year = years.includes(pickedYear) ? pickedYear : (years[0] ?? pickedYear);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const close = () => store.closeDialog();

  const problem = draftProblem(draft);
  const command = problem ? null : settingsCommand(project, draft);
  const dirty = draftChanged(project, draft);
  const cancel = () => (dirty && !busy ? setConfirmDiscard(true) : close());
  const rows = holidayRows(draft);
  const update = (next: SettingsDraft) => {
    setDraft(next);
    setError('');
  };

  const addOne = () => {
    if (!isIsoDate(newHoliday)) return;
    const had = draft.holidays.includes(newHoliday);
    update(addHolidays(draft, [newHoliday]));
    setMessage(had ? `${longDate(newHoliday)} is already a holiday.` : `Added ${longDate(newHoliday)}.`);
    setNewHoliday('');
  };
  const addFederal = () => {
    const add = missingFederalHolidays(draft, year);
    update(addHolidays(draft, add));
    setMessage(
      add.length
        ? `Added ${plural(add.length, 'US federal holiday')} for ${year}.`
        : `All US federal holidays for ${year} are already in the list.`,
    );
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (problem) return setError(problem);
    if (!command) return close();
    setBusy(true);
    setError('');
    try {
      const r = await store.api.apply(command);
      if (r.ok) close();
      else setError(r.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        title="Project settings"
        description="Project details and the work calendar the schedule counts days on."
        onClose={cancel}
        width={600}
        className="project-settings"
      >
        <form className="ps-form" onSubmit={save} aria-label="Project settings" noValidate>
          <div className="ps-body">
            <label className="field">
              <span className="field-label">Project name</span>
              <input
                className="input"
                name="name"
                required
                value={draft.name}
                aria-invalid={draft.name.trim() === ''}
                onChange={(e) => update({ ...draft, name: e.target.value })}
              />
            </label>
            <div className="ps-row">
              <label className="field ps-grow">
                <span className="field-label">Subtitle</span>
                <input
                  className="input"
                  name="subtitle"
                  value={draft.subtitle}
                  placeholder="e.g. Electrical commissioning"
                  onChange={(e) => update({ ...draft, subtitle: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">Start date</span>
                <input
                  className="input"
                  name="startDate"
                  type="date"
                  required
                  value={draft.startDate}
                  onChange={(e) => update({ ...draft, startDate: e.target.value })}
                />
              </label>
            </div>

            <fieldset className="ps-fieldset">
              <legend className="field-label">Working days</legend>
              <div className="ps-days">
                {WEEKDAYS.map((d) => (
                  <label key={d.day} className="ps-day" title={d.long}>
                    <input
                      type="checkbox"
                      aria-label={d.long}
                      checked={draft.workWeekdays.includes(d.day)}
                      onChange={(e) => update(toggleWeekday(draft, d.day, e.target.checked))}
                    />
                    {d.short}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="ps-fieldset">
              <legend className="field-label">Holidays</legend>
              <p className="hint">No work is scheduled on these days. Tasks that span one finish a working day later.</p>
              <div className="ps-holidays" role="list" aria-label="Holidays" data-testid="holiday-list">
                {rows.length === 0 && <p className="ps-empty muted">No holidays.</p>}
                {rows.map((h) => (
                  <div key={h.date} role="listitem" className="ps-holiday" data-date={h.date}>
                    <span className="ps-holiday-date">{dayLabel(h.date)}</span>
                    <span className="ps-holiday-name muted">
                      {h.invalid ? 'invalid date' : (h.name ?? '')}
                      {h.offDay ? `${h.name ? ' · ' : ''}not a working day` : ''}
                    </span>
                    <button
                      type="button"
                      className="btn btn-quiet ps-remove"
                      aria-label={`Remove holiday ${h.invalid ? h.date : longDate(h.date)}`}
                      onClick={() => update(removeHoliday(draft, h.date))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <div className="ps-add">
                <label className="field">
                  <span className="field-label">Add a day</span>
                  <input
                    className="input"
                    type="date"
                    name="newHoliday"
                    aria-label="Holiday date"
                    value={newHoliday}
                    onChange={(e) => setNewHoliday(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addOne();
                      }
                    }}
                  />
                </label>
                <button type="button" className="btn" disabled={!isIsoDate(newHoliday)} onClick={addOne}>
                  Add
                </button>
                <span className="ps-spacer" />
                <label className="field">
                  <span className="field-label">US federal holidays</span>
                  <select className="input" aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="btn" onClick={addFederal}>
                  Add US federal holidays for {year}
                </button>
              </div>
              <p className="hint ps-message" role="status" aria-live="polite">
                {message}
              </p>
            </fieldset>
          </div>
          <footer className="ps-foot">
            {(error || problem) && (
              <p className="form-error" role="alert">
                {error || problem}
              </p>
            )}
            <span className="ps-spacer" />
            <button type="button" className="btn" onClick={cancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !!problem || !command}>
              Save
            </button>
          </footer>
        </form>
      </Modal>
      {confirmDiscard && (
        <Modal title="Unsaved changes" onClose={() => setConfirmDiscard(false)}>
          <p>Your changes to the project settings have not been saved. Discard them?</p>
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </button>
            <button type="button" className="btn btn-primary" onClick={close}>
              Discard changes
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
