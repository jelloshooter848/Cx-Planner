import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, Menu: {} }));
const { reportStep } = await import('../src/main/menu.js');
const { ScriptedDialogs } = await import('../src/main/scripted-dialogs.js');

describe('menu undo/redo', () => {
  it('shows a failed save, but not an empty undo stack', async () => {
    const dialogs = new ScriptedDialogs();
    await reportStep(dialogs, 'undo', { ok: false, code: 'nothing-to-undo', message: 'Nothing to undo' });
    await reportStep(dialogs, 'redo', { ok: false, code: 'nothing-to-redo', message: 'Nothing to redo' });
    await reportStep(dialogs, 'undo', { ok: true, value: undefined });
    expect(dialogs.shown).toEqual([]);
    dialogs.push({ message: 0, expect: 'Could not undo[\\s\\S]*disk full' });
    await reportStep(dialogs, 'undo', { ok: false, code: 'file-error', message: 'disk full' });
    expect(dialogs.remaining).toBe(0);
  });
});
