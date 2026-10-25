import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearDeviceFiles } from '../device-files';

let directory: string;
let home: string;
let data: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-cleanup-'));
  home = path.join(directory, '.fidra'); data = path.join(directory, 'userData');
  fs.mkdirSync(home); fs.mkdirSync(data);
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

describe('device cleanup', () => {
  it('clears only listed device state while retaining financial files and signing keys', () => {
    for (const name of ['attachments', 'accounts', 'release-keys', 'backups', 'sessions', 'logs']) {
      fs.mkdirSync(path.join(home, name)); fs.writeFileSync(path.join(home, name, 'keep-or-delete'), name);
    }
    for (const name of ['settings.json', '.first-run-complete', 'accounts.json']) fs.writeFileSync(path.join(home, name), name);
    fs.writeFileSync(path.join(data, 'fidra.db'), 'ledger');
    fs.mkdirSync(path.join(data, 'updates')); fs.writeFileSync(path.join(data, 'updates', 'installer.exe'), 'cache');
    clearDeviceFiles(home, data);
    for (const name of ['attachments', 'accounts', 'release-keys', 'backups', 'accounts.json']) expect(fs.existsSync(path.join(home, name))).toBe(true);
    for (const name of ['sessions', 'logs', 'settings.json', '.first-run-complete']) expect(fs.existsSync(path.join(home, name))).toBe(false);
    expect(fs.readFileSync(path.join(data, 'fidra.db'), 'utf8')).toBe('ledger');
    expect(fs.existsSync(path.join(data, 'updates'))).toBe(false);
    clearDeviceFiles(home, data); // A repeated cleanup is harmless.
  });
  it('never follows a directory link outside the owned tree', () => {
    const outside = path.join(directory, 'outside'); fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'ledger.fdra'), 'important');
    fs.symlinkSync(outside, path.join(home, 'sessions'), 'dir');
    clearDeviceFiles(home, data);
    expect(fs.readFileSync(path.join(outside, 'ledger.fdra'), 'utf8')).toBe('important');
  });
  it('refuses to erase possible financial files saved inside a disposable directory', () => {
    fs.mkdirSync(path.join(data, 'updates'));
    fs.writeFileSync(path.join(data, 'updates', 'unexpected.fdra'), 'important');
    expect(() => clearDeviceFiles(home, data)).toThrow('financial files');
    expect(fs.readFileSync(path.join(data, 'updates', 'unexpected.fdra'), 'utf8')).toBe('important');
  });
  it('refuses an aliased settings root', () => {
    const link = path.join(directory, 'alias'); fs.symlinkSync(home, link, 'dir');
    expect(() => clearDeviceFiles(link, data)).toThrow('folder is a link');
  });
});
