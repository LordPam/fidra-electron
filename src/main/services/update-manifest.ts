import { createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
import type { UpdateManifest } from '../../shared/update-types';

export const MAX_MANIFEST_BYTES = 128 * 1024;
export const MAX_INSTALLER_BYTES = 2 * 1024 * 1024 * 1024;
export const RELEASES_URL = 'https://github.com/LordPam/fidra-electron/releases/latest';
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  channel: z.literal('stable'),
  version: z.string().max(64).regex(versionPattern),
  publishedAt: z.iso.datetime(),
  platform: z.enum(['darwin', 'win32']),
  arch: z.enum(['arm64', 'x64']),
  releaseNotes: z.array(z.string().max(2000)).max(30),
  artifact: z.object({
    url: z.string().max(8192).url(),
    fileName: z.string().max(255).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.(dmg|exe)$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().positive().max(MAX_INSTALLER_BYTES),
  }).strict(),
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
}).strict();

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function compareReleaseVersions(left: string, right: string): number {
  if (!versionPattern.test(left) || !versionPattern.test(right)) throw new Error('Unsupported release version.');
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (!Number.isSafeInteger(a[i]) || !Number.isSafeInteger(b[i])) throw new Error('Invalid release version.');
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

/** Naming is shared by release packaging, signing, and the manual fallback. */
export function releaseAssetName(platform: string, arch: string): string | null {
  if (!['x64', 'arm64'].includes(arch)) return null;
  if (platform === 'darwin') return `Fidra-macOS${arch !== 'x64' ? `-${arch}` : ''}.dmg`;
  if (platform === 'win32' && arch === 'x64') return 'Fidra-Windows-Setup.exe';
  return null;
}

export function manifestAssetName(platform: string, arch: string): string {
  return `fidra-update-${platform}-${arch}.json`;
}

export function verifyManifest(raw: string, publicKey: string, platform: string, arch: string): UpdateManifest {
  if (Buffer.byteLength(raw) > MAX_MANIFEST_BYTES) throw new Error('Update announcement is too large.');
  const manifest = manifestSchema.parse(JSON.parse(raw));
  const { signature, ...unsigned } = manifest;
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(canonicalJson(unsigned)), key, Buffer.from(signature, 'base64'))) {
    throw new Error('The update could not be authenticated.');
  }
  if (manifest.platform !== platform || manifest.arch !== arch) throw new Error('This update is for a different computer.');
  const asset = releaseAssetName(platform, arch);
  if (!asset || manifest.artifact.fileName !== asset) throw new Error('The update installer has an unexpected name.');
  const expected = `https://github.com/LordPam/fidra-electron/releases/download/v${manifest.version}/${asset}`;
  if (manifest.artifact.url !== expected) throw new Error('The update is not from the Fidra release source.');
  return manifest;
}

/** Check every redirect before making a request, including GitHub's CDN redirect. */
export function validateUpdateUrl(value: string): URL {
  const url = new URL(value);
  const hosts = ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'];
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !hosts.includes(url.hostname)) {
    throw new Error('The update service redirected to an unapproved address.');
  }
  return url;
}
