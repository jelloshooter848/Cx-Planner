import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export const BACKUP_DIR = '.cx-backups';

/**
 * Copy the project file into `<folder>/.cx-backups/` before it is opened, keeping the
 * newest `keep` copies. Called while holding the lock, so the copy is consistent.
 */
export function backupBeforeOpen(file: string, keep = 10, now = new Date()): string | undefined {
  if (!existsSync(file)) return undefined;
  const dir = join(dirname(file), BACKUP_DIR);
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  const base = basename(file);
  const target = join(dir, `${base}.${stamp}.bak`);
  copyFileSync(file, target);
  const mine = readdirSync(dir)
    .filter((f) => f.startsWith(`${base}.`) && f.endsWith('.bak'))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t || b.f.localeCompare(a.f));
  for (const old of mine.slice(keep)) unlinkSync(join(dir, old.f));
  return target;
}
