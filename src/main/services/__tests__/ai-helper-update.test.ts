import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { refreshInstalledAiHelper, type HelperPayload } from '../ai-helper-update';

const original = fs.readFileSync(path.join(__dirname, 'fixtures/fidra-helper-2.0.4.cjs'), 'utf8');
const bootstrap = fs.readFileSync(path.resolve('resources/ai-bridge/helper-bootstrap.cjs'), 'utf8');
let home: string;
let root: string;
const payload = (version = 1): HelperPayload => ({
  'server/server.cjs': `exports.main = async () => process.stdout.write('helper-${version}');`,
  'tools.json': JSON.stringify({ tools: [{ name: `test_${version}` }] }),
  'skills/setup/SKILL.md': 'setup',
  'skills/fidra-reconcile/SKILL.md': 'reconcile',
  'skills/fidra-ledger/SKILL.md': 'ledger',
});
function install() {
  fs.mkdirSync(path.join(root, 'server'), { recursive: true });
  fs.writeFileSync(path.join(root, 'server/server.cjs'), original);
  for (const name of ['runtime/node', 'node_modules/keyring-preserved', 'installation-marker']) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), 'unchanged');
  }
}
function launch() { return spawnSync(process.execPath, [path.join(root, 'server/server.cjs')], { encoding: 'utf8' }); }
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-helper-update-')); root = path.join(home, '.fidra/ai-plugin/2.0.4'); });
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe('installed compatibility helper updates', () => {
  it('does not create an installation or change an unrecognised adapter', () => {
    expect(refreshInstalledAiHelper(home, bootstrap, payload())).toBe('absent');
    expect(fs.readdirSync(home)).toEqual([]);
    install(); fs.writeFileSync(path.join(root, 'server/server.cjs'), 'custom adapter');
    expect(() => refreshInstalledAiHelper(home, bootstrap, payload())).toThrow('modified');
    expect(fs.readFileSync(path.join(root, 'server/server.cjs'), 'utf8')).toBe('custom adapter');
    expect(fs.existsSync(path.join(root, 'current.json'))).toBe(false);
  });
  it('migrates only the known copy and selects complete snapshots across upgrades and restarts', () => {
    install();
    expect(refreshInstalledAiHelper(home, bootstrap, payload())).toBe('updated');
    expect(launch()).toMatchObject({ status: 0, stdout: 'helper-1' });
    expect(refreshInstalledAiHelper(home, bootstrap, payload())).toBe('current');
    const previous = fs.readFileSync(path.join(root, 'current.json'), 'utf8');
    expect(refreshInstalledAiHelper(home, bootstrap, payload(2))).toBe('updated');
    expect(launch()).toMatchObject({ status: 0, stdout: 'helper-2' });
    expect(fs.readFileSync(path.join(root, 'current.json'), 'utf8')).not.toBe(previous);
    expect(fs.readFileSync(path.join(root, 'server/server-2.0.4.original.cjs'), 'utf8')).toBe(original);
    for (const name of ['runtime/node', 'node_modules/keyring-preserved', 'installation-marker']) expect(fs.readFileSync(path.join(root, name), 'utf8')).toBe('unchanged');
  });
  it('refuses symlinked installation directories and leaves the outside target alone', () => {
    const outside = path.join(home, 'outside'); fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(home, '.fidra'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => refreshInstalledAiHelper(home, bootstrap, payload())).toThrow('directory');
    expect(fs.readdirSync(outside)).toEqual([]);
  });
  it('retains the selected helper when a subsequent snapshot cannot be written', () => {
    install(); refreshInstalledAiHelper(home, bootstrap, payload());
    const pointer = fs.readFileSync(path.join(root, 'current.json'), 'utf8');
    fs.renameSync(path.join(root, 'releases'), path.join(root, 'saved-releases'));
    fs.symlinkSync(path.join(root, 'saved-releases'), path.join(root, 'releases'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => refreshInstalledAiHelper(home, bootstrap, payload(2))).toThrow('directory');
    expect(fs.readFileSync(path.join(root, 'current.json'), 'utf8')).toBe(pointer);
  });
  it('fails closed before executing a modified or symlinked snapshot', () => {
    install(); refreshInstalledAiHelper(home, bootstrap, payload());
    const { digest } = JSON.parse(fs.readFileSync(path.join(root, 'current.json'), 'utf8'));
    const target = path.join(root, 'releases', digest, 'server/server.cjs');
    fs.writeFileSync(target, "exports.main = async () => process.stdout.write('tampered');");
    expect(launch()).toMatchObject({ status: 1, stdout: '' });
    expect(() => refreshInstalledAiHelper(home, bootstrap, payload())).toThrow('integrity');
    if (process.platform === 'win32') return; // File symlinks require an OS privilege; directory junctions are covered above.
    fs.rmSync(target); fs.writeFileSync(path.join(home, 'outside.cjs'), payload()['server/server.cjs']);
    fs.symlinkSync(path.join(home, 'outside.cjs'), target);
    expect(launch()).toMatchObject({ status: 1, stdout: '' });
    expect(() => refreshInstalledAiHelper(home, bootstrap, payload())).toThrow('file');
  });
});
