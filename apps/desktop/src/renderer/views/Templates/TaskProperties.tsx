import { useEffect, useId, useState } from 'react';
import {
  formatTemplatePredecessors,
  newChecklistItemId,
  parseTemplatePredecessors,
  updateTemplateTask,
  type ChecklistItem,
  type Template,
  type TemplateTask,
  type TaskType,
} from '@cx/core';
import { ListEditor } from './ListEditor';

const TYPES: ReadonlyArray<readonly [TaskType, string]> = [
  ['task', 'Task'],
  ['hold', 'Hold point'],
  ['witness', 'Witness point'],
  ['milestone', 'Milestone'],
];

/** A number field: blank reads as NaN (or undefined when `optional`), so validation can name it. */
function numberValue(v: number | undefined): string {
  return v === undefined || !Number.isFinite(v) ? '' : String(v);
}

/** Right panel: the selected task's properties. Every change goes straight into the draft template. */
export function TaskProperties({
  template,
  task,
  index,
  onChange,
}: {
  template: Template;
  task: TemplateTask;
  index: number;
  onChange: (t: Template) => void;
}) {
  const id = useId();
  const update = (patch: Partial<Omit<TemplateTask, 'key'>>) => onChange(updateTemplateTask(template, task.key, patch));
  const formatted = formatTemplatePredecessors(template, task);
  const [predText, setPredText] = useState(formatted);
  const [predError, setPredError] = useState('');
  // Follow the draft when another task is selected or rows move.
  useEffect(() => {
    setPredText(formatted);
    setPredError('');
  }, [task.key, formatted]);
  const commitPreds = () => {
    if (predText.trim() === formatted) {
      setPredError('');
      return;
    }
    const r = parseTemplatePredecessors(template, task.key, predText);
    if (!r.ok) {
      setPredError(r.message);
      return;
    }
    setPredError('');
    update({ predecessors: r.predecessors });
  };

  return (
    <section className="tpl-props" aria-label="Task properties">
      <h2 className="section-label">Task {index + 1} · Properties</h2>
      <label className="field">
        <span className="field-label">Task name</span>
        <input className="input" value={task.name} onChange={(e) => update({ name: e.target.value })} />
      </label>
      <div className="field-row">
        <label className="field">
          <span className="field-label">Duration (days)</span>
          <input
            className="input"
            type="number"
            min={0}
            step={1}
            value={numberValue(task.durationDays)}
            disabled={task.type === 'milestone'}
            title={task.type === 'milestone' ? 'Milestones take no time' : undefined}
            onChange={(e) => update({ durationDays: e.target.value === '' ? Number.NaN : Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span className="field-label">Predecessor</span>
          <input
            className="input"
            value={predText}
            placeholder="—"
            aria-invalid={predError !== ''}
            aria-describedby={predError ? `${id}-pred` : `${id}-pred-hint`}
            onChange={(e) => setPredText(e.target.value)}
            onBlur={commitPreds}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitPreds();
              } else if (e.key === 'Escape' && predText !== formatted) {
                e.stopPropagation();
                setPredText(formatted);
                setPredError('');
              }
            }}
          />
        </label>
      </div>
      {predError ? (
        <p id={`${id}-pred`} className="form-error" role="alert">
          {predError}
        </p>
      ) : (
        <p id={`${id}-pred-hint`} className="hint">
          Row numbers, e.g. 3 or 2, 3SS+1
        </p>
      )}
      <div className="field-row">
        <label className="field">
          <span className="field-label">Type</span>
          <select className="input" value={task.type} onChange={(e) => update({ type: e.target.value as TaskType })}>
            {TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Trade</span>
          <input className="input" value={task.trade} onChange={(e) => update({ trade: e.target.value })} placeholder="e.g. Electrical" />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span className="field-label">Test form</span>
          <input
            className="input"
            value={task.testForm ?? ''}
            onChange={(e) => update({ testForm: e.target.value })}
            placeholder="Optional"
          />
        </label>
        <label className="field">
          <span className="field-label">Notice lead (days)</span>
          <input
            className="input"
            type="number"
            min={0}
            step={1}
            value={numberValue(task.noticeLeadDays)}
            placeholder="None"
            onChange={(e) => update({ noticeLeadDays: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        </label>
      </div>

      <h3 className="field-label tpl-props-sub">Checklist items on the printed test sheet</h3>
      <ListEditor<ChecklistItem>
        label="Checklist item"
        noun="checklist item"
        items={task.checklist}
        onChange={(checklist) => update({ checklist })}
        text={(c) => c.text}
        withText={(c, text) => ({ ...c, text })}
        create={(items) => ({ id: newChecklistItemId(items, task.key), text: '' })}
        itemKey={(c) => c.id}
        addLabel="Add checklist item"
        placeholder="One line on the test sheet"
      />

      <h3 className="field-label tpl-props-sub">Required certifications</h3>
      <ListEditor<string>
        label="Certification"
        noun="certification"
        items={task.requiredCerts}
        onChange={(requiredCerts) => update({ requiredCerts })}
        text={(s) => s}
        withText={(_s, text) => text}
        create={() => ''}
        addLabel="Add certification"
        placeholder="e.g. NETA Level III"
      />
    </section>
  );
}
