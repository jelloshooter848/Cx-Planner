/**
 * Progress edits shared by the task panel and the grid's progress mode. Each edit asks
 * `planProgress` (packages/core/src/progress.ts) what it means, then sends one updateTask
 * command, so the % and the actual dates it fills in or clears are one undo step and one
 * change-log entry. Setting 100% without an actual finish opens the "Mark complete" prompt,
 * which asks for the finish (default: the data date) and, if missing, the actual start.
 */
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { planProgress, progressCommand, type ProgressChange, type ProgressOutcome, type Project, type Task } from '@cx/core';
import type { TaskScheduleSummary } from '../../../shared/api';
import { Modal } from '../../components/Modal';
import { useStore, type Store } from '../../store';

export interface ProgressEdit {
  /** What planProgress made of the edit (error, prompt or patch), known at once. */
  outcome: ProgressOutcome;
  /** Resolves when the edit is saved: null, or the message to show (a refused rule or save). */
  saved: Promise<string | null>;
}

export interface ProgressEditor {
  edit(task: Task, change: ProgressChange): ProgressEdit;
  /** The "Mark complete" prompt when it is open; render it somewhere in the caller. */
  prompt: ReactNode;
}

async function applyPatch(store: Store, task: Task, outcome: ProgressOutcome): Promise<string | null> {
  if (outcome.kind === 'error') return outcome.message;
  if (outcome.kind !== 'patch') return null;
  const cmd = progressCommand(task.id, outcome.patch);
  if (!cmd) return null;
  try {
    const r = await store.api.apply(cmd);
    return r.ok ? null : r.message;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

interface Ask {
  task: Task;
  change: ProgressChange;
  finish: string;
  /** The actual start to ask for too, or null when the task has one (or is a milestone). */
  start: string | null;
}

export function useProgressEditor(project: Project, schedule: Record<string, TaskScheduleSummary>): ProgressEditor {
  const store = useStore();
  const [ask, setAsk] = useState<Ask | null>(null);
  const ctxFor = (task: Task) => ({ dataDate: project.dataDate, computedStart: schedule[task.id]?.start ?? null });

  const edit = (task: Task, change: ProgressChange): ProgressEdit => {
    const outcome = planProgress(task, change, ctxFor(task));
    if (outcome.kind === 'needs-finish') setAsk({ task, change, finish: outcome.finish, start: outcome.start });
    return { outcome, saved: applyPatch(store, task, outcome) };
  };

  const prompt = ask && (
    <FinishPrompt
      ask={ask}
      onClose={() => setAsk(null)}
      onSave={async (finish, start) => {
        const outcome = planProgress(ask.task, { ...ask.change, percentComplete: 100, actualFinish: finish, ...(start ? { actualStart: start } : {}) }, ctxFor(ask.task));
        if (outcome.kind === 'needs-finish') return 'Choose the actual finish';
        const problem = await applyPatch(store, ask.task, outcome);
        if (!problem) setAsk(null);
        return problem;
      }}
    />
  );
  return { edit, prompt };
}

function FinishPrompt({ ask, onClose, onSave }: { ask: Ask; onClose: () => void; onSave: (finish: string, start: string | null) => Promise<string | null> }) {
  const ids = { start: useId(), finish: useId(), err: useId() };
  const [finish, setFinish] = useState(ask.finish);
  const [start, setStart] = useState(ask.start);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!finish || start === '') return setError('Choose a date');
    setBusy(true);
    setError(await onSave(finish, start));
    setBusy(false);
  };
  const t = ask.task;
  return (
    <Modal title={`Mark ${t.code} complete`} onClose={onClose} width={400}>
      <form className="form finish-prompt" onSubmit={(e) => void submit(e)}>
        <p className="hint">
          <b>{t.name}</b> is 100% complete. When did it finish?
        </p>
        {start !== null && (
          <div className="field">
            <label className="field-label" htmlFor={ids.start}>
              Actual start
            </label>
            <input id={ids.start} className="input" type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label className="field-label" htmlFor={ids.finish}>
            Actual finish
          </label>
          <input
            id={ids.finish}
            className="input"
            type="date"
            required
            value={finish}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? ids.err : undefined}
            onChange={(e) => setFinish(e.target.value)}
          />
        </div>
        {error && (
          <p id={ids.err} className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Mark complete
          </button>
        </div>
      </form>
    </Modal>
  );
}
