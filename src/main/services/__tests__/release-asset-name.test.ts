import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The in-app update fallback builds a download URL from an asset name, and the
 * published asset is named by the postMake rename map in forge.config.ts. Those two
 * drifted: the updater hardcoded `Fidra-macOS.dmg` (the x64 name) while every build
 * is arm64 and therefore `Fidra-macOS-arm64.dmg`, so anyone offered a manual
 * download after the ad-hoc-signed installer failed got a 404.
 *
 * update-checker.ts imports electron, so it cannot be loaded here. These assert the
 * rule instead: both files must apply the same suffix logic, and neither may go back
 * to the bare name.
 */

const root = path.resolve(__dirname, '../../../..');
const updateChecker = fs.readFileSync(path.join(root, 'src/main/services/update-checker.ts'), 'utf-8');
const forgeConfig = fs.readFileSync(path.join(root, 'forge.config.ts'), 'utf-8');
const website = fs.readFileSync(path.join(root, 'gh-pages/index.html'), 'utf-8');

/** The naming rule, stated once. */
function macAssetName(arch: string): string {
  return `Fidra-macOS${arch !== 'x64' ? `-${arch}` : ''}.dmg`;
}

describe('release asset naming', () => {
  it('appends the arch for everything except x64', () => {
    expect(macAssetName('arm64')).toBe('Fidra-macOS-arm64.dmg');
    expect(macAssetName('x64')).toBe('Fidra-macOS.dmg');
  });

  it('is applied by forge.config.ts when renaming artifacts', () => {
    expect(forgeConfig).toContain("`Fidra-macOS${arch !== 'x64' ? `-${arch}` : ''}.dmg`");
    expect(forgeConfig).toContain("'Fidra-Windows-Setup.exe'");
  });

  it('is applied by the updater rather than hardcoded', () => {
    expect(updateChecker).toContain("`Fidra-macOS${process.arch !== 'x64' ? `-${process.arch}` : ''}.dmg`");
    expect(updateChecker).toContain("'Fidra-Windows-Setup.exe'");
  });

  it('never hardcodes the bare macOS name in a download URL', () => {
    // `releases/download/v0.1.22/Fidra-macOS.dmg` is a 404 for an arm64 release
    const hardcodedInUrl = /releases\/download\/[^`'"]*Fidra-macOS\.dmg/;
    expect(hardcodedInUrl.test(updateChecker)).toBe(false);
    expect(hardcodedInUrl.test(website)).toBe(false);
  });

  it('serves the arm64 asset from the website, matching what is published', () => {
    expect(website).toContain('releases/latest/download/Fidra-macOS-arm64.dmg');
    expect(website).toContain('releases/latest/download/Fidra-Windows-Setup.exe');
  });

  it('falls back to the releases page when the asset cannot be named', () => {
    // Better an page the user can navigate than a confidently wrong direct link
    expect(updateChecker).toContain('return RELEASES_URL');
  });
});
