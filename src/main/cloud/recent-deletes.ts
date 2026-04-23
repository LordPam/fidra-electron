/**
 * RecentDeletes — in-memory tombstone set for local deletes.
 *
 * Protects against zombie-resurrection in `refreshFromCloud`. When a row is
 * deleted locally, its id is marked here with a TTL. Any subsequent
 * refreshFromCloud skips rows whose id is still tombstoned, even after the
 * delete has been successfully synced upstream and dequeued. This covers the
 * gap between `SyncQueue` dequeue and cloud replication / LISTEN-NOTIFY
 * propagation, during which a stale cloud fetch could re-insert the row.
 *
 * One instance per `WindowContext` (created alongside `SyncQueue`).
 * In-memory only; rebuilt on window start.
 */

export type TombstoneEntityType =
  | 'transaction'
  | 'planned_template'
  | 'sheet'
  | 'attachment'
  | 'invoice';

const DEFAULT_TTL_MS = 60_000;

export class RecentDeletes {
  private readonly tombstones = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  private key(type: TombstoneEntityType, id: string): string {
    return `${type}:${id}`;
  }

  mark(type: TombstoneEntityType, id: string): void {
    this.tombstones.set(this.key(type, id), Date.now() + this.ttlMs);
  }

  markBulk(type: TombstoneEntityType, ids: readonly string[]): void {
    const expiry = Date.now() + this.ttlMs;
    for (const id of ids) {
      this.tombstones.set(this.key(type, id), expiry);
    }
  }

  has(type: TombstoneEntityType, id: string): boolean {
    const expiry = this.tombstones.get(this.key(type, id));
    if (expiry === undefined) return false;
    if (expiry <= Date.now()) {
      this.tombstones.delete(this.key(type, id));
      return false;
    }
    return true;
  }

  /** Drop a specific tombstone (e.g. after an explicit restore). */
  clear(type: TombstoneEntityType, id: string): void {
    this.tombstones.delete(this.key(type, id));
  }

  /** Remove all expired entries. Called opportunistically. */
  prune(): void {
    const now = Date.now();
    for (const [key, expiry] of this.tombstones) {
      if (expiry <= now) this.tombstones.delete(key);
    }
  }
}
