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

export interface RecentEntry {
  path: string;
  /** When the file was last opened (ISO timestamp); undefined in lists written before this was kept. */
  openedAt?: string;
}

/**
 * The last RECENT_LIMIT projects opened, most recent first, with when each was opened.
 * Stored as { entries: [{ path, openedAt }] }; the older { paths: [...] } form is still read.
 */
export class RecentFiles {
  constructor(
    public readonly file: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  entries(): RecentEntry[] {
    const raw = readJson(this.file) as { entries?: unknown; paths?: unknown } | undefined;
    const out: RecentEntry[] = [];
    const items: unknown[] = Array.isArray(raw?.entries) ? raw.entries : Array.isArray(raw?.paths) ? raw.paths : [];
    for (const item of items) {
      const path = typeof item === 'string' ? item : typeof item === 'object' && item !== null ? (item as { path?: unknown }).path : undefined;
      if (typeof path !== 'string' || path === '' || out.some((e) => samePath(e.path, path))) continue;
      const openedAt = typeof item === 'object' && item !== null ? (item as { openedAt?: unknown }).openedAt : undefined;
      out.push(typeof openedAt === 'string' && !Number.isNaN(Date.parse(openedAt)) ? { path, openedAt } : { path });
      if (out.length === RECENT_LIMIT) break;
    }
    return out;
  }

  list(): string[] {
    return this.entries().map((e) => e.path);
  }

  has(path: string): boolean {
    return this.list().some((p) => samePath(p, path));
  }

  /** Puts `path` first, opened now. */
  add(path: string): void {
    const full = resolve(path);
    const rest = this.entries().filter((e) => !samePath(e.path, full));
    this.write([{ path: full, openedAt: this.now().toISOString() }, ...rest]);
  }

  remove(path: string): void {
    this.write(this.entries().filter((e) => !samePath(e.path, path)));
  }

  private write(entries: RecentEntry[]): void {
    writeJson(this.file, { entries: entries.slice(0, RECENT_LIMIT) });
  }
}
