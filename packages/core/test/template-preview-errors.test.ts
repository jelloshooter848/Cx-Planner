import { describe, expect, it, vi } from 'vitest';

// Stands in for data that passes validateTemplate but still trips the scheduler.
vi.mock('../src/schedule.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/schedule.js')>()),
  computeSchedule: () => {
    throw new Error('lag out of range');
  },
}));

const { blankTemplate, previewTemplate } = await import('../src/index.js');

describe('previewTemplate when scheduling fails', () => {
  it('returns the error as a problem instead of throwing', () => {
    const t = {
      ...blankTemplate('b', 'B'),
      tasks: [{ key: 'a', name: 'A', durationDays: 1, type: 'task' as const, trade: '', predecessors: [], checklist: [], requiredCerts: [] }],
    };
    expect(previewTemplate(t)).toEqual({
      ok: false,
      problems: [{ code: 'unschedulable', message: 'The schedule could not be worked out: lag out of range' }],
    });
  });
});
