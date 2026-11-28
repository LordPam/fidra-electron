import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { SYNCED_TABLES } from './crr-schema';
import { isOrgKey } from '../database/settings-repo';
import { isOrgChangeset } from './settings-filter';
import { serializeChangesetRow, type CrChangesetRow } from './bundle-format';
import { toPence } from '../../shared/money';
import type { RecoveryAccountSummary } from '../../shared/sync-recovery-types';
import type { RecoveryPreview } from '../../shared/sync-recovery-types';

export type DomainRow = Record<string, string | number | null | Buffer>;
export type LedgerState = Record<string, DomainRow[]>;
export function sha256(bytes: Buffer | string): string { return crypto.createHash('sha256').update(bytes).digest('hex'); }

export function readLedgerState(db: Database.Database): LedgerState {
  const state: LedgerState = {};
  for (const table of SYNCED_TABLES) {
    const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; pk: number }[];
    const primary = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk);
    const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY ${primary.map((column) => `"${column.name}"`).join(', ')}`).all() as DomainRow[];
    state[table] = table === 'settings' ? rows.filter((row) => isOrgKey(String(row.key))) : rows;
  }
  return state;
}

/** Excludes append-only audit/session credentials from the financial convergence
 * proof. Critical personnel identity is included, as are actual attachment hashes.
 */
export function ledgerDigest(state: LedgerState, attachmentHashes: Record<string, string> = {}): string {
  const canonical: LedgerState = {};
  for (const table of [...SYNCED_TABLES].sort()) {
    if (table === 'audit_log') continue;
    canonical[table] = (state[table] ?? []).map((row) => table === 'personnel'
      ? { id: row.id, name: row.name, email: row.email, role: row.role }
      : row);
  }
  return sha256(JSON.stringify({ state: canonical, attachments: Object.fromEntries(Object.entries(attachmentHashes).sort(([a], [b]) => a.localeCompare(b))) }));
}

export function currentChanges(db: Database.Database): CrChangesetRow[] {
  return db.prepare('SELECT "table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq" FROM crsql_changes ORDER BY "table", pk, cid')
    .all() as CrChangesetRow[];
}

/** Includes review state and local recovery generation, so another window cannot
 * publish an older review after a local edit or another cutover. */
export function sourceFingerprint(db: Database.Database): string {
  const rows = currentChanges(db).filter(isOrgChangeset).map((row) => ({ ...serializeChangesetRow(row), db_version: 0 }));
  const hasQueue = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_conflicts'").get();
  const conflicts = hasQueue ? db.prepare('SELECT * FROM sync_conflicts ORDER BY id').all() : [];
  const publication = db.prepare("SELECT key, value FROM sync_meta WHERE key IN ('recovery.published', 'folder.binding.v1') ORDER BY key").all();
  return sha256(JSON.stringify({ rows, conflicts, publication }));
}

function rowId(row: DomainRow): string { return String(row.id ?? row.key ?? row.activity); }

/** Reviewable values only. Credentials, key wrapping and local session data must
 * never be sent to the renderer as part of a recovery comparison. */
export function ledgerChanges(before: LedgerState, after: LedgerState): RecoveryPreview['changes'] {
  const result: RecoveryPreview['changes'] = [];
  const visible = (table: string, row?: DomainRow): Record<string, string | number | null> | null => {
    if (!row) return null;
    return Object.fromEntries(Object.entries(row).filter(([key]) => table !== 'personnel' || ['id', 'name', 'email', 'role'].includes(key))
      .map(([key, value]) => [key, Buffer.isBuffer(value) ? value.toString('hex') : value]));
  };
  for (const table of SYNCED_TABLES) {
    if (table === 'audit_log') continue;
    const left = new Map((before[table] ?? []).map((row) => [rowId(row), row]));
    const right = new Map((after[table] ?? []).map((row) => [rowId(row), row]));
    for (const id of new Set([...left.keys(), ...right.keys()])) {
      if (table === 'settings' && id === 'localSync.groupId') continue;
      const previous = visible(table, left.get(id)); const next = visible(table, right.get(id));
      if (JSON.stringify(previous) !== JSON.stringify(next)) result.push({ table, id, before: previous, after: next });
    }
  }
  return result;
}
export function accountChanges(before: LedgerState, after: LedgerState): RecoveryAccountSummary[] {
  const left = new Map((before.transactions ?? []).map((row) => [rowId(row), row]));
  const right = new Map((after.transactions ?? []).map((row) => [rowId(row), row]));
  const sheets = new Set([...left.values(), ...right.values()].map((row) => String(row.sheet)));
  const balance = (rows: Iterable<DomainRow>, sheet: string) => [...rows].filter((row) => row.sheet === sheet && row.status !== 'planned' && row.status !== 'rejected')
    .reduce((sum, row) => sum + (row.type === 'income' ? 1 : -1) * toPence(String(row.amount)), 0);
  return [...sheets].sort().map((sheet) => ({
    sheet, beforePence: balance(left.values(), sheet), afterPence: balance(right.values(), sheet),
    created: [...right].filter(([id, row]) => row.sheet === sheet && !left.has(id)).length,
    deleted: [...left].filter(([id, row]) => row.sheet === sheet && !right.has(id)).length,
    changed: [...right].filter(([id, row]) => row.sheet === sheet && left.has(id) && JSON.stringify(row) !== JSON.stringify(left.get(id))).length,
  }));
}
