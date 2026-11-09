/** Headless M0 spike checks, run with `electron . --spike-pdf --spike-sqlite [--out dir]`. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { largeProject, riversideProject } from '@cx/fixtures';
import { ProjectLockedError, ProjectStore } from '@cx/storage';
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

  if (args.includes('--spike-pdf')) {
    const riverside = riversideProject();
    const jobs: Array<[string, { html: string; layout: { sheets: unknown[] } }]> = [
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
        if (pages !== doc.layout.sheets.length) throw new Error(`expected ${doc.layout.sheets.length} pages, PDF has ${pages}`);
        return `${pages} page(s), ${(pdf.length / 1024).toFixed(0)} KB`;
      });
    }
  }
  writeFileSync(join(out, 'spike-results.json'), JSON.stringify(results, null, 2));
  return results;
}
