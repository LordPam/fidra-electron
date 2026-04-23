import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import type { CrChangesetRow } from '../bundle-format';
import {
  serializeChangesetRow,
  deserializeChangesetRow,
  createBundlePayload,
  packBundle,
  unpackBundle,
  bundleFileName,
  BundleFormatError,
} from '../bundle-format';
import { BundleIntegrityError } from '../bundle-crypto';

// ─── Helpers ────────────────────────────────────────────────────────

function makeRow(overrides: Partial<CrChangesetRow> = {}): CrChangesetRow {
  return {
    table: 'transactions',
    pk: JSON.stringify(['tx-1']),
    cid: 'amount',
    val: 42.5,
    col_version: 1,
    db_version: 1,
    site_id: crypto.randomBytes(16),
    cl: 1,
    seq: 0,
    ...overrides,
  };
}

const TEST_PASSPHRASE = 'bundle-test-pass';
const TEST_DEVICE_ID = crypto.randomUUID();
const TEST_SITE_ID = crypto.randomBytes(16);

// ─── Serialization ──────────────────────────────────────────────────

describe('serializeChangesetRow / deserializeChangesetRow', () => {
  it('round-trips string val', () => {
    const row = makeRow({ val: 'hello' });
    const serialized = serializeChangesetRow(row);
    const deserialized = deserializeChangesetRow(serialized);
    expect(deserialized.val).toBe('hello');
    expect(deserialized.table).toBe(row.table);
  });

  it('round-trips number val', () => {
    const row = makeRow({ val: 99.99 });
    const result = deserializeChangesetRow(serializeChangesetRow(row));
    expect(result.val).toBe(99.99);
  });

  it('round-trips null val', () => {
    const row = makeRow({ val: null });
    const result = deserializeChangesetRow(serializeChangesetRow(row));
    expect(result.val).toBeNull();
  });

  it('round-trips Buffer val', () => {
    const buf = Buffer.from('binary data');
    const row = makeRow({ val: buf });
    const serialized = serializeChangesetRow(row);
    expect(serialized.val).toEqual({ __buf: buf.toString('hex') });

    const deserialized = deserializeChangesetRow(serialized);
    expect(Buffer.isBuffer(deserialized.val)).toBe(true);
    expect((deserialized.val as Buffer).equals(buf)).toBe(true);
  });

  it('converts site_id Buffer to hex and back', () => {
    const siteId = crypto.randomBytes(16);
    const row = makeRow({ site_id: siteId });
    const serialized = serializeChangesetRow(row);
    expect(typeof serialized.site_id).toBe('string');
    expect(serialized.site_id).toBe(siteId.toString('hex'));

    const deserialized = deserializeChangesetRow(serialized);
    expect(deserialized.site_id.equals(siteId)).toBe(true);
  });
});

// ─── createBundlePayload ────────────────────────────────────────────

describe('createBundlePayload', () => {
  it('creates payload with correct version', () => {
    const payload = createBundlePayload({
      deviceId: TEST_DEVICE_ID,
      siteId: TEST_SITE_ID,
      sequenceNumber: 1,
      schemaVersion: 1,
      changesets: [makeRow()],
    });
    expect(payload.version).toBe(1);
  });

  it('generates unique bundleId', () => {
    const a = createBundlePayload({
      deviceId: TEST_DEVICE_ID,
      siteId: TEST_SITE_ID,
      sequenceNumber: 1,
      schemaVersion: 1,
      changesets: [],
    });
    const b = createBundlePayload({
      deviceId: TEST_DEVICE_ID,
      siteId: TEST_SITE_ID,
      sequenceNumber: 2,
      schemaVersion: 1,
      changesets: [],
    });
    expect(a.bundleId).not.toBe(b.bundleId);
  });

  it('computes checksum', () => {
    const payload = createBundlePayload({
      deviceId: TEST_DEVICE_ID,
      siteId: TEST_SITE_ID,
      sequenceNumber: 1,
      schemaVersion: 1,
      changesets: [makeRow()],
    });
    expect(payload.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles empty changesets', () => {
    const payload = createBundlePayload({
      deviceId: TEST_DEVICE_ID,
      siteId: TEST_SITE_ID,
      sequenceNumber: 0,
      schemaVersion: 1,
      changesets: [],
    });
    expect(payload.changesets).toEqual([]);
    expect(payload.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── packBundle / unpackBundle ──────────────────────────────────────

describe('packBundle / unpackBundle', () => {
  it('round-trips full pipeline preserving all data', () => {
    const rows = [
      makeRow({ val: 'text', cid: 'description' }),
      makeRow({ val: 42.5, cid: 'amount' }),
      makeRow({ val: null, cid: 'notes' }),
    ];

    const sealed = packBundle({
      deviceId: TEST_DEVICE_ID,
      siteId: TEST_SITE_ID,
      sequenceNumber: 7,
      schemaVersion: 2,
      changesets: rows,
      passphrase: TEST_PASSPHRASE,
    });

    const unpacked = unpackBundle(sealed, TEST_PASSPHRASE);
    expect(unpacked.deviceId).toBe(TEST_DEVICE_ID);
    expect(unpacked.siteId).toBe(TEST_SITE_ID.toString('hex'));
    expect(unpacked.sequenceNumber).toBe(7);
    expect(unpacked.schemaVersion).toBe(2);
    expect(unpacked.changesets.length).toBe(3);
    expect(unpacked.changesets[0].val).toBe('text');
    expect(unpacked.changesets[1].val).toBe(42.5);
    expect(unpacked.changesets[2].val).toBeNull();
  });

  it('preserves Buffer values through pipeline', () => {
    const bufVal = Buffer.from('binary data here');
    const rows = [makeRow({ val: bufVal })];

    const sealed = packBundle({
      deviceId: TEST_DEVICE_ID,
      siteId: TEST_SITE_ID,
      sequenceNumber: 1,
      schemaVersion: 1,
      changesets: rows,
      passphrase: TEST_PASSPHRASE,
    });

    const unpacked = unpackBundle(sealed, TEST_PASSPHRASE);
    expect(Buffer.isBuffer(unpacked.changesets[0].val)).toBe(true);
    expect((unpacked.changesets[0].val as Buffer).equals(bufVal)).toBe(true);
  });

  it('preserves site_id Buffers through pipeline', () => {
    const siteId = crypto.randomBytes(16);
    const rows = [makeRow({ site_id: siteId })];

    const sealed = packBundle({
      deviceId: TEST_DEVICE_ID,
      siteId: TEST_SITE_ID,
      sequenceNumber: 1,
      schemaVersion: 1,
      changesets: rows,
      passphrase: TEST_PASSPHRASE,
    });

    const unpacked = unpackBundle(sealed, TEST_PASSPHRASE);
    expect(unpacked.changesets[0].site_id.equals(siteId)).toBe(true);
  });

  it('rejects wrong passphrase', () => {
    const sealed = packBundle({
      deviceId: TEST_DEVICE_ID,
      siteId: TEST_SITE_ID,
      sequenceNumber: 1,
      schemaVersion: 1,
      changesets: [makeRow()],
      passphrase: TEST_PASSPHRASE,
    });

    expect(() => unpackBundle(sealed, 'wrong-pass')).toThrow();
  });

  it('rejects corrupted byte', () => {
    const sealed = packBundle({
      deviceId: TEST_DEVICE_ID,
      siteId: TEST_SITE_ID,
      sequenceNumber: 1,
      schemaVersion: 1,
      changesets: [makeRow()],
      passphrase: TEST_PASSPHRASE,
    });

    // Flip a byte in the middle
    const corrupted = Buffer.from(sealed);
    corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;
    expect(() => unpackBundle(corrupted, TEST_PASSPHRASE)).toThrow();
  });

  it('handles 1000+ rows', () => {
    const rows = Array.from({ length: 1000 }, (_, i) =>
      makeRow({ val: `row-${i}`, seq: i }),
    );

    const sealed = packBundle({
      deviceId: TEST_DEVICE_ID,
      siteId: TEST_SITE_ID,
      sequenceNumber: 1,
      schemaVersion: 1,
      changesets: rows,
      passphrase: TEST_PASSPHRASE,
    });

    const unpacked = unpackBundle(sealed, TEST_PASSPHRASE);
    expect(unpacked.changesets.length).toBe(1000);
    expect(unpacked.changesets[999].val).toBe('row-999');
  });
});

// ─── bundleFileName ─────────────────────────────────────────────────

describe('bundleFileName', () => {
  it('formats with zero-padded sequence', () => {
    const name = bundleFileName('abc-123', 7);
    expect(name).toBe('abc-123_0000000007.bundle');
  });

  it('handles large sequence numbers', () => {
    const name = bundleFileName('dev1', 9999999999);
    expect(name).toBe('dev1_9999999999.bundle');
  });

  it('handles sequence 0', () => {
    const name = bundleFileName('dev1', 0);
    expect(name).toBe('dev1_0000000000.bundle');
  });
});
