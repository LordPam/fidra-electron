import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { loadGlobalSettings, saveGlobalSettings } from '../window/global-settings';

/**
 * Device identity for Local Sync.
 *
 * The device ID is per-database, stored in the non-CRR `sync_meta` table.
 * This aligns with cr-sqlite's per-database `site_id` and ensures two databases
 * on the same machine (e.g., after migration) can sync with each other.
 *
 * The device name is per-machine, stored in global settings (informational only).
 */

const SYNC_META_DEVICE_ID = 'device.id';
const SYNC_META_DEVICE_CREATED = 'device.createdAt';

export interface DeviceIdentity {
  deviceId: string;
  deviceName: string;
  createdAt: string;
}

/**
 * Get the device identity for a specific database.
 * Returns null if not yet initialized.
 */
export function getDeviceIdentity(db: Database.Database): DeviceIdentity | null {
  const row = db
    .prepare('SELECT value FROM sync_meta WHERE key = ?')
    .get(SYNC_META_DEVICE_ID) as { value: string } | undefined;
  if (!row) return null;

  const createdRow = db
    .prepare('SELECT value FROM sync_meta WHERE key = ?')
    .get(SYNC_META_DEVICE_CREATED) as { value: string } | undefined;

  return {
    deviceId: row.value,
    deviceName: getDeviceName(),
    createdAt: createdRow?.value ?? '',
  };
}

/**
 * Initialize device identity for a database. Generates a new UUID if none exists.
 * Device name comes from the machine hostname, stored in global settings.
 */
export function initializeDeviceIdentity(db: Database.Database, deviceName: string): DeviceIdentity {
  const existing = getDeviceIdentity(db);
  if (existing) return existing;

  const deviceId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare(
    'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(SYNC_META_DEVICE_ID, deviceId);
  db.prepare(
    'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(SYNC_META_DEVICE_CREATED, createdAt);

  // Store device name in global settings (informational, per-machine)
  ensureDeviceName(deviceName);

  return { deviceId, deviceName, createdAt };
}

export function updateDeviceName(name: string): void {
  const settings = loadGlobalSettings();
  settings.localSyncDeviceName = name;
  saveGlobalSettings(settings);
}

export function getDeviceName(): string {
  const settings = loadGlobalSettings();
  return settings.localSyncDeviceName ?? '';
}

function ensureDeviceName(name: string): void {
  const settings = loadGlobalSettings();
  if (!settings.localSyncDeviceName) {
    settings.localSyncDeviceName = name;
    saveGlobalSettings(settings);
  }
}
