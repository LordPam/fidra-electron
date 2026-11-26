import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { CausalHistory } from '../causal-history';
import { assertSnapshotCausalContext } from '../causal-context';
import type { CrChangesetRow } from '../bundle-format';

function revision(site: number, value: string): CrChangesetRow {
  return { table: 'transactions', pk: Buffer.from('row'), cid: 'amount', val: value,
    col_version: 2, db_version: 1, site_id: Buffer.alloc(16, site), cl: 1, seq: 0 };
}

describe('causal history', () => {
  it('rejects invented snapshot coverage and duplicated revision provenance', () => {
    const db = new Database(':memory:');
    try {
      const history = new CausalHistory(db);
      history.record({ deviceId: 'a', sequenceNumber: 1, observed: {} }, [revision(1, '20.00')], true);
      const state = history.exportState();
      expect(() => assertSnapshotCausalContext(state, { a: [[1, 1]] })).not.toThrow();
      expect(() => assertSnapshotCausalContext(state, { a: [[1, 2]] })).toThrow('coverage disagrees');
      expect(() => assertSnapshotCausalContext({ ...state, revisions: [...state.revisions, ...state.revisions] }, { a: [[1, 1]] }))
        .toThrow('repeats revision provenance');
    } finally { db.close(); }
  });

  it('does not manufacture edit ancestry from a later relay of an unchanged revision', () => {
    const db = new Database(':memory:');
    try {
      const history = new CausalHistory(db);
      const a = revision(1, '20.00');
      const b = revision(2, '30.00');
      history.record({ deviceId: 'a', sequenceNumber: 1, observed: {} }, [a], true);
      history.record({ deviceId: 'b', sequenceNumber: 1, observed: {} }, [b], true);
      history.record({ deviceId: 'relay', sequenceNumber: 1, observed: { a: [[1, 1]], b: [[1, 1]] } }, [a], true);
      expect(history.dominates(a, b)).toBe(false);
      expect(history.remoteObserved(a, { deviceId: 'consumer', sequenceNumber: 1, observed: { relay: [[1, 1]] } })).toBe(false);
      expect(history.exportState().revisions).toHaveLength(2);
    } finally { db.close(); }
  });

  it('keeps missing sequence gaps and unreviewed bundles out of accepted ancestry', () => {
    const db = new Database(':memory:');
    try {
      const history = new CausalHistory(db);
      history.record({ deviceId: 'a', sequenceNumber: 1, observed: {} }, [], true);
      history.record({ deviceId: 'a', sequenceNumber: 3, observed: {} }, [], true);
      history.record({ deviceId: 'a', sequenceNumber: 4, observed: {} }, [], false);
      expect(history.observedContext()).toEqual({ a: [[1, 1], [3, 3]] });
      history.record({ deviceId: 'a', sequenceNumber: 2, observed: {} }, [], true);
      expect(history.observedContext()).toEqual({ a: [[1, 3]] });
    } finally { db.close(); }
  });
});
