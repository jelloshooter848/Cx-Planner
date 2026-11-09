import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';

export interface LockInfo {
  app: 'cx-planner';
  host: string;
  user: string;
  pid: number;
  openedAt: string;
}

export class ProjectLockedError extends Error {
  constructor(public readonly path: string, public readonly holder: LockInfo | undefined) {
    super(
      holder
        ? `Project is open by ${holder.user} on ${holder.host} since ${holder.openedAt}`
        : `Project is locked (unreadable lock file ${path})`,
    );
    this.name = 'ProjectLockedError';
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function currentUser(): string {
  try {
    return userInfo().username;
  } catch {
    return 'unknown';
  }
}

/**
 * Single-writer lock beside the project file (`<file>.lock`). SQLite's own locking is not
 * reliable over SMB shares, so the app refuses to open a project another session holds.
 * A lock left by a crashed process on this same machine is cleared automatically; a lock
 * from another machine can only be broken with `force` after the user confirms.
 */
export class FileLock {
  private constructor(public readonly lockPath: string, public readonly info: LockInfo) {}

  static acquire(lockPath: string, opts: { force?: boolean } = {}): FileLock {
    const info: LockInfo = { app: 'cx-planner', host: hostname(), user: currentUser(), pid: process.pid, openedAt: new Date().toISOString() };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        writeFileSync(lockPath, JSON.stringify(info, null, 2), { flag: 'wx' });
        return new FileLock(lockPath, info);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
      const holder = FileLock.read(lockPath);
      const stale = holder && holder.host === info.host && !pidAlive(holder.pid);
      if (stale || opts.force) {
        unlinkSync(lockPath);
        continue;
      }
      throw new ProjectLockedError(lockPath, holder);
    }
    throw new ProjectLockedError(lockPath, FileLock.read(lockPath));
  }

  static read(lockPath: string): LockInfo | undefined {
    try {
      return JSON.parse(readFileSync(lockPath, 'utf8')) as LockInfo;
    } catch {
      return undefined;
    }
  }

  release(): void {
    const holder = FileLock.read(this.lockPath);
    if (holder && holder.pid === this.info.pid && holder.host === this.info.host && holder.openedAt === this.info.openedAt) {
      unlinkSync(this.lockPath);
    }
  }
}
