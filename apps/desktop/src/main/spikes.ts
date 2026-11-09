/**
 * Headless checks, run with `electron . --spike-pdf --spike-sqlite --spike-session [--out dir]`.
 * The sample-project demo lives here: the app itself only opens real project files.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { largeProject, riversideProject } from '@cx/fixtures';
import { ProjectLockedError, ProjectStore } from '@cx/storage';
import { FileController } from './files.js';
import { RecentFiles, SettingsFile } from './prefs.js';
import { ScriptedDialogs } from './scripted-dialogs.js';
import { Session } from './session.js';
import { fullScheduleDocument, htmlToPdf, lookAheadDocument } from './print.js';

type Result = { name: string; ok: boolean; detail: string };

export async function runSpikes(args: string[]): Promise<Result[]> {
  const outIdx = args.indexOf('--out');
  const out = resolve(outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1]! : 'spike-output/electron');
  mkdirSync(out, { recursive: true });
  const results: Result[] = [];
  const check = (name: string, fn: () => string | Promise<string>) =>
    Promise.resolve()
      .then(fn)
      .then((detail) => results.push({ name, ok: true, detail }))
      .catch((e: Error) => results.push({ name, ok: false, detail: e.stack ?? e.message }));

  if (args.includes('--spike-sqlite')) {
    await check('sqlite: node:sqlite available in Electron', async () => {
      const { DatabaseSync } = await import('node:sqlite');
      const v = (new DatabaseSync(':memory:').prepare('select sqlite_version() v').get() as { v: string }).v;
      return `Electron ${process.versions.electron}, Node ${process.versions.node}, SQLite ${v}`;
    });
    await check('sqlite: create, save, reopen, lock', () => {
      const dir = mkdtempSync(join(tmpdir(), 'cx-spike-'));
      const file = join(dir, 'Riverside.cxp');
      const s = ProjectStore.open(file, { create: true });
      s.replaceProject(riversideProject(), 'spike');
      let refused = false;
      try {
        ProjectStore.open(file);
      } catch (e) {
        refused = e instanceof ProjectLockedError;
      }
      s.close();
      if (!refused) throw new Error('second writer was not refused');
      const again = ProjectStore.open(file);
      const n = again.loadProject().tasks.length;
      again.close();
      return `${n} tasks round-tripped; second writer refused; backup written`;
    });
  }

  if (args.includes('--spike-session')) {
    await check('session: new project, edit, undo, redo, save as, reopen', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'cx-session-'));
      const dialogs = new ScriptedDialogs();
      let broadcasts = 0;
      const recent = new RecentFiles(join(dir, 'user', 'recent.json'));
      const session = new Session({ broadcast: () => broadcasts++, recent: () => recent.entries() });
      const files = new FileController({ session, dialogs, recent, settings: new SettingsFile(join(dir, 'user', 'settings.json')), defaultWorkspace: join(dir, 'Workspace') });
      try {
        dialogs.push({ message: 0, expect: 'workspace' });
        await files.ensureWorkspace();
        const tpl = session.listTemplates();
        if (!tpl.ok || tpl.value.length === 0) throw new Error('no starter templates in the new workspace');
        const template = session.getTemplate(tpl.value[0]!.id);
        if (!template.ok) throw new Error(template.message);
        const file = join(dir, 'Workspace', 'Spike.cxp');
        dialogs.push({ save: file });
        const created = await files.newProject({ name: 'Spike', startDate: '2026-11-02' });
        if (!created.ok) throw new Error(created.message);
        const added = session.apply({ kind: 'addAssetsFromTemplate', template: template.value, assets: [{ tag: 'SWGR-1A', description: 'Switchgear' }] });
        if (!added.ok) throw new Error(added.message);
        const n = session.project!.tasks.length;
        session.undo();
        if (session.project!.tasks.length !== 0) throw new Error('undo left tasks behind');
        session.redo();
        const copy = join(dir, 'Spike copy.cxp');
        dialogs.push({ save: copy });
        const saved = await files.saveAs();
        if (!saved.ok) throw new Error(saved.message);
        files.close();
        const reopened = await files.openRecent(copy);
        if (!reopened.ok) throw new Error(reopened.message);
        const state = session.getState();
        if (state.project!.tasks.length !== n || Object.keys(state.schedule).length !== n) throw new Error('reopened copy lost tasks');
        return `${n} tasks added, undone, redone, copied and reopened; ${broadcasts} state broadcasts; finish ${state.projectFinish}`;
      } finally {
        session.dispose();
      }
    });
  }

  if (args.includes('--spike-pdf')) {
    const riverside = riversideProject();
    const jobs: Array<[string, { html: string; sheets: number }]> = [
      ['lookahead-tabloid', lookAheadDocument(riverside, { paper: 'tabloid', weeks: 3 })],
      ['lookahead-letter', lookAheadDocument(riverside, { paper: 'letter', weeks: 3 })],
      ['full-schedule-ansi-d', fullScheduleDocument(largeProject(), 'ansi-d')],
      ['full-schedule-arch-d', fullScheduleDocument(largeProject(), 'arch-d')],
    ];
    for (const [name, doc] of jobs) {
      await check(`pdf: ${name}`, async () => {
        const pdf = await htmlToPdf(doc.html);
        writeFileSync(join(out, `${name}.pdf`), pdf);
        const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
        if (pages !== doc.sheets) throw new Error(`expected ${doc.sheets} pages, PDF has ${pages}`);
        return `${pages} page(s), ${(pdf.length / 1024).toFixed(0)} KB`;
      });
    }
  }
  writeFileSync(join(out, 'spike-results.json'), JSON.stringify(results, null, 2));
  return results;
}
