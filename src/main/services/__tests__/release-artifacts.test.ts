import { describe, expect, it } from 'vitest';
import { releaseInstallers } from '../release-artifacts';

describe('release signing installer selection', () => {
  it('selects the DMG from separate macOS ZIP and DMG maker results', () => {
    const zip = { platform: 'darwin', arch: 'arm64', artifacts: ['out/Fidra.zip'] };
    const dmg = { platform: 'darwin', arch: 'arm64', artifacts: ['out/Fidra-macOS-arm64.dmg'] };
    expect(releaseInstallers([zip, dmg])).toEqual([{ result: dmg, artifact: dmg.artifacts[0] }]);
  });
  it('selects each architecture/platform installer and ignores unrelated artifacts', () => {
    const mac = { platform: 'darwin', arch: 'arm64', artifacts: ['out/Fidra.dmg'] };
    const windows = { platform: 'win32', arch: 'x64', artifacts: ['out/Fidra.nupkg', 'out/RELEASES', 'out/Fidra-Windows-Setup.exe'] };
    const linux = { platform: 'linux', arch: 'x64', artifacts: ['out/Fidra.deb'] };
    expect(releaseInstallers([mac, windows, linux])).toEqual([{ result: mac, artifact: mac.artifacts[0] }, { result: windows, artifact: windows.artifacts[2] }]);
  });
  it('refuses to announce a ZIP-only release as an installable update', () => {
    expect(() => releaseInstallers([{ platform: 'darwin', arch: 'arm64', artifacts: ['out/Fidra.zip'] }])).toThrow('found 0');
  });
  it('refuses ambiguous installers rather than choosing one by order', () => {
    expect(() => releaseInstallers([{ platform: 'win32', arch: 'x64', artifacts: ['out/one.exe', 'out/two.exe'] }])).toThrow('found 2');
  });
});
