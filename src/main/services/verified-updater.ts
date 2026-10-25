import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { UpdateManifest, UpdateStatus } from '../../shared/update-types';
import { compareReleaseVersions, manifestAssetName, MAX_MANIFEST_BYTES, RELEASES_URL, validateUpdateUrl, verifyManifest } from './update-manifest';

export interface VerifiedUpdaterOptions {
  directory: string;
  version: string;
  platform: string;
  arch: string;
  publicKey: string | null;
  enabled: boolean;
  fetch?: typeof fetch;
  onChange?: (status: UpdateStatus) => void;
}

/** Process-wide updater. Its cache and preferences never enter a ledger or sync folder. */
export class VerifiedUpdater {
  private status: UpdateStatus;
  private manifest: UpdateManifest | null = null;
  private checking: Promise<UpdateStatus> | null = null;
  private downloading: Promise<UpdateStatus> | null = null;
  private persistence: Promise<void> = Promise.resolve();
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: VerifiedUpdaterOptions) {
    this.fetcher = options.fetch ?? fetch;
    this.status = {
      revision: 0, phase: options.enabled && options.publicKey ? 'idle' : 'unavailable',
      currentVersion: options.version, version: null, releaseNotes: [], progress: 0,
      lastCheckedAt: null, automatic: true, remindAfter: null, installerReady: false, error: null,
      message: !options.enabled ? 'Update checks are available in installed macOS and Windows builds.'
        : !options.publicKey ? 'Verified updates are not configured in this build. Use the official download page.' : null,
    };
  }

  getStatus(): UpdateStatus { return structuredClone(this.status); }

  private publish(patch: Partial<UpdateStatus>): UpdateStatus {
    this.status = { ...this.status, ...patch, revision: this.status.revision + 1 };
    this.options.onChange?.(this.getStatus());
    return this.getStatus();
  }

  private statePath(): string { return path.join(this.options.directory, 'state.json'); }
  private installerPath(manifest: UpdateManifest): string {
    return path.join(this.options.directory, manifest.version, manifest.artifact.fileName);
  }

  private async persist(): Promise<void> {
    const saved = JSON.stringify({ automatic: this.status.automatic, remindAfter: this.status.remindAfter,
      lastCheckedAt: this.status.lastCheckedAt, manifest: this.manifest });
    this.persistence = this.persistence.catch(() => undefined).then(async () => {
      await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.statePath()}.${randomUUID()}.tmp`;
      await writeFile(temporary, saved, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temporary, this.statePath());
    });
    return this.persistence;
  }

  /** A damaged convenience cache must not block startup; only signed announcements are restored. */
  async initialize(): Promise<UpdateStatus> {
    await readFile(this.statePath(), 'utf8').then(async (raw) => {
      if (Buffer.byteLength(raw) > MAX_MANIFEST_BYTES + 4096) return;
      const saved = JSON.parse(raw) as Record<string, unknown>;
      this.publish({ automatic: typeof saved.automatic === 'boolean' ? saved.automatic : true,
        remindAfter: typeof saved.remindAfter === 'string' && Number.isFinite(Date.parse(saved.remindAfter)) ? saved.remindAfter : null,
        lastCheckedAt: typeof saved.lastCheckedAt === 'string' && Number.isFinite(Date.parse(saved.lastCheckedAt)) ? saved.lastCheckedAt : null });
      if (!this.options.enabled || !this.options.publicKey || !saved.manifest) return;
      const manifest = verifyManifest(JSON.stringify(saved.manifest), this.options.publicKey, this.options.platform, this.options.arch);
      if (compareReleaseVersions(manifest.version, this.options.version) <= 0) return;
      this.manifest = manifest;
      const ready = await this.installerMatches(manifest);
      this.publish({ phase: ready ? 'ready' : 'available', version: manifest.version, releaseNotes: manifest.releaseNotes,
        installerReady: ready, progress: ready ? 100 : 0 });
    }).catch(() => undefined);
    return this.getStatus();
  }

  async setAutomatic(automatic: boolean): Promise<UpdateStatus> {
    this.publish({ automatic });
    await this.persist();
    return this.getStatus();
  }

  async remindLater(): Promise<UpdateStatus> {
    this.publish({ remindAfter: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
    await this.persist();
    return this.getStatus();
  }

  /** HTTPS only, bounded redirects, with one timeout spanning redirects AND body consumption. */
  private async request(url: string, signal: AbortSignal): Promise<Response> {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const valid = validateUpdateUrl(url);
      const response = await this.fetcher(valid.href, { signal, redirect: 'manual',
        headers: { 'User-Agent': `Fidra/${this.options.version}`, Accept: 'application/octet-stream' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('The update service returned an invalid redirect.');
        url = new URL(location, valid).href;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(response.status === 404
          ? 'No verified release has been published for this computer yet.'
          : `The update service returned ${response.status}. Try again later.`);
      }
      return response;
    }
    throw new Error('The update service redirected too many times.');
  }

  private async boundedText(response: Response): Promise<string> {
    if (!response.body) throw new Error('The update announcement was empty.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    return (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_MANIFEST_BYTES) throw new Error('The update announcement is too large.');
        chunks.push(value);
      }
      return Buffer.concat(chunks).toString('utf8');
    })().finally(() => reader.cancel().catch(() => undefined));
  }

  check(): Promise<UpdateStatus> {
    if (!this.options.enabled || !this.options.publicKey) return Promise.resolve(this.getStatus());
    if (this.checking) return this.checking;
    if (this.downloading || ['unavailable', 'preparing'].includes(this.status.phase)) return Promise.resolve(this.getStatus());
    this.checking = this.performCheck().catch((error: unknown) => this.fail(error)).finally(() => { this.checking = null; });
    return this.checking;
  }

  private async performCheck(): Promise<UpdateStatus> {
    this.publish({ phase: 'checking', error: null });
    const signal = AbortSignal.timeout(15_000);
    const url = `${RELEASES_URL}/download/${manifestAssetName(this.options.platform, this.options.arch)}`;
    // GitHub's stable asset endpoint is /releases/latest/download/<name>.
    const response = await this.request(url, signal);
    const publicKey = this.options.publicKey;
    if (!publicKey) throw new Error('Update verification is not configured.');
    const manifest = verifyManifest(await this.boundedText(response), publicKey, this.options.platform, this.options.arch);
    if (this.manifest && compareReleaseVersions(manifest.version, this.manifest.version) < 0) throw new Error('The update service returned an older release.');
    if (compareReleaseVersions(manifest.version, this.options.version) <= 0) {
      this.manifest = null;
      this.publish({ phase: 'up-to-date', lastCheckedAt: new Date().toISOString(), installerReady: false,
        version: null, releaseNotes: [], progress: 0, error: null });
    } else {
      const changed = this.manifest?.version !== manifest.version;
      if (!changed && this.manifest?.artifact.sha256 !== manifest.artifact.sha256) throw new Error('A published release has changed. Use the official download page.');
      this.manifest = manifest;
      const ready = await this.installerMatches(manifest);
      this.publish({ phase: ready ? 'ready' : 'available', version: manifest.version, releaseNotes: manifest.releaseNotes,
        lastCheckedAt: new Date().toISOString(), installerReady: ready, progress: ready ? 100 : 0,
        ...(changed ? { remindAfter: null } : {}) });
    }
    await this.persist();
    return this.getStatus();
  }

  download(): Promise<UpdateStatus> {
    if (this.downloading) return this.downloading;
    if (this.checking || !this.manifest || this.status.installerReady || this.status.phase === 'preparing') return Promise.resolve(this.getStatus());
    this.downloading = this.performDownload(this.manifest).catch((error: unknown) => this.fail(error)).finally(() => { this.downloading = null; });
    return this.downloading;
  }

  private async performDownload(manifest: UpdateManifest): Promise<UpdateStatus> {
    const target = this.installerPath(manifest);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const partial = `${target}.${randomUUID()}.part`;
    this.publish({ phase: 'downloading', error: null, progress: 0 });
    return (async () => {
      const response = await this.request(manifest.artifact.url, AbortSignal.timeout(30 * 60 * 1000));
      const length = response.headers.get('content-length');
      if (length && Number(length) !== manifest.artifact.size) {
        await response.body?.cancel();
        throw new Error('The update size does not match its signed announcement.');
      }
      if (!response.body) throw new Error('The update download was empty.');
      const file = await open(partial, 'wx', 0o600);
      const hash = createHash('sha256');
      let received = 0;
      let lastProgress = 0;
      const reader = response.body.getReader();
      await (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > manifest.artifact.size) throw new Error('The update exceeded its signed size.');
          hash.update(value);
          // FileHandle.write may make partial writes. writeFile writes the whole chunk.
          await file.writeFile(value);
          if (Date.now() - lastProgress > 150) {
            this.publish({ progress: received / manifest.artifact.size * 100 });
            lastProgress = Date.now();
          }
        }
      })().finally(async () => { await reader.cancel().catch(() => undefined); await file.close(); });
      if (received !== manifest.artifact.size || hash.digest('hex') !== manifest.artifact.sha256) {
        throw new Error('The downloaded update failed verification. Please retry.');
      }
      await rename(partial, target);
      this.publish({ phase: 'ready', installerReady: true, progress: 100, error: null });
      await this.persist();
      return this.getStatus();
    })().finally(() => rm(partial, { force: true }));
  }

  private async installerMatches(manifest: UpdateManifest): Promise<boolean> {
    return stat(this.installerPath(manifest)).then(async (details) => {
      if (!details.isFile() || details.size !== manifest.artifact.size) return false;
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(this.installerPath(manifest))) hash.update(chunk);
      return hash.digest('hex') === manifest.artifact.sha256;
    }).catch(() => false);
  }

  async verifiedInstaller(): Promise<string> {
    if (!this.manifest || !this.options.publicKey || this.checking || this.downloading) throw new Error('Wait until the verified installer is ready.');
    const manifest = verifyManifest(JSON.stringify(this.manifest), this.options.publicKey, this.options.platform, this.options.arch);
    if (!await this.installerMatches(manifest)) {
      const message = 'The saved installer no longer matches the verified release. Download it again.';
      this.publish({ phase: 'error', installerReady: false, error: message });
      throw new Error(message);
    }
    return this.installerPath(manifest);
  }

  setPreparing(preparing: boolean): void {
    this.publish({ phase: preparing ? 'preparing' : !this.options.enabled || !this.options.publicKey ? 'unavailable' : this.status.installerReady ? 'ready' : 'error' });
  }

  fail(error: unknown): UpdateStatus {
    const message = error instanceof Error && ['ZodError', 'SyntaxError'].includes(error.name)
      ? 'The update announcement could not be verified. Please retry later or use Official downloads.'
      : error instanceof Error && /EACCES|EPERM|ENOSPC|EROFS/.test(error.message)
        ? 'Fidra could not save the update files. Check free space and folder access, then retry.'
        : error instanceof Error && !/fetch failed|ENOTFOUND|ECONN|abort|timeout/i.test(error.message)
          ? error.message : 'Fidra could not reach the update service. You can keep working and try again later.';
    return this.publish({ phase: 'error', error: message });
  }
}
