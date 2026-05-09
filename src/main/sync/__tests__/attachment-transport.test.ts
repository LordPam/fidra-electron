import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  writeAttachmentFile,
  readAttachmentFile,
  removeAttachmentFile,
  listRemoteAttachments,
  migrateEncryptedAttachments,
} from '../attachment-transport';
import { encryptAndSign } from '../bundle-crypto';

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

describe('writeAttachmentFile + readAttachmentFile (plain)', () => {
  it('round-trips file content as plain copy', () => {
    const content = Buffer.from('Hello, this is an attachment!');
    const localPath = path.join(localDir, 'source.txt');
    fs.writeFileSync(localPath, content);

    writeAttachmentFile(syncFolder, 'att-001', localPath);

    // Plain file should exist (no .enc extension)
    const plainPath = path.join(syncFolder, 'attachments', 'att-001');
    expect(fs.existsSync(plainPath)).toBe(true);

    // Read back
    const destPath = path.join(localDir, 'dest.txt');
    const found = readAttachmentFile(syncFolder, 'att-001', destPath);
    expect(found).toBe(true);
    expect(fs.readFileSync(destPath).equals(content)).toBe(true);
  });

  it('handles binary content', () => {
    const content = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x80, 0x7f]);
    const localPath = path.join(localDir, 'binary.bin');
    fs.writeFileSync(localPath, content);

    writeAttachmentFile(syncFolder, 'att-bin', localPath);

    const destPath = path.join(localDir, 'binary-out.bin');
    readAttachmentFile(syncFolder, 'att-bin', destPath);
    expect(fs.readFileSync(destPath).equals(content)).toBe(true);
  });

  it('no .tmp files remain after write', () => {
    const localPath = path.join(localDir, 'file.txt');
    fs.writeFileSync(localPath, 'data');
    writeAttachmentFile(syncFolder, 'att-tmp-check', localPath);

    const attDir = path.join(syncFolder, 'attachments');
    const files = fs.readdirSync(attDir);
    expect(files.every((f) => !f.endsWith('.tmp'))).toBe(true);
  });
});

describe('readAttachmentFile — legacy .enc fallback', () => {
  it('decrypts legacy .enc files when passphrase provided', () => {
    const content = Buffer.from('Legacy encrypted content');
    // Manually create an encrypted .enc file
    const sealed = encryptAndSign(content, PASSPHRASE);
    const attDir = path.join(syncFolder, 'attachments');
    fs.mkdirSync(attDir, { recursive: true });
    fs.writeFileSync(path.join(attDir, 'att-legacy.enc'), sealed);

    const destPath = path.join(localDir, 'legacy-out.txt');
    const found = readAttachmentFile(syncFolder, 'att-legacy', destPath, PASSPHRASE);
    expect(found).toBe(true);
    expect(fs.readFileSync(destPath).equals(content)).toBe(true);
  });

  it('prefers plain file over .enc when both exist', () => {
    const plainContent = Buffer.from('Plain version');
    const encContent = Buffer.from('Encrypted version');

    const attDir = path.join(syncFolder, 'attachments');
    fs.mkdirSync(attDir, { recursive: true });
    fs.writeFileSync(path.join(attDir, 'att-both'), plainContent);
    fs.writeFileSync(path.join(attDir, 'att-both.enc'), encryptAndSign(encContent, PASSPHRASE));

    const destPath = path.join(localDir, 'both-out.txt');
    readAttachmentFile(syncFolder, 'att-both', destPath, PASSPHRASE);
    expect(fs.readFileSync(destPath).equals(plainContent)).toBe(true);
  });
});

describe('readAttachmentFile — missing file', () => {
  it('returns false for non-existent file', () => {
    const destPath = path.join(localDir, 'missing.txt');
    const found = readAttachmentFile(syncFolder, 'nonexistent', destPath);
    expect(found).toBe(false);
    expect(fs.existsSync(destPath)).toBe(false);
  });
});

describe('removeAttachmentFile', () => {
  it('deletes the plain file', () => {
    const localPath = path.join(localDir, 'to-delete.txt');
    fs.writeFileSync(localPath, 'delete me');
    writeAttachmentFile(syncFolder, 'att-del', localPath);

    const plainPath = path.join(syncFolder, 'attachments', 'att-del');
    expect(fs.existsSync(plainPath)).toBe(true);

    removeAttachmentFile(syncFolder, 'att-del');
    expect(fs.existsSync(plainPath)).toBe(false);
  });

  it('deletes both plain and legacy .enc files', () => {
    const attDir = path.join(syncFolder, 'attachments');
    fs.mkdirSync(attDir, { recursive: true });
    fs.writeFileSync(path.join(attDir, 'att-both'), 'plain');
    fs.writeFileSync(path.join(attDir, 'att-both.enc'), 'encrypted');

    removeAttachmentFile(syncFolder, 'att-both');
    expect(fs.existsSync(path.join(attDir, 'att-both'))).toBe(false);
    expect(fs.existsSync(path.join(attDir, 'att-both.enc'))).toBe(false);
  });

  it('does not throw for missing file', () => {
    expect(() => removeAttachmentFile(syncFolder, 'nonexistent')).not.toThrow();
  });
});

describe('listRemoteAttachments', () => {
  it('returns stored names for plain files', () => {
    const localPath = path.join(localDir, 'file.txt');
    fs.writeFileSync(localPath, 'data');

    writeAttachmentFile(syncFolder, 'att-1', localPath);
    writeAttachmentFile(syncFolder, 'att-2', localPath);
    writeAttachmentFile(syncFolder, 'att-3', localPath);

    const list = listRemoteAttachments(syncFolder);
    expect(list.sort()).toEqual(['att-1', 'att-2', 'att-3']);
  });

  it('deduplicates when both plain and .enc exist', () => {
    const attDir = path.join(syncFolder, 'attachments');
    fs.mkdirSync(attDir, { recursive: true });
    fs.writeFileSync(path.join(attDir, 'att-1'), 'plain');
    fs.writeFileSync(path.join(attDir, 'att-1.enc'), 'encrypted');
    fs.writeFileSync(path.join(attDir, 'att-2.enc'), 'encrypted only');

    const list = listRemoteAttachments(syncFolder);
    expect(list.sort()).toEqual(['att-1', 'att-2']);
  });

  it('returns empty array for missing directory', () => {
    expect(listRemoteAttachments(path.join(tmpDir, 'no-such-dir'))).toEqual([]);
  });
});

describe('migrateEncryptedAttachments', () => {
  it('converts .enc files to plain files', () => {
    const content = Buffer.from('Migrate me!');
    const sealed = encryptAndSign(content, PASSPHRASE);

    const attDir = path.join(syncFolder, 'attachments');
    fs.mkdirSync(attDir, { recursive: true });
    fs.writeFileSync(path.join(attDir, 'att-migrate.enc'), sealed);

    const count = migrateEncryptedAttachments(syncFolder, PASSPHRASE);
    expect(count).toBe(1);

    // Plain file should exist
    expect(fs.existsSync(path.join(attDir, 'att-migrate'))).toBe(true);
    expect(fs.readFileSync(path.join(attDir, 'att-migrate')).equals(content)).toBe(true);

    // .enc file should be removed
    expect(fs.existsSync(path.join(attDir, 'att-migrate.enc'))).toBe(false);
  });

  it('skips files already migrated (plain exists)', () => {
    const attDir = path.join(syncFolder, 'attachments');
    fs.mkdirSync(attDir, { recursive: true });
    fs.writeFileSync(path.join(attDir, 'att-done'), 'already plain');
    fs.writeFileSync(path.join(attDir, 'att-done.enc'), 'leftover enc');

    const count = migrateEncryptedAttachments(syncFolder, PASSPHRASE);
    expect(count).toBe(1); // still counts cleanup

    // .enc file removed, plain unchanged
    expect(fs.existsSync(path.join(attDir, 'att-done.enc'))).toBe(false);
    expect(fs.readFileSync(path.join(attDir, 'att-done'), 'utf-8')).toBe('already plain');
  });

  it('returns 0 for empty directory', () => {
    expect(migrateEncryptedAttachments(syncFolder, PASSPHRASE)).toBe(0);
  });
});

describe('path traversal protection', () => {
  it('blocks stored names with ..', () => {
    const localPath = path.join(localDir, 'file.txt');
    fs.writeFileSync(localPath, 'data');
    expect(() => writeAttachmentFile(syncFolder, '../escape', localPath)).toThrow(/traversal/i);
  });

  it('blocks stored names with path separator', () => {
    const localPath = path.join(localDir, 'file.txt');
    fs.writeFileSync(localPath, 'data');
    expect(() => writeAttachmentFile(syncFolder, 'sub/name', localPath)).toThrow(/traversal/i);
  });
});
