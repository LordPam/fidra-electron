import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureSyncFolderStructure,
  writeBundleAtomically,
  readBundleFile,
  isBundleFile,
  parseBundleFilename,
} from '../bundle-io';

describe('bundle-io', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-io-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('ensureSyncFolderStructure', () => {
    test('creates sync, snapshots, attachments subdirs', () => {
      ensureSyncFolderStructure(tmpDir);
      expect(fs.existsSync(path.join(tmpDir, 'sync'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'snapshots'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'attachments'))).toBe(true);
    });

    test('idempotent on re-run', () => {
      ensureSyncFolderStructure(tmpDir);
      ensureSyncFolderStructure(tmpDir);
      expect(fs.existsSync(path.join(tmpDir, 'sync'))).toBe(true);
    });
  });

  describe('writeBundleAtomically', () => {
    test('creates file at correct path', () => {
      const data = Buffer.from('test bundle data');
      const result = writeBundleAtomically(tmpDir, 'device-1', 42, data);
      expect(result).toBe(
        path.join(tmpDir, 'sync', 'device-1_0000000042.bundle'),
      );
      expect(fs.existsSync(result)).toBe(true);
    });

    test('.tmp file does not exist after write', () => {
      const data = Buffer.from('test');
      const result = writeBundleAtomically(tmpDir, 'device-1', 1, data);
      expect(fs.existsSync(result + '.tmp')).toBe(false);
    });

    test('creates sync/ subdir if missing', () => {
      const data = Buffer.from('test');
      writeBundleAtomically(tmpDir, 'device-1', 1, data);
      expect(fs.existsSync(path.join(tmpDir, 'sync'))).toBe(true);
    });

    test('blocks path traversal in deviceId', () => {
      expect(() =>
        writeBundleAtomically(tmpDir, '../evil', 1, Buffer.from('x')),
      ).toThrow('Invalid deviceId');
    });

    test('blocks path separator in deviceId', () => {
      expect(() =>
        writeBundleAtomically(tmpDir, 'foo/bar', 1, Buffer.from('x')),
      ).toThrow('Invalid deviceId');
    });
  });

  describe('readBundleFile', () => {
    test('round-trips with write', () => {
      const data = Buffer.from('hello bundle');
      const filePath = writeBundleAtomically(tmpDir, 'dev-1', 5, data);
      const read = readBundleFile(filePath);
      expect(read).toEqual(data);
    });
  });

  describe('isBundleFile', () => {
    test('accepts .bundle', () => {
      expect(isBundleFile('device-1_0000000001.bundle')).toBe(true);
    });

    test('rejects .tmp', () => {
      expect(isBundleFile('device-1_0000000001.bundle.tmp')).toBe(false);
    });

    test('rejects .json', () => {
      expect(isBundleFile('state.json')).toBe(false);
    });

    test('rejects empty string', () => {
      expect(isBundleFile('')).toBe(false);
    });
  });

  describe('parseBundleFilename', () => {
    test('extracts deviceId and sequenceNumber', () => {
      const result = parseBundleFilename('my-device_0000000042.bundle');
      expect(result).toEqual({ deviceId: 'my-device', sequenceNumber: 42 });
    });

    test('handles max sequence number', () => {
      const result = parseBundleFilename('dev_9999999999.bundle');
      expect(result).toEqual({ deviceId: 'dev', sequenceNumber: 9999999999 });
    });

    test('handles UUID device IDs', () => {
      const result = parseBundleFilename(
        'abc-123-def-456_0000000001.bundle',
      );
      expect(result).toEqual({
        deviceId: 'abc-123-def-456',
        sequenceNumber: 1,
      });
    });

    test('returns null for malformed names', () => {
      expect(parseBundleFilename('not-a-bundle.json')).toBeNull();
      expect(parseBundleFilename('no-sequence.bundle')).toBeNull();
      expect(parseBundleFilename('')).toBeNull();
    });

    test('returns null for .tmp files', () => {
      expect(
        parseBundleFilename('device-1_0000000001.bundle.tmp'),
      ).toBeNull();
    });
  });
});
