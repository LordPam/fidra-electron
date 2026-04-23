import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ConflictQueue } from '../conflict-queue';
import type { InsertConflictParams } from '../conflict-queue';

let db: Database.Database;
let queue: ConflictQueue;

function makeParams(overrides: Partial<InsertConflictParams> = {}): InsertConflictParams {
  return {
    entity_type: 'transactions',
    entity_id: '["tx-1"]',
    field_name: 'amount',
    local_value: '100.00',
    remote_value: '200.00',
    local_site_id: 'aaa',
    remote_site_id: 'bbb',
    local_version: 1,
    remote_version: 2,
    bundle_id: 'bundle-1',
    changeset_json: '{"table":"transactions","pk":"tx-1","cid":"amount","val":"200.00","col_version":2,"db_version":10,"site_id":"bbbb","cl":1,"seq":0}',
    ...overrides,
  };
}

beforeEach(() => {
  db = new Database(':memory:');
  queue = new ConflictQueue(db);
});

afterEach(() => {
  db.close();
});

describe('ConflictQueue', () => {
  test('creates sync_conflicts table on construction', () => {
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='sync_conflicts'`,
      )
      .all();
    expect(tables).toHaveLength(1);
  });

  test('insert and retrieve', () => {
    const id = queue.insert(makeParams());
    expect(id).toBeTruthy();

    const unresolved = queue.getUnresolved();
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].id).toBe(id);
    expect(unresolved[0].entity_type).toBe('transactions');
    expect(unresolved[0].entity_id).toBe('["tx-1"]');
    expect(unresolved[0].field_name).toBe('amount');
    expect(unresolved[0].local_value).toBe('100.00');
    expect(unresolved[0].remote_value).toBe('200.00');
    expect(unresolved[0].resolved_at).toBeNull();
    expect(unresolved[0].resolution).toBeNull();
  });

  test('getUnresolved filters out resolved conflicts', () => {
    const id1 = queue.insert(makeParams({ field_name: 'amount' }));
    queue.insert(makeParams({ field_name: 'date' }));

    queue.resolve(id1, 'keep-local');

    const unresolved = queue.getUnresolved();
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].field_name).toBe('date');
  });

  test('resolve sets timestamp and resolution', () => {
    const id = queue.insert(makeParams());
    const resolved = queue.resolve(id, 'accept-remote');
    expect(resolved).toBe(true);

    const all = queue.getByEntityId('["tx-1"]');
    expect(all).toHaveLength(1);
    expect(all[0].resolved_at).toBeTruthy();
    expect(all[0].resolution).toBe('accept-remote');
  });

  test('resolve returns false for already-resolved conflict', () => {
    const id = queue.insert(makeParams());
    queue.resolve(id, 'keep-local');
    const result = queue.resolve(id, 'accept-remote');
    expect(result).toBe(false);
  });

  test('resolve returns false for non-existent id', () => {
    const result = queue.resolve('non-existent', 'keep-local');
    expect(result).toBe(false);
  });

  test('getByEntityId filters correctly', () => {
    queue.insert(makeParams({ entity_id: '["tx-1"]' }));
    queue.insert(makeParams({ entity_id: '["tx-2"]' }));
    queue.insert(makeParams({ entity_id: '["tx-1"]', field_name: 'date' }));

    const tx1 = queue.getByEntityId('["tx-1"]');
    expect(tx1).toHaveLength(2);

    const tx2 = queue.getByEntityId('["tx-2"]');
    expect(tx2).toHaveLength(1);

    const tx3 = queue.getByEntityId('["tx-3"]');
    expect(tx3).toHaveLength(0);
  });

  test('count returns number of unresolved conflicts', () => {
    expect(queue.count()).toBe(0);

    const id1 = queue.insert(makeParams({ field_name: 'amount' }));
    queue.insert(makeParams({ field_name: 'date' }));
    queue.insert(makeParams({ field_name: 'status' }));
    expect(queue.count()).toBe(3);

    queue.resolve(id1, 'keep-local');
    expect(queue.count()).toBe(2);
  });

  test('clear removes only resolved conflicts', () => {
    const id1 = queue.insert(makeParams({ field_name: 'amount' }));
    queue.insert(makeParams({ field_name: 'date' }));

    queue.resolve(id1, 'keep-local');
    const cleared = queue.clear();
    expect(cleared).toBe(1);

    // Unresolved one remains
    expect(queue.count()).toBe(1);
    expect(queue.getUnresolved()).toHaveLength(1);
  });

  test('clear returns 0 when nothing to clear', () => {
    queue.insert(makeParams());
    expect(queue.clear()).toBe(0); // nothing resolved yet
  });

  test('multiple conflicts for same entity and field', () => {
    queue.insert(makeParams({ bundle_id: 'bundle-1' }));
    queue.insert(makeParams({ bundle_id: 'bundle-2' }));

    expect(queue.count()).toBe(2);
    expect(queue.getByEntityId('["tx-1"]')).toHaveLength(2);
  });
});
