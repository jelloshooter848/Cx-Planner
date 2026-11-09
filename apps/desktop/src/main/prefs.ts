/** Small JSON files in the app's userData folder: settings.json and recent.json. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const RECENT_LIMIT = 10;

export interface Settings {
  /** Folder holding workspace.cxw. Unset until the user picks one on first run. */
  workspacePath?: string;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    // Missing or damaged: start over rather than refuse to start.
    return undefined;
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

export class SettingsFile {
  constructor(public readonly file: string) {}

  get(): Settings {
    const raw = readJson(this.file);
    if (typeof raw !== 'object' || raw === null) return {};
    const ws = (raw as Record<string, unknown>).workspacePath;
    return typeof ws === 'string' && ws !== '' ? { workspacePath: ws } : {};
  }

  update(patch: Partial<Settings>): void {
    writeJson(this.file, { ...this.get(), ...patch });
  }
}

/** Same file? Case-insensitive on Windows and macOS, whose usual file systems are. */
export function samePath(a: string, b: string): boolean {
  const ra = resolve(a);
  const rb = resolve(b);
  return process.platform === 'linux' ? ra === rb : ra.toLowerCase() === rb.toLowerCase();
}

/** The last RECENT_LIMIT project paths opened, most recent first. */
export class RecentFiles {
  constructor(public readonly file: string) {}

  list(): string[] {
    const raw = readJson(this.file);
    const paths = (raw as { paths?: unknown } | undefined)?.paths;
    return Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string' && p !== '').slice(0, RECENT_LIMIT) : [];
  }

  has(path: string): boolean {
    return this.list().some((p) => samePath(p, path));
  }

  add(path: string): void {
    const full = resolve(path);
    writeJson(this.file, { paths: [full, ...this.list().filter((p) => !samePath(p, full))].slice(0, RECENT_LIMIT) });
  }

  remove(path: string): void {
    writeJson(this.file, { paths: this.list().filter((p) => !samePath(p, path)) });
  }
}
