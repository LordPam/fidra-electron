import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { serializeChangesetRow, type CrChangesetRow } from './bundle-format';
import { contextIncludes, causalContextSchema, causalStateSchema, canonicalContext, type CausalContext, type CausalState } from './causal-context';

export interface BundleCausality { deviceId: string; sequenceNumber: number; observed: CausalContext }

function revisionKey(row: CrChangesetRow): unknown[] {
  const serialized = serializeChangesetRow(row);
  const value = JSON.stringify(serialized.val ?? null);
  return [row.table, Buffer.isBuffer(row.pk) ? row.pk.toString('hex') : Buffer.from(row.pk).toString('hex'),
    row.cid, row.site_id.toString('hex'), row.col_version, row.cl, row.seq,
    crypto.createHash('sha256').update(value).digest('hex')];
}

/** Exact exported revisions and observed bundles, never inferred from column
 * version magnitude, local export success, timestamps or remote receipt files.
 */
export class CausalHistory {
  constructor(private readonly db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS sync_causal_bundles (
      device_id TEXT NOT NULL, sequence_number INTEGER NOT NULL, observed TEXT NOT NULL,
      accepted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(device_id, sequence_number)
    );
    CREATE TABLE IF NOT EXISTS sync_change_provenance (
      table_name TEXT NOT NULL, pk_hex TEXT NOT NULL, cid TEXT NOT NULL, site_hex TEXT NOT NULL,
      col_version INTEGER NOT NULL, causal_length INTEGER NOT NULL, seq INTEGER NOT NULL, value_hash TEXT NOT NULL,
      source_device TEXT NOT NULL, source_sequence INTEGER NOT NULL,
      PRIMARY KEY(table_name, pk_hex, cid, site_hex, col_version, causal_length, seq, value_hash, source_device, source_sequence)
    )`);
  }

  observedContext(): CausalContext {
    const context: CausalContext = Object.create(null) as CausalContext;
    const accepted = this.db.prepare(`SELECT device_id, sequence_number FROM sync_causal_bundles
      WHERE accepted = 1 ORDER BY device_id, sequence_number`).all() as { device_id: string; sequence_number: number }[];
    for (const row of accepted) {
      const ranges = context[row.device_id] ??= [];
      const last = ranges[ranges.length - 1];
      if (last && last[1] + 1 === row.sequence_number) last[1] = row.sequence_number;
      else ranges.push([row.sequence_number, row.sequence_number]);
    }
    return context;
  }

  /** Called in the same DB transaction as the bundle/outbox or inbound commit. */
  record(bundle: BundleCausality, rows: CrChangesetRow[], accepted: boolean): void {
    const observed = causalContextSchema.parse(bundle.observed);
    const previous = this.db.prepare('SELECT observed FROM sync_causal_bundles WHERE device_id = ? AND sequence_number = ?')
      .get(bundle.deviceId, bundle.sequenceNumber) as { observed: string } | undefined;
    if (previous && canonicalContext(causalContextSchema.parse(JSON.parse(previous.observed))) !== canonicalContext(observed)) {
      throw new Error('Conflicting causal history for the same bundle identity. Review is required.');
    }
    this.db.prepare(`INSERT INTO sync_causal_bundles (device_id, sequence_number, observed, accepted)
      VALUES (?, ?, ?, ?) ON CONFLICT(device_id, sequence_number) DO UPDATE SET accepted = MAX(accepted, excluded.accepted)`)
      .run(bundle.deviceId, bundle.sequenceNumber, JSON.stringify(observed), accepted ? 1 : 0);
    const insert = this.db.prepare(`INSERT OR IGNORE INTO sync_change_provenance
      (table_name, pk_hex, cid, site_hex, col_version, causal_length, seq, value_hash, source_device, source_sequence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    // Receipt/relay time is not revision creation time. A later bundle carrying
    // identical bytes must never manufacture ancestry for an older edit.
    for (const row of rows) if (!this.hasRevision(row)) insert.run(...revisionKey(row), bundle.deviceId, bundle.sequenceNumber);
  }

  remoteObserved(revision: CrChangesetRow, incoming: BundleCausality): boolean {
    return this.origins(revision).some((origin) => contextIncludes(incoming.observed, origin.source_device, origin.source_sequence));
  }

  localObservedIncoming(revision: CrChangesetRow, incoming: BundleCausality): boolean {
    return this.origins(revision).some((origin) => {
      const basis = this.db.prepare('SELECT observed FROM sync_causal_bundles WHERE device_id = ? AND sequence_number = ?')
        .get(origin.source_device, origin.source_sequence) as { observed: string } | undefined;
      return basis ? contextIncludes(causalContextSchema.parse(JSON.parse(basis.observed)), incoming.deviceId, incoming.sequenceNumber) : false;
    });
  }

  dominates(descendant: CrChangesetRow, ancestor: CrChangesetRow): boolean {
    const left = revisionKey(descendant);
    const right = revisionKey(ancestor);
    if (left[0] !== right[0] || left[1] !== right[1]) return false;
    if (descendant.site_id.equals(ancestor.site_id)) {
      if (descendant.cl > ancestor.cl) return true;
      if (descendant.cl === ancestor.cl && descendant.cid === ancestor.cid
        && (descendant.col_version > ancestor.col_version || left.slice(2).every((value, index) => value === right[index + 2]))) return true;
    }
    const ancestors = this.origins(ancestor);
    return this.origins(descendant).some((origin) => {
      const basis = this.db.prepare('SELECT observed FROM sync_causal_bundles WHERE device_id = ? AND sequence_number = ?')
        .get(origin.source_device, origin.source_sequence) as { observed: string } | undefined;
      if (!basis) return false;
      const observed = causalContextSchema.parse(JSON.parse(basis.observed));
      return ancestors.some((source) => contextIncludes(observed, source.source_device, source.source_sequence));
    });
  }

  promoteReviewedBundle(bundleId: string): void {
    this.db.prepare(`UPDATE sync_causal_bundles SET accepted = 1 WHERE (device_id, sequence_number) IN
      (SELECT device_id, sequence_number FROM applied_bundles WHERE bundle_id = ?)
      AND NOT EXISTS (SELECT 1 FROM sync_conflicts WHERE bundle_id = ? AND resolved_at IS NULL)`)
      .run(bundleId, bundleId);
  }

  exportState(): CausalState {
    const bundles = this.db.prepare(`SELECT device_id AS deviceId, sequence_number AS sequenceNumber, observed, accepted
      FROM sync_causal_bundles ORDER BY device_id, sequence_number`).all() as { deviceId: string; sequenceNumber: number; observed: string; accepted: number }[];
    const revisions = this.db.prepare(`SELECT table_name AS tableName, pk_hex AS pkHex, cid, site_hex AS siteHex,
      col_version AS colVersion, causal_length AS causalLength, seq, value_hash AS valueHash,
      source_device AS sourceDevice, source_sequence AS sourceSequence FROM sync_change_provenance`).all() as CausalState['revisions'];
    return { bundles: bundles.map((row) => ({ ...row, observed: causalContextSchema.parse(JSON.parse(row.observed)), accepted: row.accepted === 1 })), revisions };
  }

  hasAcceptedRevision(revision: CrChangesetRow): boolean {
    return this.origins(revision).some((origin) => this.db.prepare(`SELECT 1 FROM sync_causal_bundles
      WHERE device_id = ? AND sequence_number = ? AND accepted = 1`).get(origin.source_device, origin.source_sequence) !== undefined);
  }

  hasRevision(revision: CrChangesetRow): boolean { return this.origins(revision).length > 0; }

  restoreState(state: CausalState): void {
    const parsed = causalStateSchema.parse(state);
    for (const bundle of parsed.bundles) this.record(bundle, [], bundle.accepted);
    const insert = this.db.prepare(`INSERT OR IGNORE INTO sync_change_provenance
      (table_name, pk_hex, cid, site_hex, col_version, causal_length, seq, value_hash, source_device, source_sequence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const row of parsed.revisions) insert.run(row.tableName, row.pkHex, row.cid, row.siteHex,
      row.colVersion, row.causalLength, row.seq, row.valueHash, row.sourceDevice, row.sourceSequence);
  }

  private origins(revision: CrChangesetRow): { source_device: string; source_sequence: number }[] {
    return this.db.prepare(`SELECT source_device, source_sequence FROM sync_change_provenance
      WHERE table_name = ? AND pk_hex = ? AND cid = ? AND site_hex = ? AND col_version = ? AND causal_length = ? AND seq = ? AND value_hash = ?`)
      .all(...revisionKey(revision)) as { source_device: string; source_sequence: number }[];
  }
}
