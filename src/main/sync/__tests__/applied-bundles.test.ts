import { describe, test, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { AppliedBundles } from '../applied-bundles';

describe('AppliedBundles', () => {
  let db: Database.Database;
  let applied: AppliedBundles;

  beforeEach(() => {
    db = new Database(':memory:');
    applied = new AppliedBundles(db);
  });

  test('creates table on construction', () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='applied_bundles'",
      )
      .all();
    expect(tables).toHaveLength(1);
  });

  test('insert + hasApplied', () => {
    expect(applied.hasApplied('bundle-1')).toBe(false);
    applied.insert('bundle-1', 'device-a', 1);
    expect(applied.hasApplied('bundle-1')).toBe(true);
  });

  test('duplicate insert does not throw', () => {
    applied.insert('bundle-1', 'device-a', 1);
    expect(() => applied.insert('bundle-1', 'device-a', 1)).not.toThrow();
    expect(applied.count()).toBe(1);
  });

  test('getLatestSequence returns correct value', () => {
    applied.insert('b1', 'device-a', 3);
    applied.insert('b2', 'device-a', 7);
    applied.insert('b3', 'device-a', 5);
    expect(applied.getLatestSequence('device-a')).toBe(7);
  });

  test('getLatestSequence returns null for unknown device', () => {
    expect(applied.getLatestSequence('unknown')).toBeNull();
  });

  test('count works', () => {
    expect(applied.count()).toBe(0);
    applied.insert('b1', 'device-a', 1);
    applied.insert('b2', 'device-b', 1);
    expect(applied.count()).toBe(2);
  });

  test('constructor is idempotent (table already exists)', () => {
    const applied2 = new AppliedBundles(db);
    applied.insert('b1', 'd1', 1);
    expect(applied2.hasApplied('b1')).toBe(true);
  });
});
