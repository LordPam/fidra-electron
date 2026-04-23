import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { AppliedBundles } from '../applied-bundles';
import { ensureSyncFolderStructure } from '../bundle-io';
import { scanForNewBundles } from '../bundle-scanner';

function writeBundle(syncDir: string, filename: string, content = 'data'): void {
  fs.writeFileSync(path.join(syncDir, filename), content);
}

describe('bundle-scanner', () => {
  let tmpDir: string;
  let syncDir: string;
  let db: Database.Database;
  let applied: AppliedBundles;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-test-'));
    ensureSyncFolderStructure(tmpDir);
    syncDir = path.join(tmpDir, 'sync');
    db = new Database(':memory:');
    applied = new AppliedBundles(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('finds bundles from other devices', () => {
    writeBundle(syncDir, 'other-device_0000000001.bundle');
    writeBundle(syncDir, 'other-device_0000000002.bundle');

    const results = scanForNewBundles(tmpDir, 'my-device', applied);
    expect(results).toHaveLength(2);
    expect(results[0].deviceId).toBe('other-device');
    expect(results[0].sequenceNumber).toBe(1);
    expect(results[1].sequenceNumber).toBe(2);
  });

  test('skips own device bundles', () => {
    writeBundle(syncDir, 'my-device_0000000001.bundle');
    writeBundle(syncDir, 'other_0000000001.bundle');

    const results = scanForNewBundles(tmpDir, 'my-device', applied);
    expect(results).toHaveLength(1);
    expect(results[0].deviceId).toBe('other');
  });

  test('skips .tmp files', () => {
    writeBundle(syncDir, 'other_0000000001.bundle');
    writeBundle(syncDir, 'other_0000000002.bundle.tmp');

    const results = scanForNewBundles(tmpDir, 'my-device', applied);
    expect(results).toHaveLength(1);
  });

  test('skips already-applied bundles by sequence number', () => {
    applied.insert('old-bundle-id', 'other', 5);

    writeBundle(syncDir, 'other_0000000003.bundle');
    writeBundle(syncDir, 'other_0000000005.bundle');
    writeBundle(syncDir, 'other_0000000006.bundle');

    const results = scanForNewBundles(tmpDir, 'my-device', applied);
    expect(results).toHaveLength(1);
    expect(results[0].sequenceNumber).toBe(6);
  });

  test('returns sorted by sequence number', () => {
    writeBundle(syncDir, 'other_0000000003.bundle');
    writeBundle(syncDir, 'other_0000000001.bundle');
    writeBundle(syncDir, 'other_0000000002.bundle');

    const results = scanForNewBundles(tmpDir, 'my-device', applied);
    expect(results.map((r) => r.sequenceNumber)).toEqual([1, 2, 3]);
  });

  test('handles empty directory', () => {
    const results = scanForNewBundles(tmpDir, 'my-device', applied);
    expect(results).toEqual([]);
  });

  test('handles missing sync/ subdirectory', () => {
    fs.rmSync(syncDir, { recursive: true });
    const results = scanForNewBundles(tmpDir, 'my-device', applied);
    expect(results).toEqual([]);
  });

  test('handles bundles from multiple devices', () => {
    writeBundle(syncDir, 'dev-a_0000000001.bundle');
    writeBundle(syncDir, 'dev-b_0000000001.bundle');
    writeBundle(syncDir, 'dev-b_0000000002.bundle');

    applied.insert('prev', 'dev-a', 1);

    const results = scanForNewBundles(tmpDir, 'my-device', applied);
    // dev-a seq 1 is already applied, only dev-b results
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.deviceId === 'dev-b')).toBe(true);
  });

  test('skips non-bundle files', () => {
    writeBundle(syncDir, 'readme.txt');
    writeBundle(syncDir, 'state.json');
    writeBundle(syncDir, 'other_0000000001.bundle');

    const results = scanForNewBundles(tmpDir, 'my-device', applied);
    expect(results).toHaveLength(1);
  });
});
