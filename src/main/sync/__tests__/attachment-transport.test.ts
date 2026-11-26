import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeAttachmentFile, readAttachmentFile, attachmentFileName } from '../attachment-transport';
import { encryptAndSign } from '../bundle-crypto';

const PASSPHRASE = 'test-passphrase-for-attachments';
const GROUP = crypto.randomUUID();
let tmpDir: string;
let syncFolder: string;
let localDir: string;
let source: string;
let destination: string;
const storedName = '2026-11-25_INCOME_25.00_Private-Person.pdf';
const content = Buffer.from('Private financial attachment contents');
function remoteFile(name = storedName, group = GROUP): string {
  return path.join(syncFolder, 'attachments', attachmentFileName(group, name));
}
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'encrypted-att-transport-'));
  syncFolder = path.join(tmpDir, 'shared');
  localDir = path.join(tmpDir, 'local');
  fs.mkdirSync(syncFolder);
  fs.mkdirSync(localDir);
  source = path.join(localDir, 'source.pdf');
  destination = path.join(localDir, 'received.pdf');
  fs.writeFileSync(source, content);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('encrypted attachment transport', () => {
  test('encrypts bytes and descriptive names, then authenticates the round trip', () => {
    expect(writeAttachmentFile(syncFolder, storedName, source, PASSPHRASE, GROUP)).toBe(true);
    const sealed = fs.readFileSync(remoteFile());
    expect(sealed.includes(content)).toBe(false);
    expect(sealed.includes(Buffer.from(storedName))).toBe(false);
    expect(fs.readdirSync(path.join(syncFolder, 'attachments'))).toEqual([attachmentFileName(GROUP, storedName)]);
    expect(readAttachmentFile(syncFolder, storedName, destination, PASSPHRASE, GROUP)).toBe(true);
    expect(fs.readFileSync(destination)).toEqual(content);
  });

  test('preserves binary bytes and an empty attachment', () => {
    for (const [name, bytes] of [['binary', Buffer.from([0, 1, 255, 128])], ['empty', Buffer.alloc(0)]] as const) {
      fs.writeFileSync(source, bytes);
      writeAttachmentFile(syncFolder, name, source, PASSPHRASE, GROUP);
      const target = path.join(localDir, `${name}.out`);
      readAttachmentFile(syncFolder, name, target, PASSPHRASE, GROUP);
      expect(fs.readFileSync(target)).toEqual(bytes);
    }
  });

  test('retries identical content without rewriting shared ciphertext', () => {
    writeAttachmentFile(syncFolder, storedName, source, PASSPHRASE, GROUP);
    const original = fs.readFileSync(remoteFile());
    expect(writeAttachmentFile(syncFolder, storedName, source, PASSPHRASE, GROUP)).toBe(false);
    expect(fs.readFileSync(remoteFile())).toEqual(original);
  });

  test('retains encrypted local ciphertext after a failed shared-folder write', () => {
    const originalCopy = fs.copyFileSync;
    const copy = vi.spyOn(fs, 'copyFileSync').mockImplementation((from, to, mode) => {
      if (String(to).startsWith(syncFolder)) throw new Error('OneDrive offline');
      originalCopy(from, to, mode);
    });
    expect(() => writeAttachmentFile(syncFolder, storedName, source, PASSPHRASE, GROUP)).toThrow('OneDrive offline');
    const journal = path.join(localDir, '.sync-export', attachmentFileName(GROUP, storedName));
    const retained = fs.readFileSync(journal);
    expect(retained.includes(content)).toBe(false);
    copy.mockRestore();
    writeAttachmentFile(syncFolder, storedName, source, PASSPHRASE, GROUP);
    expect(fs.readFileSync(remoteFile())).toEqual(retained);
  });

  test('recovers a missing original from retained ciphertext and republishes the identical bytes', () => {
    writeAttachmentFile(syncFolder, storedName, source, PASSPHRASE, GROUP);
    const originalSealed = fs.readFileSync(remoteFile());
    fs.unlinkSync(source);
    fs.unlinkSync(remoteFile());
    expect(readAttachmentFile(syncFolder, storedName, source, PASSPHRASE, GROUP)).toBe(true);
    expect(fs.readFileSync(source)).toEqual(content);
    expect(writeAttachmentFile(syncFolder, storedName, source, PASSPHRASE, GROUP)).toBe(true);
    expect(fs.readFileSync(remoteFile())).toEqual(originalSealed);
  });

  test('rejects wrong keys and tampering without creating a destination', () => {
    writeAttachmentFile(syncFolder, storedName, source, PASSPHRASE, GROUP);
    expect(() => readAttachmentFile(syncFolder, storedName, destination, 'wrong', GROUP)).toThrow();
    const modified = fs.readFileSync(remoteFile());
    modified[modified.length - 1] ^= 1;
    fs.writeFileSync(remoteFile(), modified);
    expect(() => readAttachmentFile(syncFolder, storedName, destination, PASSPHRASE, GROUP)).toThrow();
    expect(fs.existsSync(destination)).toBe(false);
  });

  test('rejects a valid encrypted file transplanted under a different name or group', () => {
    writeAttachmentFile(syncFolder, storedName, source, PASSPHRASE, GROUP);
    fs.copyFileSync(remoteFile(), remoteFile('another'));
    expect(() => readAttachmentFile(syncFolder, 'another', destination, PASSPHRASE, GROUP)).toThrow('identity mismatch');
    const anotherGroup = crypto.randomUUID();
    fs.copyFileSync(remoteFile(), remoteFile(storedName, anotherGroup));
    expect(() => readAttachmentFile(syncFolder, storedName, destination, PASSPHRASE, anotherGroup)).toThrow('identity mismatch');
  });

  test('never overwrites a different local attachment or a differing export journal', () => {
    writeAttachmentFile(syncFolder, storedName, source, PASSPHRASE, GROUP);
    fs.writeFileSync(destination, 'valuable local data');
    expect(() => readAttachmentFile(syncFolder, storedName, destination, PASSPHRASE, GROUP)).toThrow('collision');
    expect(fs.readFileSync(destination, 'utf8')).toBe('valuable local data');
    const shared = fs.readFileSync(remoteFile());
    fs.writeFileSync(source, 'different content under the same identity');
    expect(() => writeAttachmentFile(syncFolder, storedName, source, PASSPHRASE, GROUP)).toThrow('journal differs');
    expect(fs.readFileSync(remoteFile())).toEqual(shared);
  });

  test('preserves legacy plain and encrypted files for reviewed migration', () => {
    fs.mkdirSync(path.join(syncFolder, 'attachments'));
    const plain = path.join(syncFolder, 'attachments', storedName);
    const legacy = `${plain}.enc`;
    fs.writeFileSync(plain, 'legacy plain');
    const encrypted = encryptAndSign(content, PASSPHRASE);
    fs.writeFileSync(legacy, encrypted);
    expect(() => readAttachmentFile(syncFolder, storedName, destination, PASSPHRASE, GROUP)).toThrow('reviewed migration');
    expect(fs.readFileSync(plain, 'utf8')).toBe('legacy plain');
    expect(fs.readFileSync(legacy)).toEqual(encrypted);
    expect(fs.existsSync(destination)).toBe(false);
  });

  test('a missing file stays pending without creating local content', () => {
    expect(readAttachmentFile(syncFolder, storedName, destination, PASSPHRASE, GROUP)).toBe(false);
    expect(fs.existsSync(destination)).toBe(false);
  });

  test('never recreates a missing provider root', () => {
    fs.rmdirSync(syncFolder);
    expect(() => writeAttachmentFile(syncFolder, storedName, source, PASSPHRASE, GROUP)).toThrow();
    expect(fs.existsSync(syncFolder)).toBe(false);
  });

  test.each(['../escape', 'sub/name', 'sub\\name', ''])('rejects unsafe stored names: %s', (name) => {
    expect(() => writeAttachmentFile(syncFolder, name, source, PASSPHRASE, GROUP)).toThrow('traversal');
  });
});
