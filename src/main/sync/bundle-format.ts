import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { z } from 'zod';
import { encryptAndSign, verifyAndDecrypt } from './bundle-crypto';
import { causalContextSchema, causalStateSchema, type CausalContext, type CausalState } from './causal-context';
import { SYNCED_TABLES } from './crr-schema';

// ─── Error type ─────────────────────────────────────────────────────

export class BundleFormatError extends Error {
  constructor(message = 'Invalid bundle format') {
    super(message);
    this.name = 'BundleFormatError';
  }
}

// ─── Changeset row types ────────────────────────────────────────────

/** Raw row from cr-sqlite's `crsql_changes` virtual table. */
export interface CrChangesetRow {
  table: string;
  pk: string | Buffer; // cr-sqlite binary primary key; strings are legacy/test inputs
  cid: string;        // column name, or '-1' for a lifecycle marker (even cl = deleted)
  val: unknown;       // column value — may be string, number, null, or Buffer
  col_version: number;
  db_version: number;
  site_id: Buffer;    // 16-byte site identifier
  cl: number;         // causal length
  seq: number;        // sequence within db_version
}

/** JSON-safe version of CrChangesetRow. */
export interface SerializedChangesetRow {
  table: string;
  pk: string;
  /** Lossless binary representation, used by protocol v2. */
  pkHex?: string;
  cid: string;
  val: unknown;       // Buffer vals become { __buf: "hex" }
  col_version: number;
  db_version: number;
  site_id: string;    // hex-encoded
  cl: number;
  seq: number;
}

/** The JSON envelope inside an encrypted bundle. */
export interface BundlePayload {
  version: 1 | 2;
  bundleId: string;        // UUID v4
  deviceId: string;        // machine identity
  siteId: string;          // hex-encoded cr-sqlite site_id for this database
  sequenceNumber: number;  // monotonically increasing per device+database
  timestamp: string;       // ISO-8601
  schemaVersion: number;   // database schema version for compatibility checks
  changesets: SerializedChangesetRow[];
  checksum: string;        // SHA-256 hex of JSON-serialized changesets array
  /** Human-readable name of the person who exported this bundle (for notifications). */
  deviceName?: string;
  /** Per-device max sequence numbers covered by this snapshot (snapshots only). */
  coveredDeviceSeqs?: Record<string, number>;
  /** Stable organisation identity; absent only in legacy bundles. */
  groupId?: string;
  observedBundles?: CausalContext;
  causalState?: CausalState;
  snapshotGeneration?: number;
}

const hexBytes = z.string().regex(/^(?:[a-f0-9]{2})+$/);
const changeSchema = z.object({
  table: z.enum(SYNCED_TABLES), pk: z.union([z.string(), z.object({ type: z.literal('Buffer'), data: z.array(z.number().int().min(0).max(255)) })]),
  pkHex: hexBytes.optional(), cid: z.string().min(1),
  val: z.union([z.string(), z.number().finite(), z.null(), z.object({ __buf: z.string().regex(/^(?:[a-f0-9]{2})*$/) }).strict()]).optional(),
  col_version: z.number().int().nonnegative(), db_version: z.number().int().nonnegative(),
  site_id: z.string().regex(/^[a-f0-9]{32}$/), cl: z.number().int().nonnegative(), seq: z.number().int().nonnegative(),
});
const payloadSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]), bundleId: z.string().uuid(),
  deviceId: z.string().min(1).max(200).refine((value) => !value.includes('..') && !/[\\/\0]/.test(value)),
  siteId: z.string().regex(/^[a-f0-9]{32}$/), sequenceNumber: z.number().int().nonnegative(),
  timestamp: z.iso.datetime(), schemaVersion: z.number().int().positive(),
  changesets: z.array(changeSchema), checksum: z.string().regex(/^[a-f0-9]{64}$/),
  deviceName: z.string().max(200).optional(), groupId: z.string().uuid().optional(),
  coveredDeviceSeqs: z.record(z.string(), z.number().int().nonnegative()).optional(),
  observedBundles: causalContextSchema.optional(),
  causalState: causalStateSchema.optional(), snapshotGeneration: z.number().int().positive().optional(),
});

// ─── Serialization ──────────────────────────────────────────────────

function serializeValue(val: unknown): unknown {
  if (Buffer.isBuffer(val)) {
    return { __buf: val.toString('hex') };
  }
  return val;
}

function deserializeValue(val: unknown): unknown {
  if (val === undefined) return null; // JSON round-trip may drop undefined → treat as null for SQLite
  if (val !== null && typeof val === 'object' && '__buf' in (val as Record<string, unknown>)) {
    return Buffer.from((val as { __buf: string }).__buf, 'hex');
  }
  return val;
}

export function serializeChangesetRow(row: CrChangesetRow): SerializedChangesetRow {
  return {
    table: row.table,
    // Keep the historical display field, with lossless bytes alongside it.
    pk: Buffer.isBuffer(row.pk) ? (row.pk as unknown as Buffer).toString('utf-8') : row.pk,
    ...(Buffer.isBuffer(row.pk) ? { pkHex: row.pk.toString('hex') } : {}),
    cid: row.cid,
    val: serializeValue(row.val),
    col_version: row.col_version,
    db_version: row.db_version,
    site_id: row.site_id.toString('hex'),
    cl: row.cl,
    seq: row.seq,
  };
}

/**
 * Recover a pk that was serialized in the old format where Buffer was
 * JSON.stringify'd as `{"type":"Buffer","data":[...]}` instead of utf-8 string.
 */
function deserializePk(pk: unknown): string {
  if (typeof pk === 'string') return pk;
  // Old format: JSON.stringify(Buffer) → {"type":"Buffer","data":[...]}
  if (pk !== null && typeof pk === 'object' && 'type' in (pk as Record<string, unknown>)
      && (pk as Record<string, unknown>).type === 'Buffer'
      && Array.isArray((pk as Record<string, unknown>).data)) {
    return Buffer.from((pk as { data: number[] }).data).toString('utf-8');
  }
  return String(pk ?? '');
}

export function deserializeChangesetRow(row: SerializedChangesetRow): CrChangesetRow {
  return {
    table: row.table,
    pk: row.pkHex !== undefined ? decodePkHex(row.pkHex) : deserializePk(row.pk),
    cid: row.cid,
    val: deserializeValue(row.val),
    col_version: row.col_version,
    db_version: row.db_version,
    site_id: Buffer.from(row.site_id, 'hex'),
    cl: row.cl,
    seq: row.seq,
  };
}

function decodePkHex(value: string): Buffer {
  if (typeof value !== 'string' || !/^(?:[a-f0-9]{2})+$/.test(value)) throw new BundleFormatError('Invalid binary primary key');
  return Buffer.from(value, 'hex');
}

// ─── Checksum ───────────────────────────────────────────────────────

function computeChecksum(changesets: SerializedChangesetRow[]): string {
  const json = JSON.stringify(changesets);
  return crypto.createHash('sha256').update(json).digest('hex');
}

// ─── Bundle payload ─────────────────────────────────────────────────

export interface CreateBundleOptions {
  deviceId: string;
  siteId: Buffer;           // 16-byte cr-sqlite site_id
  sequenceNumber: number;
  schemaVersion: number;
  changesets: CrChangesetRow[];
  /** Human-readable name of the person exporting (for notifications). */
  deviceName?: string;
  /** Per-device max sequence numbers covered (snapshots only). */
  coveredDeviceSeqs?: Record<string, number>;
  groupId?: string;
  observedBundles?: CausalContext;
  causalState?: CausalState;
  snapshotGeneration?: number;
}

export function createBundlePayload(options: CreateBundleOptions): BundlePayload {
  const serialized = options.changesets.map(serializeChangesetRow);
  const payload: BundlePayload = {
    version: 2,
    bundleId: crypto.randomUUID(),
    deviceId: options.deviceId,
    siteId: options.siteId.toString('hex'),
    sequenceNumber: options.sequenceNumber,
    timestamp: new Date().toISOString(),
    schemaVersion: options.schemaVersion,
    changesets: serialized,
    checksum: computeChecksum(serialized),
  };
  if (options.deviceName) {
    payload.deviceName = options.deviceName;
  }
  if (options.groupId) payload.groupId = options.groupId;
  if (options.observedBundles) payload.observedBundles = causalContextSchema.parse(options.observedBundles);
  if (options.causalState) payload.causalState = causalStateSchema.parse(options.causalState);
  if (options.snapshotGeneration) payload.snapshotGeneration = options.snapshotGeneration;
  if (options.coveredDeviceSeqs) {
    payload.coveredDeviceSeqs = options.coveredDeviceSeqs;
  }
  return payload;
}

// ─── Pack / Unpack ──────────────────────────────────────────────────

export interface PackBundleOptions extends CreateBundleOptions {
  passphrase: string;
}

/** payload → JSON → gzip → encryptAndSign */
export function packBundle(options: PackBundleOptions): Buffer {
  const payload = createBundlePayload(options);
  const json = JSON.stringify(payload);
  const compressed = zlib.gzipSync(Buffer.from(json, 'utf-8'));
  return encryptAndSign(compressed, options.passphrase);
}

export interface UnpackedBundle extends Omit<BundlePayload, 'changesets'> {
  changesets: CrChangesetRow[];
}

/** verifyAndDecrypt → gunzip → JSON parse → verify checksum → restore Buffers */
export function unpackBundle(sealed: Buffer, passphrase: string): UnpackedBundle {
  const compressed = verifyAndDecrypt(sealed, passphrase);

  let json: string;
  try {
    json = zlib.gunzipSync(compressed, { maxOutputLength: 150 * 1024 * 1024 }).toString('utf-8');
  } catch {
    throw new BundleFormatError('Failed to decompress bundle');
  }

  let payload: BundlePayload;
  try {
    // Validate the wire representation before converting binary keys/values.
    payload = payloadSchema.parse(JSON.parse(json)) as unknown as BundlePayload;
  } catch {
    throw new BundleFormatError('Failed to parse bundle JSON');
  }

  if (payload.version !== 1 && payload.version !== 2) {
    throw new BundleFormatError(`Unsupported bundle version: ${payload.version}`);
  }

  // Verify checksum
  const expectedChecksum = computeChecksum(payload.changesets);
  if (payload.checksum !== expectedChecksum) {
    throw new BundleFormatError('Bundle checksum mismatch');
  }

  const result: UnpackedBundle = {
    version: payload.version,
    bundleId: payload.bundleId,
    deviceId: payload.deviceId,
    siteId: payload.siteId,
    sequenceNumber: payload.sequenceNumber,
    timestamp: payload.timestamp,
    schemaVersion: payload.schemaVersion,
    changesets: payload.changesets.map(deserializeChangesetRow),
    checksum: payload.checksum,
  };
  if (payload.deviceName) {
    result.deviceName = payload.deviceName;
  }
  if (payload.groupId) result.groupId = payload.groupId;
  if (payload.observedBundles) result.observedBundles = causalContextSchema.parse(payload.observedBundles);
  if (payload.causalState) result.causalState = causalStateSchema.parse(payload.causalState);
  if (payload.snapshotGeneration) result.snapshotGeneration = payload.snapshotGeneration;
  if (payload.coveredDeviceSeqs) {
    result.coveredDeviceSeqs = payload.coveredDeviceSeqs;
  }
  return result;
}

// ─── File naming ────────────────────────────────────────────────────

export function bundleFileName(deviceId: string, sequenceNumber: number): string {
  const padded = String(sequenceNumber).padStart(10, '0');
  return `${deviceId}_${padded}.bundle`;
}
