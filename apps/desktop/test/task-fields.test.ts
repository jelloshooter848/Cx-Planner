import { describe, expect, it } from 'vitest';
import { riversideProject } from '@cx/fixtures';
import { floatNote, parseActualDate, parseDateInput, parseDuration, parsePercent, typeChangePatch } from '../src/renderer/views/Schedule/task-fields.js';
import { scheduleView } from '../src/main/session.js';

describe('task panel fields', () => {
  it('reads durations and percentages', () => {
    expect(parseDuration('4')).toEqual({ ok: true, value: 4 });
    expect(parseDuration(' 6 d ')).toEqual({ ok: true, value: 6 });
    expect(parseDuration('3 days')).toEqual({ ok: true, value: 3 });
    expect(parseDuration('0')).toEqual({ ok: true, value: 0 });
    expect(parseDuration('2.5')).toMatchObject({ ok: false, error: 'Duration must be a whole number' });
    expect(parseDuration('-1')).toMatchObject({ ok: false });
    expect(parseDuration('four')).toMatchObject({ ok: false });
    expect(parseDuration('')).toMatchObject({ ok: false });
    expect(parsePercent('50%')).toEqual({ ok: true, value: 50 });
    expect(parsePercent('100')).toEqual({ ok: true, value: 100 });
    expect(parsePercent('101')).toMatchObject({ ok: false, error: '% complete must be between 0 and 100' });
    expect(parsePercent('5 d')).toMatchObject({ ok: false });
  });

  it('reads dates in the forms people type', () => {
    const ref = '2026-11-10';
    expect(parseDateInput('2026-11-12', ref)).toEqual({ ok: true, value: '2026-11-12' });
    expect(parseDateInput('Nov 12', ref)).toEqual({ ok: true, value: '2026-11-12' });
    expect(parseDateInput('nov. 12', ref)).toEqual({ ok: true, value: '2026-11-12' });
    expect(parseDateInput('December 3, 2027', ref)).toEqual({ ok: true, value: '2027-12-03' });
    expect(parseDateInput('Sept 1', ref)).toEqual({ ok: true, value: '2026-09-01' });
    expect(parseDateInput('11/12', ref)).toEqual({ ok: true, value: '2026-11-12' });
    expect(parseDateInput('1/5/27', ref)).toEqual({ ok: true, value: '2027-01-05' });
    expect(parseDateInput('Feb 30', ref)).toMatchObject({ ok: false });
    expect(parseDateInput('2026-13-01', ref)).toMatchObject({ ok: false });
    expect(parseDateInput('Novx 12', ref)).toMatchObject({ ok: false });
    expect(parseDateInput('soon', ref)).toMatchObject({ ok: false, error: '"soon" is not a date; write e.g. Nov 10 or 2026-11-10' });
  });

  it('reads actual dates, where empty or a dash clears the date', () => {
    expect(parseActualDate('Nov 4', '2026-11-10')).toEqual({ ok: true, value: '2026-11-04' });
    expect(parseActualDate('  ', '2026-11-10')).toEqual({ ok: true, value: null });
    expect(parseActualDate('—', '2026-11-10')).toEqual({ ok: true, value: null });
    expect(parseActualDate('-', '2026-11-10')).toEqual({ ok: true, value: null });
    expect(parseActualDate('later', '2026-11-10')).toMatchObject({ ok: false });
  });

  it('picks the nearest year when none is typed', () => {
    expect(parseDateInput('Jan 4', '2026-12-28')).toEqual({ ok: true, value: '2027-01-04' });
    expect(parseDateInput('1/4', '2026-12-28')).toEqual({ ok: true, value: '2027-01-04' });
    expect(parseDateInput('Dec 30', '2027-01-02')).toEqual({ ok: true, value: '2026-12-30' });
    expect(parseDateInput('Sep 1', '2026-12-28')).toEqual({ ok: true, value: '2026-09-01' });
    expect(parseDateInput('Feb 29', '2027-12-01')).toEqual({ ok: true, value: '2028-02-29' });
  });

  it('keeps milestones at zero duration when the type changes', () => {
    expect(typeChangePatch({ type: 'task', durationDays: 4 }, 'milestone')).toEqual({ type: 'milestone', durationDays: 0 });
    expect(typeChangePatch({ type: 'milestone', durationDays: 0 }, 'hold')).toEqual({ type: 'hold', durationDays: 1 });
    expect(typeChangePatch({ type: 'task', durationDays: 4 }, 'witness')).toEqual({ type: 'witness' });
    expect(typeChangePatch({ type: 'hold', durationDays: 0 }, 'task')).toEqual({ type: 'task' });
  });

  describe('float note', () => {
    const p = riversideProject();
    const v = scheduleView(p);
    const task = (id: string) => p.tasks.find((t) => t.id === id)!;

    it('names the next milestone of a critical task, as in 01-Main', () => {
      expect(v.schedule['t1.4']!.critical).toBe(true);
      const n = floatNote(p, task('t1.4'), v.schedule, v.projectFinish);
      const energize = v.schedule['t1.6']!.start;
      expect(n).toMatchObject({ kind: 'critical', float: 0 });
      expect(n!.text).toBe(`0 days of float. A slip here moves energization on ${shortOf(energize)}.`);
    });

    it('adds the asset tag when the milestone belongs to another asset', () => {
      // With SWGR-1A's energization made an ordinary task, the next milestone after 1.4 is XFMR-1A's (via 1.5 -> 2.5).
      const q = { ...p, tasks: p.tasks.map((t) => (t.id === 't1.6' ? { ...t, type: 'task' as const, durationDays: 1 } : t)) };
      const qv = scheduleView(q);
      const n = floatNote(q, task('t1.4'), qv.schedule, qv.projectFinish);
      expect(n).toMatchObject({ kind: 'critical' });
      expect(n!.text).toBe(`0 days of float. A slip here moves XFMR-1A energization on ${shortOf(qv.schedule['t2.5']!.start)}.`);
    });

    it('falls back to the project finish, shows float otherwise, and says complete for finished work', () => {
      expect(floatNote(p, task('t3.4'), v.schedule, v.projectFinish)).toEqual({
        kind: 'critical', float: 0, text: `0 days of float. A slip here moves the project finish on ${shortOf(v.projectFinish!)}.`,
      });
      expect(floatNote(p, task('t4.1'), v.schedule, v.projectFinish)).toEqual({ kind: 'float', float: 1, text: 'Float: 1 day' });
      expect(floatNote(p, task('t2.3'), v.schedule, v.projectFinish)).toEqual({ kind: 'float', float: 15, text: 'Float: 15 days' });
      expect(floatNote(p, task('t1.1'), v.schedule, v.projectFinish)).toEqual({ kind: 'done', text: 'Complete.' });
      expect(floatNote(p, task('t1.4'), {}, null)).toBeNull();
    });
  });
});

function shortOf(iso: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
}
