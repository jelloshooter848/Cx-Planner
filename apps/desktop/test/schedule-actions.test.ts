import { describe, expect, it } from 'vitest';
import { applyCommand, type Command, type Project } from '@cx/core';
import { riversideProject } from '@cx/fixtures';
import { addTaskAction, linkAction, moveTaskAction, NEW_TASK_NAME, shiftAction, type ToolAction } from '../src/renderer/views/Schedule/schedule-actions.js';

function run(project: Project, a: ToolAction): Project {
  if (!a.ok) throw new Error(a.reason);
  return applyCommand(project, a.command).project;
}
const codeOf = (p: Project, id: string) => p.tasks.find((t) => t.id === id)?.code;
const assetOf = (p: Project, id: string) => p.tasks.find((t) => t.id === id)?.assetId;

describe('schedule toolbar actions', () => {
  const p = riversideProject();

  it('adds a task after the selected one, in its asset', () => {
    expect(addTaskAction(p, null, 'n')).toEqual({ ok: false, reason: 'Select a task to add a new one after it' });
    const a = addTaskAction(p, 't1.3', 'new-1');
    expect(a).toMatchObject({ ok: true, label: 'Add a task after 1.3' });
    const next = run(p, a);
    const t = next.tasks.find((x) => x.id === 'new-1')!;
    expect(t).toMatchObject({ name: NEW_TASK_NAME, code: '1.4', assetId: 'swgr-1a', durationDays: 1, type: 'task' });
  });

  it('with no task selected, adds to an empty asset in view, or to the only asset in view', () => {
    const only = addTaskAction(p, null, 'n1', ['gen-1']);
    expect(only).toMatchObject({ ok: true, label: 'Add a task to GEN-1' });
    expect(run(p, only).tasks.filter((t) => t.assetId === 'gen-1').at(-1)).toMatchObject({ id: 'n1', code: '4.5' });
    // Empty XFMR-1A (its tasks moved away) takes the new task even with every asset in view.
    const emptied: Project = { ...p, tasks: p.tasks.filter((t) => t.assetId !== 'xfmr-1a'), dependencies: [] };
    const a = addTaskAction(emptied, null, 'n2');
    expect(a).toMatchObject({ ok: true, label: 'Add a task to XFMR-1A' });
    expect(run(emptied, a).tasks.find((t) => t.id === 'n2')).toMatchObject({ assetId: 'xfmr-1a', code: '2.1' });
  });

  it('links the first selected task finish-to-start before the second', () => {
    expect(linkAction(p, []).ok).toBe(false);
    expect(linkAction(p, ['t1.1'])).toEqual({ ok: false, reason: 'Select a task, then Ctrl+click a second task to link them' });
    expect(linkAction(p, ['t1.1'], true)).toEqual({ ok: false, reason: 'Select a task, then Cmd+click a second task to link them' });
    expect(linkAction(p, ['t1.1', 't2.1', 't3.1'])).toEqual({ ok: false, reason: 'Select exactly two tasks to link them' });
    expect(linkAction(p, ['t1.2', 't1.3'])).toEqual({ ok: false, reason: '1.3 already follows 1.2' });
    expect(linkAction(p, ['t1.3', 't1.2'])).toEqual({ ok: false, reason: '1.3 already follows 1.2' });
    // 1.4 → 1.5 → 1.6 → 3.1 already, so 3.1 before 1.4 would make a loop.
    expect(linkAction(p, ['t3.1', 't1.4'])).toEqual({ ok: false, reason: 'Linking would make a loop: 3.1 already comes after 1.4' });
    const a = linkAction(p, ['t1.4', 't3.1']);
    expect(a).toMatchObject({ ok: true, label: 'Link 1.4 → 3.1 (finish-to-start)' });
    const next = run(p, a);
    expect(next.dependencies).toContainEqual({ predecessorId: 't1.4', successorId: 't3.1', type: 'FS', lagDays: 0 });
  });

  it('indents into the asset above and outdents into the asset below', () => {
    expect(shiftAction(p, null, null, 'indent').ok).toBe(false);
    expect(shiftAction(p, 't1.2', null, 'indent')).toEqual({ ok: false, reason: '1.2 is in the first asset in view' });
    const ind = shiftAction(p, 't2.2', null, 'indent');
    expect(ind).toMatchObject({ ok: true, label: 'Move 2.2 into SWGR-1A (above)' });
    let next = run(p, ind);
    expect(assetOf(next, 't2.2')).toBe('swgr-1a');
    expect(codeOf(next, 't2.2')).toBe(`1.${next.tasks.filter((t) => t.assetId === 'swgr-1a').length}`);
    const out = shiftAction(next, 't2.2', null, 'outdent');
    expect(out).toMatchObject({ ok: true, label: `Move ${codeOf(next, 't2.2')} into XFMR-1A (below)` });
    next = run(next, out);
    expect([assetOf(next, 't2.2'), codeOf(next, 't2.2')]).toEqual(['xfmr-1a', '2.1']);
    const last = p.tasks.filter((t) => t.assetId === 'gen-1').at(-1)!;
    expect(shiftAction(p, last.id, null, 'outdent').ok).toBe(false);
  });

  it('skips assets hidden by the filter', () => {
    // With XFMR-1A hidden, the asset above UPS-1A is SWGR-1A.
    const a = shiftAction(p, 't3.1', ['swgr-1a', 'ups-1a'], 'indent');
    expect(a).toMatchObject({ ok: true, label: 'Move 3.1 into SWGR-1A (above)' });
    expect(shiftAction(p, 't3.1', ['swgr-1a', 'ups-1a'], 'outdent').ok).toBe(false);
  });

  it('moves a task up and down inside its asset', () => {
    expect(moveTaskAction(p, 't1.1', -1)).toEqual({ ok: false, reason: '1.1 is already first in its asset' });
    const down = moveTaskAction(p, 't1.1', 1);
    let next = run(p, down);
    expect([codeOf(next, 't1.1'), codeOf(next, 't1.2')]).toEqual(['1.2', '1.1']);
    next = run(next, moveTaskAction(next, 't1.1', -1));
    expect(next.tasks.map((t) => t.id)).toEqual(p.tasks.map((t) => t.id));
    const last = p.tasks.filter((t) => t.assetId === 'swgr-1a').at(-1)!;
    expect(moveTaskAction(p, last.id, 1).ok).toBe(false);
  });

  it('builds commands the core accepts as plain data', () => {
    const cmds = [addTaskAction(p, 't1.1', 'z'), linkAction(p, ['t1.4', 't2.1']), shiftAction(p, 't2.1', null, 'indent'), moveTaskAction(p, 't2.1', 1)];
    for (const a of cmds) {
      expect(a.ok).toBe(true);
      const cmd = (a as { command: Command }).command;
      expect(JSON.parse(JSON.stringify(cmd))).toEqual(cmd);
    }
  });
});
