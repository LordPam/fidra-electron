import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { canonicalJson, compareReleaseVersions, manifestAssetName, RELEASES_URL, releaseAssetName, validateUpdateUrl, verifyManifest } from '../update-manifest';
import { VerifiedUpdater } from '../verified-updater';
import type { UpdateManifest } from '../../../shared/update-types';

const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const bytes = Buffer.from('Fidra installer fixture');
function signed(changes: Partial<UpdateManifest> = {}): UpdateManifest {
  const unsigned = {
    schemaVersion: 1 as const, channel: 'stable' as const, version: '0.1.24', publishedAt: '2026-10-21T12:00:00.000Z',
    platform: 'darwin' as const, arch: 'arm64' as const, releaseNotes: ['Simpler updates'],
    artifact: { url: 'https://github.com/LordPam/fidra-electron/releases/download/v0.1.24/Fidra-macOS-arm64.dmg',
      fileName: 'Fidra-macOS-arm64.dmg', sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }, ...changes,
  };
  return { ...unsigned, signature: sign(null, Buffer.from(canonicalJson(unsigned)), keys.privateKey).toString('base64') };
}
let directory: string;
let manifest: UpdateManifest;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
function create(options: Partial<ConstructorParameters<typeof VerifiedUpdater>[0]> = {}) {
  return new VerifiedUpdater({ directory, version: '0.1.23', platform: 'darwin', arch: 'arm64', publicKey, enabled: true, fetch: fetcher, ...options });
}
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fidra-update-test-'));
  manifest = signed();
  fetcher = vi.fn<typeof fetch>(async (url) => String(url).endsWith('.json')
    ? new Response(JSON.stringify(manifest)) : new Response(bytes));
});
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

describe('release authentication', () => {
  it('compares stable versions numerically and rejects ambiguous versions', () => {
    expect(compareReleaseVersions('0.1.100', '0.1.24')).toBe(1);
    expect(compareReleaseVersions('1.0.0', '1.0.0')).toBe(0);
    expect(() => compareReleaseVersions('01.0.0', '1.0.0')).toThrow();
    expect(() => compareReleaseVersions('1.0.0-beta', '1.0.0')).toThrow();
  });
  it('accepts an authentic announcement only for the intended platform and architecture', () => {
    expect(verifyManifest(JSON.stringify(manifest), publicKey, 'darwin', 'arm64')).toEqual(manifest);
    expect(() => verifyManifest(JSON.stringify(manifest), publicKey, 'darwin', 'x64')).toThrow(/different computer/);
    expect(() => verifyManifest(JSON.stringify(manifest), publicKey, 'win32', 'x64')).toThrow();
  });
  it('rejects altered notes, URLs, hashes, and versions even when shape is valid', () => {
    for (const changed of [{ ...manifest, releaseNotes: ['untrusted'] }, { ...manifest, version: '0.1.25' },
      { ...manifest, artifact: { ...manifest.artifact, sha256: '0'.repeat(64) } },
      { ...manifest, artifact: { ...manifest.artifact, url: 'https://example.com/malware' } }]) {
      expect(() => verifyManifest(JSON.stringify(changed), publicKey, 'darwin', 'arm64')).toThrow();
    }
  });
  it('rejects a correctly signed announcement pointing outside the release or using traversal', () => {
    for (const artifact of [{ ...manifest.artifact, url: 'https://github.com/other/repo/releases/download/v0.1.24/Fidra.dmg' },
      { ...manifest.artifact, fileName: '../installer.dmg' }, { ...manifest.artifact, fileName: '..' }]) {
      expect(() => verifyManifest(JSON.stringify(signed({ artifact })), publicKey, 'darwin', 'arm64')).toThrow();
    }
  });
  it('rejects unapproved redirect destinations, credentials, insecure protocols and ports', () => {
    for (const url of ['http://github.com/file', 'https://github.com.evil.test/file', 'https://user@github.com/file',
      'file:///tmp/update', 'https://github.com:8443/file']) expect(() => validateUpdateUrl(url)).toThrow();
    expect(validateUpdateUrl('https://release-assets.githubusercontent.com/file').hostname).toBe('release-assets.githubusercontent.com');
  });
});

describe('verified downloads and persisted recovery', () => {
  it('checks, downloads, verifies and reopens the saved installer without a second download', async () => {
    const updater = create();
    expect((await updater.check()).phase).toBe('available');
    expect(fetcher.mock.calls[0][0]).toBe(`${RELEASES_URL}/download/${manifestAssetName('darwin', 'arm64')}`);
    expect((await updater.download()).phase).toBe('ready');
    const installer = await updater.verifiedInstaller();
    expect(await fs.readFile(installer)).toEqual(bytes);
    const reopened = create();
    expect((await reopened.initialize()).phase).toBe('ready');
    expect(await reopened.verifiedInstaller()).toBe(installer);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('remembers manual-only checks and snooze across launches', async () => {
    const updater = create();
    await updater.setAutomatic(false);
    await updater.remindLater();
    const reopened = create();
    const state = await reopened.initialize();
    expect(state.automatic).toBe(false);
    expect(Date.parse(state.remindAfter!)).toBeGreaterThan(Date.now());
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects corrupt cached installers at startup and immediately before opening', async () => {
    const updater = create(); await updater.check(); await updater.download();
    const installer = await updater.verifiedInstaller();
    await fs.writeFile(installer, Buffer.alloc(bytes.length, 'x'));
    expect((await create().initialize()).phase).toBe('available');
    await expect(updater.verifiedInstaller()).rejects.toThrow(/no longer matches/);
    expect(updater.getStatus().installerReady).toBe(false);
  });
  it('does not restore an unsigned cached announcement or trust a cached path', async () => {
    const changed = { ...manifest, signature: 'A'.repeat(86) + '==' };
    await fs.writeFile(path.join(directory, 'state.json'), JSON.stringify({ manifest: changed, downloadedPath: '/etc/passwd' }));
    const updater = create();
    expect((await updater.initialize()).installerReady).toBe(false);
    await expect(updater.verifiedInstaller()).rejects.toThrow();
  });
  it('tolerates a broken state file without blocking startup', async () => {
    await fs.writeFile(path.join(directory, 'state.json'), '{bad');
    expect((await create().initialize()).phase).toBe('idle');
  });
  it('rejects tampered bytes and removes the partial download', async () => {
    const updater = create(); await updater.check();
    fetcher.mockResolvedValueOnce(new Response(Buffer.alloc(bytes.length, 'x')));
    expect((await updater.download()).phase).toBe('error');
    expect(await fs.readdir(path.join(directory, '0.1.24'))).toEqual([]);
    expect(updater.getStatus().installerReady).toBe(false);
  });
  it('rejects incomplete and oversized streams, even without Content-Length', async () => {
    for (const data of [bytes.subarray(0, 3), Buffer.concat([bytes, bytes])]) {
      const updater = create(); await updater.check();
      fetcher.mockResolvedValueOnce(new Response(data));
      expect((await updater.download()).phase).toBe('error');
      expect(updater.getStatus().installerReady).toBe(false);
    }
  });
  it('rejects a declared size mismatch before saving any installer', async () => {
    const updater = create(); await updater.check();
    fetcher.mockResolvedValueOnce(new Response(bytes, { headers: { 'Content-Length': '999' } }));
    expect((await updater.download()).phase).toBe('error');
  });
  it('removes partial bytes on a broken network stream and permits retry', async () => {
    const updater = create(); await updater.check();
    let reads = 0;
    fetcher.mockResolvedValueOnce(new Response(new ReadableStream({ pull(controller) {
      if (reads++ === 0) controller.enqueue(bytes.subarray(0, 3));
      else controller.error(new Error('Connection lost'));
    } })));
    expect((await updater.download()).phase).toBe('error');
    expect(await fs.readdir(path.join(directory, '0.1.24'))).toEqual([]);
    expect((await updater.download()).phase).toBe('ready');
  });
  it('validates redirects before making a request to the redirected host', async () => {
    fetcher.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://attacker.test/feed' } }));
    expect((await create().check()).phase).toBe('error');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('follows an approved GitHub CDN redirect', async () => {
    fetcher.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/feed' } }));
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(manifest)));
    expect((await create().check()).phase).toBe('available');
    expect(fetcher.mock.calls[1][0]).toBe('https://release-assets.githubusercontent.com/feed');
    expect(fetcher.mock.calls[1][1]?.redirect).toBe('manual');
  });
  it('reports an unavailable feed honestly rather than claiming the app is up to date', async () => {
    fetcher.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const state = await create().check();
    expect(state.phase).toBe('error');
    expect(state.error).toMatch(/No verified release/);
  });
  it('presents invalid announcements as a readable error without exposing schema internals', async () => {
    fetcher.mockResolvedValueOnce(new Response('{"invalid":true}'));
    expect((await create().check()).error).toBe('The update announcement could not be verified. Please retry later or use Official downloads.');
  });
  it('caps announcements streamed without a declared size', async () => {
    fetcher.mockResolvedValueOnce(new Response('x'.repeat(129 * 1024)));
    expect((await create().check()).phase).toBe('error');
  });
  it('never contacts the feed when unsupported, in development or missing its trust key', async () => {
    for (const updater of [create({ enabled: false }), create({ publicKey: null })]) {
      expect((await updater.check()).phase).toBe('unavailable');
      expect((await updater.download()).installerReady).toBe(false);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('coalesces concurrent checks and concurrent downloads across windows', async () => {
    const updater = create();
    await Promise.all([updater.check(), updater.check(), updater.check()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await Promise.all([updater.download(), updater.download()]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(updater.getStatus().phase).toBe('ready');
  });
  it('rejects changed bytes for an already announced version', async () => {
    const updater = create(); await updater.check();
    manifest = signed({ artifact: { ...manifest.artifact, sha256: '0'.repeat(64) } });
    expect((await updater.check()).phase).toBe('error');
  });
  it('does not offer older releases than the installed app', async () => {
    const updater = create({ version: '0.1.25' });
    expect((await updater.check()).phase).toBe('up-to-date');
    await updater.download();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('release script interoperability', () => {
  async function releaseFixture() {
    const root = path.join(directory, 'project');
    await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(root, 'resources'));
    await fs.copyFile(path.resolve(__dirname, '../../../../scripts/create-update-release.mjs'), path.join(root, 'scripts/create-update-release.mjs'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.1.24' }));
    await fs.writeFile(path.join(root, 'resources/update-public-key.pem'), publicKey);
    const privatePath = path.join(directory, 'test-private.pem');
    await fs.writeFile(privatePath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    return { root, privatePath };
  }
  it('signs the actual installer artifact in the exact format clients verify on both platforms', async () => {
    const { root, privatePath } = await releaseFixture();
    for (const [platform, arch] of [['darwin', 'arm64'], ['win32', 'x64']]) {
      const artifact = path.join(directory, releaseAssetName(platform, arch)!);
      await fs.writeFile(artifact, bytes);
      execFileSync(process.execPath, [path.join(root, 'scripts/create-update-release.mjs'), '--artifact', artifact,
        '--platform', platform, '--arch', arch, '--version', '0.1.24', '--private-key', privatePath]);
      const raw = await fs.readFile(path.join(directory, manifestAssetName(platform, arch)), 'utf8');
      const result = verifyManifest(raw, publicKey, platform, arch);
      expect(result.artifact.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(result.artifact.size).toBe(bytes.length);
    }
  });
  it('refuses a version mismatch instead of publishing metadata for a different app version', async () => {
    const { root, privatePath } = await releaseFixture();
    const artifact = path.join(directory, 'Fidra-macOS-arm64.dmg');
    await fs.writeFile(artifact, bytes);
    expect(() => execFileSync(process.execPath, [path.join(root, 'scripts/create-update-release.mjs'), '--artifact', artifact,
      '--platform', 'darwin', '--arch', 'arm64', '--version', '0.1.25', '--private-key', privatePath], { stdio: 'pipe' })).toThrow();
    expect(await fs.readdir(directory)).not.toContain(manifestAssetName('darwin', 'arm64'));
  });
});
