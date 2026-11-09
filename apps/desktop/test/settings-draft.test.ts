import { describe, expect, it } from 'vitest';
import { applyCommand } from '@cx/core';
import { riversideProject } from '@cx/fixtures';
import {
  addHolidays,
  draftFrom,
  draftProblem,
  holidayRows,
  holidayYears,
  isIsoDate,
  missingFederalHolidays,
  removeHoliday,
  settingsCommand,
  toggleWeekday,
} from '../src/renderer/dialogs/ProjectSettings/settings-draft.js';

describe('project settings draft', () => {
  const project = riversideProject();

  it('makes no edit when nothing changed', () => {
    expect(settingsCommand(project, draftFrom(project))).toBeNull();
    // Unsorted holidays in the file are not a change.
    const shuffled = { ...project, calendar: { ...project.calendar, holidays: [...project.calendar.holidays].reverse() } };
    expect(settingsCommand(shuffled, draftFrom(shuffled))).toBeNull();
    // Whitespace around the name is not a change either.
    expect(settingsCommand(project, { ...draftFrom(project), name: ` ${project.name} ` })).toBeNull();
  });

  it('sends updateProjectInfo for info changes only', () => {
    const d = { ...draftFrom(project), name: 'New name', subtitle: '  ' };
    expect(settingsCommand(project, d)).toEqual({ kind: 'updateProjectInfo', name: 'New name', subtitle: null });
    expect(settingsCommand(project, { ...draftFrom(project), startDate: '2026-11-09' })).toEqual({ kind: 'updateProjectInfo', startDate: '2026-11-09' });
  });

  it('sends setCalendar for calendar changes only', () => {
    const d = addHolidays(draftFrom(project), ['2026-11-11']);
    expect(settingsCommand(project, d)).toEqual({ kind: 'setCalendar', calendar: { workWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-11-11', '2026-11-26', '2026-12-25'] } });
  });

  it('batches both into one undo step that applies and reverses', () => {
    const d = toggleWeekday({ ...draftFrom(project), name: 'Other' }, 6, true);
    const cmd = settingsCommand(project, d)!;
    expect(cmd).toMatchObject({ kind: 'batch', summary: 'Changed project settings' });
    const r = applyCommand(project, cmd);
    expect(r.project.name).toBe('Other');
    expect(r.project.calendar.workWeekdays).toEqual([1, 2, 3, 4, 5, 6]);
    const back = applyCommand(r.project, r.inverse).project;
    expect(back.name).toBe(project.name);
    expect(back.calendar).toEqual(project.calendar);
  });

  it('edits the holiday list and weekdays', () => {
    let d = draftFrom(project);
    d = removeHoliday(d, '2026-12-25');
    expect(d.holidays).toEqual(['2026-11-26']);
    expect(missingFederalHolidays(d, 2026)).toHaveLength(10);
    d = addHolidays(d, missingFederalHolidays(d, 2026));
    expect(d.holidays).toHaveLength(11);
    expect(missingFederalHolidays(d, 2026)).toEqual([]);
    d = toggleWeekday(toggleWeekday(d, 5, false), 0, true);
    expect(d.workWeekdays).toEqual([0, 1, 2, 3, 4]);
    const fri = holidayRows(d).find((r) => r.date === '2026-12-25')!;
    expect(fri).toEqual({ date: '2026-12-25', name: 'Christmas Day', offDay: true });
    expect(holidayRows(d).find((r) => r.date === '2026-11-26')).toEqual({ date: '2026-11-26', name: 'Thanksgiving Day', offDay: false });
  });

  it('reports what blocks saving', () => {
    expect(draftProblem(draftFrom(project))).toBeNull();
    expect(draftProblem({ ...draftFrom(project), name: ' ' })).toMatch(/name/);
    expect(draftProblem({ ...draftFrom(project), startDate: '' })).toMatch(/start date/);
    expect(draftProblem({ ...draftFrom(project), workWeekdays: [] })).toMatch(/working day/);
  });

  it('checks dates and offers years from the start year', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('')).toBe(false);
    expect(holidayYears('2026-11-02')).toEqual([2026, 2027, 2028, 2029]);
  });
});
