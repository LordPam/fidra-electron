import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { releaseAssetName } from '../update-manifest';

const root = path.resolve(__dirname, '../../../..');
const forgeConfig = fs.readFileSync(path.join(root, 'forge.config.ts'), 'utf-8');
const website = fs.readFileSync(path.join(root, 'gh-pages/index.html'), 'utf-8');

describe('release asset naming', () => {
  it('selects the correct installer per supported platform and architecture', () => {
    expect(releaseAssetName('darwin', 'arm64')).toBe('Fidra-macOS-arm64.dmg');
    expect(releaseAssetName('darwin', 'x64')).toBe('Fidra-macOS.dmg');
    expect(releaseAssetName('win32', 'x64')).toBe('Fidra-Windows-Setup.exe');
    expect(releaseAssetName('win32', 'arm64')).toBeNull();
    expect(releaseAssetName('linux', 'x64')).toBeNull();
  });
  it('matches the stable installer names used by packaging and the website', () => {
    expect(forgeConfig).toContain("`Fidra-macOS${arch !== 'x64' ? `-${arch}` : ''}.dmg`");
    expect(forgeConfig).toContain("'Fidra-Windows-Setup.exe'");
    expect(website).toContain(`releases/latest/download/${releaseAssetName('darwin', 'arm64')}`);
    expect(website).toContain(`releases/latest/download/${releaseAssetName('win32', 'x64')}`);
  });
});
