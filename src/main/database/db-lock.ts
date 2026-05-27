import fs from 'node:fs';
import os from 'node:os';
import { loadGlobalSettings } from '../window/global-settings';

export interface LockFileData {
  deviceName: string;
  hostname: string;
  pid: number;
  openedAt: string;
}

export interface LockConflict {
  deviceName: string;
  hostname: string;
  pid: number;
  openedAt: string;
}

export function lockFilePath(dbPath: string): string {
  return `${dbPath}.lock`;
}

/**
 * Acquire an advisory lock on a database file.
 *
 * Reads any existing lock file. If one exists from a different device
 * (different hostname), returns the conflict info so the caller can warn
 * the user. Then writes a new lock file for this device.
 *
 * If the existing lock is from the same hostname + PID (re-open / focus),
 * overwrites silently (no conflict).
 *
 * Returns `null` if no conflict, or a `LockConflict` describing the
 * existing lock holder.
 */
export function acquireDbLock(dbPath: string): LockConflict | null {
  const lockPath = lockFilePath(dbPath);
  let conflict: LockConflict | null = null;

  // Check for existing lock
  try {
    const raw = fs.readFileSync(lockPath, 'utf-8');
    const existing = JSON.parse(raw) as LockFileData;

    const sameHost = existing.hostname === os.hostname();
    const samePid = existing.pid === process.pid;

    // Only report conflict if it's a different device, or same device but different PID
    if (!sameHost || !samePid) {
      conflict = {
        deviceName: existing.deviceName,
        hostname: existing.hostname,
        pid: existing.pid,
        openedAt: existing.openedAt,
      };
    }
  } catch {
    // No lock file, unreadable, or invalid JSON — proceed without conflict
  }

  // Write our lock
  const settings = loadGlobalSettings();
  const deviceName = settings.localSyncDeviceName || os.hostname();

  const lock: LockFileData = {
    deviceName,
    hostname: os.hostname(),
    pid: process.pid,
    openedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), 'utf-8');
  } catch {
    // Advisory only — never block the user
  }

  return conflict;
}

/**
 * Release the advisory lock on a database file.
 * Best-effort: swallows all errors so it never blocks shutdown.
 */
export function releaseDbLock(dbPath: string): void {
  try {
    const lockPath = lockFilePath(dbPath);
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // Best-effort — never block shutdown
  }
}
