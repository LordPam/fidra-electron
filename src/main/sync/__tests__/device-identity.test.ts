import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GlobalSettings } from '../../../shared/global-settings-types';

// Mock state — vi.mock is hoisted above imports by vitest
const mockSettings: { current: GlobalSettings } = {
  current: null!,  // reset in beforeEach
};

vi.mock('../../window/global-settings', () => ({
  loadGlobalSettings: () => ({ ...mockSettings.current }),
  saveGlobalSettings: (s: GlobalSettings) => { mockSettings.current = s; },
}));

// vitest hoists vi.mock above this import, so the mock is in place
import { getDeviceIdentity, initializeDeviceIdentity, updateDeviceName, getDeviceName } from '../device-identity';

function freshSettings(): GlobalSettings {
  return {
    recentFiles: [],
    lastFile: null,
    lastOpenedAt: null,
    alwaysShowFileChooser: false,
    firstRunComplete: false,
    cloudServers: [],
    activeServerId: null,
    uiPreferences: {
      tableZoom: 0.8,
      plannedTableZoom: 0.8,
      activitiesTableZoom: 0.8,
      showPlanned: false,
      filteredBalanceMode: false,
      theme: 'system',
      reportOrgName: '',
    },
  };
}

/** Simple in-memory mock for the sync_meta table used by device-identity. */
function createMockDb() {
  const store = new Map<string, string>();
  return {
    prepare: (sql: string) => ({
      get: (...args: unknown[]) => {
        const key = args[0] as string;
        if (sql.includes('SELECT')) {
          const val = store.get(key);
          return val !== undefined ? { value: val } : undefined;
        }
        return undefined;
      },
      run: (...args: unknown[]) => {
        if (sql.includes('INSERT') || sql.includes('UPDATE')) {
          const key = args[0] as string;
          const value = args[1] as string;
          store.set(key, value);
        }
      },
    }),
    _store: store,
  } as unknown as import('better-sqlite3').Database;
}

describe('device-identity (per-database)', () => {
  let db: import('better-sqlite3').Database;

  beforeEach(() => {
    mockSettings.current = freshSettings();
    db = createMockDb();
  });

  it('returns null when no identity configured', () => {
    expect(getDeviceIdentity(db)).toBeNull();
  });

  it('initializes and persists a device identity in sync_meta', () => {
    const identity = initializeDeviceIdentity(db, "Josh's MacBook");
    expect(identity.deviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(identity.deviceName).toBe("Josh's MacBook");
    expect(identity.createdAt).toBeTruthy();

    // Persisted in sync_meta
    const row = (db as unknown as { _store: Map<string, string> })._store.get('device.id');
    expect(row).toBe(identity.deviceId);
  });

  it('is idempotent — returns existing identity on second call', () => {
    const first = initializeDeviceIdentity(db, 'Device A');
    const second = initializeDeviceIdentity(db, 'Device B');
    expect(second.deviceId).toBe(first.deviceId);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('can read identity after initialization', () => {
    initializeDeviceIdentity(db, 'Test Device');
    const read = getDeviceIdentity(db);
    expect(read).not.toBeNull();
    expect(read!.deviceId).toBeTruthy();
  });

  it('two databases get different deviceIds', () => {
    const db2 = createMockDb();
    const id1 = initializeDeviceIdentity(db, 'Device');
    const id2 = initializeDeviceIdentity(db2, 'Device');
    expect(id1.deviceId).not.toBe(id2.deviceId);
  });

  it('device name is stored in global settings', () => {
    initializeDeviceIdentity(db, 'My Laptop');
    expect(mockSettings.current.localSyncDeviceName).toBe('My Laptop');
  });

  it('updates device name in global settings', () => {
    initializeDeviceIdentity(db, 'Old Name');
    updateDeviceName('New Name');
    expect(getDeviceName()).toBe('New Name');
  });

  it('getDeviceName returns empty string when not set', () => {
    expect(getDeviceName()).toBe('');
  });
});
