import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  writeAttachmentFile,
  readAttachmentFile,
  removeAttachmentFile,
  listRemoteAttachments,
} from '../attachment-transport';
import { BundleIntegrityError } from '../bundle-crypto';

const PASSPHRASE = 'test-passphrase-for-attachments';

let tmpDir: string;
let syncFolder: string;
let localDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-transport-'));
  syncFolder = path.join(tmpDir, 'sync');
  localDir = path.join(tmpDir, 'local');
  fs.mkdirSync(syncFolder, { recursive: true });
  fs.mkdirSync(localDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('writeAttachmentFile + readAttachmentFile', () => {
  it('round-trips file content through encrypt/decrypt', () => {
    const content = Buffer.from('Hello, this is an attachment!');
    const localPath = path.join(localDir, 'source.txt');
    fs.writeFileSync(localPath, content);

    writeAttachmentFile(syncFolder, 'att-001', localPath, PASSPHRASE);

    // Encrypted file should exist
    const encPath = path.join(syncFolder, 'attachments', 'att-001.enc');
    expect(fs.existsSync(encPath)).toBe(true);

    // Read back
    const destPath = path.join(localDir, 'dest.txt');
    const found = readAttachmentFile(syncFolder, 'att-001', destPath, PASSPHRASE);
    expect(found).toBe(true);
    expect(fs.readFileSync(destPath).equals(content)).toBe(true);
  });

  it('handles binary content', () => {
    const content = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x80, 0x7f]);
    const localPath = path.join(localDir, 'binary.bin');
    fs.writeFileSync(localPath, content);

    writeAttachmentFile(syncFolder, 'att-bin', localPath, PASSPHRASE);

    const destPath = path.join(localDir, 'binary-out.bin');
    readAttachmentFile(syncFolder, 'att-bin', destPath, PASSPHRASE);
    expect(fs.readFileSync(destPath).equals(content)).toBe(true);
  });

  it('no .tmp files remain after write', () => {
    const localPath = path.join(localDir, 'file.txt');
    fs.writeFileSync(localPath, 'data');
    writeAttachmentFile(syncFolder, 'att-tmp-check', localPath, PASSPHRASE);

    const attDir = path.join(syncFolder, 'attachments');
    const files = fs.readdirSync(attDir);
    expect(files.every((f) => !f.endsWith('.tmp'))).toBe(true);
  });
});

describe('readAttachmentFile — missing file', () => {
  it('returns false for non-existent file', () => {
    const destPath = path.join(localDir, 'missing.txt');
    const found = readAttachmentFile(syncFolder, 'nonexistent', destPath, PASSPHRASE);
    expect(found).toBe(false);
    expect(fs.existsSync(destPath)).toBe(false);
  });
});

describe('removeAttachmentFile', () => {
  it('deletes the .enc file', () => {
    const localPath = path.join(localDir, 'to-delete.txt');
    fs.writeFileSync(localPath, 'delete me');
    writeAttachmentFile(syncFolder, 'att-del', localPath, PASSPHRASE);

    const encPath = path.join(syncFolder, 'attachments', 'att-del.enc');
    expect(fs.existsSync(encPath)).toBe(true);

    removeAttachmentFile(syncFolder, 'att-del');
    expect(fs.existsSync(encPath)).toBe(false);
  });

  it('does not throw for missing file', () => {
    expect(() => removeAttachmentFile(syncFolder, 'nonexistent')).not.toThrow();
  });
});

describe('listRemoteAttachments', () => {
  it('returns stored names without .enc extension', () => {
    const localPath = path.join(localDir, 'file.txt');
    fs.writeFileSync(localPath, 'data');

    writeAttachmentFile(syncFolder, 'att-1', localPath, PASSPHRASE);
    writeAttachmentFile(syncFolder, 'att-2', localPath, PASSPHRASE);
    writeAttachmentFile(syncFolder, 'att-3', localPath, PASSPHRASE);

    const list = listRemoteAttachments(syncFolder);
    expect(list.sort()).toEqual(['att-1', 'att-2', 'att-3']);
  });

  it('returns empty array for missing directory', () => {
    expect(listRemoteAttachments(path.join(tmpDir, 'no-such-dir'))).toEqual([]);
  });
});

describe('path traversal protection', () => {
  it('blocks stored names with ..', () => {
    const localPath = path.join(localDir, 'file.txt');
    fs.writeFileSync(localPath, 'data');
    expect(() => writeAttachmentFile(syncFolder, '../escape', localPath, PASSPHRASE)).toThrow(/traversal/i);
  });

  it('blocks stored names with path separator', () => {
    const localPath = path.join(localDir, 'file.txt');
    fs.writeFileSync(localPath, 'data');
    expect(() => writeAttachmentFile(syncFolder, 'sub/name', localPath, PASSPHRASE)).toThrow(/traversal/i);
  });
});

describe('corrupt file handling', () => {
  it('throws BundleIntegrityError on corrupt .enc file', () => {
    const localPath = path.join(localDir, 'file.txt');
    fs.writeFileSync(localPath, 'good data');
    writeAttachmentFile(syncFolder, 'att-corrupt', localPath, PASSPHRASE);

    // Corrupt the encrypted file
    const encPath = path.join(syncFolder, 'attachments', 'att-corrupt.enc');
    const data = fs.readFileSync(encPath);
    data[data.length - 1] ^= 0xff;
    fs.writeFileSync(encPath, data);

    const destPath = path.join(localDir, 'corrupt-out.txt');
    expect(() => readAttachmentFile(syncFolder, 'att-corrupt', destPath, PASSPHRASE)).toThrow();
  });
});
