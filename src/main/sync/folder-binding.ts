import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { encryptAndSign, verifyAndDecrypt } from './bundle-crypto';
import { assertSyncRootExists } from './bundle-io';

const MANIFEST = '.fidra-sync';
const BINDING_KEY = 'folder.binding.v1';
const BOOTSTRAP_KEY = 'folder.bootstrap.v1';
const manifestSchema = z.object({
  version: z.literal(1), groupId: z.string().uuid(), locationId: z.string().uuid(),
  createdAt: z.iso.datetime(),
}).strict();
const rootSchema = z.object({ realPath: z.string().min(1), dev: z.string(), ino: z.string() }).strict();
const bindingSchema = z.object({
  version: z.literal(1), groupId: z.string().uuid(), locationId: z.string().uuid(),
  root: rootSchema, manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type FolderManifest = z.infer<typeof manifestSchema>;
export type FolderBinding = z.infer<typeof bindingSchema>;

function hash(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function rootIdentity(folder: string): FolderBinding['root'] {
  assertSyncRootExists(folder);
  const stat = fs.statSync(folder, { bigint: true });
  return { realPath: fs.realpathSync(folder), dev: String(stat.dev), ino: String(stat.ino) };
}

function readMeta(db: Database.Database, key: string): string | undefined {
  return (db.prepare('SELECT value FROM sync_meta WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}

function writeMeta(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function groupId(db: Database.Database): string | undefined {
  return (db.prepare("SELECT value FROM settings WHERE key = 'localSync.groupId'").get() as { value: string } | undefined)?.value;
}

function readManifestData(folder: string, passphrase: string): { manifest: FolderManifest; digest: string } {
  assertSyncRootExists(folder);
  const file = path.join(folder, MANIFEST);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384) throw new Error('Invalid sync-folder identity file.');
  const bytes = fs.readFileSync(file);
  return { manifest: manifestSchema.parse(JSON.parse(verifyAndDecrypt(bytes, passphrase).toString('utf8'))), digest: hash(bytes) };
}

export function readFolderManifest(folder: string, passphrase: string): FolderManifest {
  return readManifestData(folder, passphrase).manifest;
}

export function getFolderBinding(db: Database.Database): FolderBinding | null {
  const raw = readMeta(db, BINDING_KEY);
  return raw ? bindingSchema.parse(JSON.parse(raw)) : null;
}

/** Fast transport guard: the authenticated manifest's exact bytes are pinned locally.
 * This proves continuity of a selected local folder, not provider/cloud delivery.
 */
export function assertFolderBinding(db: Database.Database, folder: string): FolderBinding {
  const binding = getFolderBinding(db);
  if (!binding) throw new Error('This sync folder needs an identity upgrade. Sync is paused; existing history has been preserved.');
  const current = rootIdentity(folder);
  if (JSON.stringify(current) !== JSON.stringify(binding.root)) {
    throw new Error('The sync folder was replaced or moved. Reconnect Local Sync to verify its location.');
  }
  if (groupId(db) !== binding.groupId) throw new Error('The ledger and sync folder have different team identities. Sync is paused.');
  const file = path.join(folder, MANIFEST);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384
    || hash(fs.readFileSync(file)) !== binding.manifestHash) {
    throw new Error('The sync-folder identity file changed. Sync is paused for review.');
  }
  return binding;
}

/** Explicit reconnect only. Neither a matching name nor knowledge of a key adopts a team. */
export function bindExistingSyncFolder(db: Database.Database, folder: string, passphrase: string): FolderBinding {
  const identity = rootIdentity(folder);
  const { manifest, digest } = readManifestData(folder, passphrase);
  const expectedGroup = groupId(db);
  if (!expectedGroup || manifest.groupId !== expectedGroup) {
    throw new Error('This folder does not match this ledger’s team. Join through a verified team invitation.');
  }
  const previous = getFolderBinding(db);
  if (previous && (previous.groupId !== manifest.groupId || previous.locationId !== manifest.locationId)) {
    throw new Error('This is a different team mailbox. An organisation relocation requires reviewed recovery.');
  }
  const binding: FolderBinding = {
    version: 1, groupId: manifest.groupId, locationId: manifest.locationId,
    root: identity, manifestHash: digest,
  };
  writeMeta(db, BINDING_KEY, JSON.stringify(binding));
  return binding;
}

/** First-peer setup is explicit and restricted to an empty dedicated folder.
 * The local bootstrap journal makes retries reuse the original encrypted identity.
 * Existing legacy histories need a staged upgrade, never automatic adoption.
 */
export function initializeOrBindSyncFolder(db: Database.Database, folder: string, passphrase: string): FolderBinding {
  const identity = rootIdentity(folder);
  if (fs.existsSync(path.join(folder, MANIFEST))) return bindExistingSyncFolder(db, folder, passphrase);
  if (getFolderBinding(db)) throw new Error('The sync-folder identity file is missing. It will not be recreated automatically.');
  if (groupId(db) && !readMeta(db, BOOTSTRAP_KEY)) throw new Error('This existing team needs a reviewed folder identity upgrade. A new mailbox will not be created.');
  if (fs.readdirSync(folder).length > 0) throw new Error('This folder already contains files. Its history needs a reviewed identity upgrade; choose an empty folder for a new team.');

  const bootstrap = db.transaction(() => {
    const existing = readMeta(db, BOOTSTRAP_KEY);
    if (existing) {
      const parsed = z.object({ root: rootSchema, payload: z.string() }).strict().parse(JSON.parse(existing));
      if (JSON.stringify(parsed.root) !== JSON.stringify(identity)) throw new Error('A different folder setup is pending. Review it before choosing another mailbox.');
      return Buffer.from(parsed.payload, 'base64');
    }
    const manifest: FolderManifest = {
      version: 1, groupId: groupId(db) ?? crypto.randomUUID(), locationId: crypto.randomUUID(), createdAt: new Date().toISOString(),
    };
    manifestSchema.parse(manifest);
    const payload = encryptAndSign(Buffer.from(JSON.stringify(manifest)), passphrase);
    db.prepare("INSERT INTO settings (key, value, scope) VALUES ('localSync.groupId', ?, 'org') ON CONFLICT(key) DO UPDATE SET value = excluded.value, scope = 'org'").run(manifest.groupId);
    writeMeta(db, BOOTSTRAP_KEY, JSON.stringify({ root: identity, payload: payload.toString('base64') }));
    return payload;
  }).immediate();

  // Exclusive creation preserves a competing/different mailbox manifest.
  fs.writeFileSync(path.join(folder, MANIFEST), bootstrap, { flag: 'wx', flush: true, mode: 0o600 });
  return bindExistingSyncFolder(db, folder, passphrase);
}
