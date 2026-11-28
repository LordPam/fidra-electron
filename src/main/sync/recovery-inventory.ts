import fs from 'node:fs';
import path from 'node:path';
import { setImmediate as yieldToApplication } from 'node:timers/promises';
import { unpackBundle, type UnpackedBundle } from './bundle-format';
import { assertSyncRootExists, parseBundleFilename } from './bundle-io';
import { CRR_SCHEMA_VERSION } from './crr-schema';
import { sha256 } from './recovery-state';
import type { RecoveryFile } from '../../shared/sync-recovery-types';

export interface InventoryFile extends RecoveryFile { originalPath: string; evidencePath: string }
export interface InventoryBundle { file: InventoryFile; payload: UnpackedBundle }
export interface RecoveryInventory {
  files: InventoryFile[];
  bundles: InventoryBundle[];
  issues: string[];
  warnings: string[];
  duplicates: number;
  roots: { path: string; identity: string }[];
}
const directories = new Set(['sync', 'snapshots', 'attachments', 'receipts', 'invites', 'cutovers', 'states']);
const rootIdentity = (folder: string) => {
  assertSyncRootExists(folder);
  const stat = fs.statSync(folder, { bigint: true });
  return JSON.stringify({ path: fs.realpathSync(folder), dev: String(stat.dev), ino: String(stat.ino) });
};

function collect(folder: string): { path: string; relative: string; kind: RecoveryFile['kind'] }[] {
  const files: ReturnType<typeof collect> = [];
  const walk = (directory: string, depth: number) => {
    if (depth > 8) throw new Error('The mailbox directory structure is too deep.');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.DS_Store' || entry.name.endsWith('.tmp')) continue;
      const file = path.join(directory, entry.name);
      const relative = path.relative(folder, file);
      if (entry.isSymbolicLink()) throw new Error(`A mailbox path is a symbolic link: ${relative}`);
      if (entry.isDirectory()) { if (depth > 0 || directories.has(entry.name)) walk(file, depth + 1); continue; }
      if (!entry.isFile()) throw new Error(`A mailbox object is not a regular file: ${relative}`);
      const kind = entry.name.endsWith('.bundle') ? 'bundle' : entry.name.endsWith('.snapshot') ? 'snapshot'
        : relative.split(path.sep)[0] === 'attachments' ? 'attachment' : 'metadata';
      if (depth === 0 && kind === 'metadata' && entry.name !== '.fidra-sync') continue;
      files.push({ path: file, relative, kind });
      if (files.length > 100_000) throw new Error('The mailbox contains too many objects for one recovery stage.');
    }
  };
  walk(folder, 0);
  return files;
}

/** Immutable copies are collected privately. No source, provider ancestor or
 * shared object is created, replaced, renamed or deleted during inspection. */
export async function inventoryMailboxes(roots: string[], passphrase: string, evidenceDirectory: string): Promise<RecoveryInventory> {
  fs.mkdirSync(evidenceDirectory, { recursive: true, mode: 0o700 });
  const result: RecoveryInventory = { files: [], bundles: [], issues: [], warnings: [], duplicates: 0, roots: [] };
  const identities = new Map<string, string>();
  for (const folder of [...new Set(roots.map((root) => path.resolve(root)))]) {
    const identity = rootIdentity(folder);
    result.roots.push({ path: folder, identity });
    for (const entry of collect(folder)) {
      await yieldToApplication();
      try {
        const stat = fs.lstatSync(entry.path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 150 * 1024 * 1024) throw new Error('Invalid or oversized mailbox object');
        const bytes = fs.readFileSync(entry.path);
        const digest = sha256(bytes);
        const evidencePath = path.join(evidenceDirectory, `${digest}.evidence`);
        if (!fs.existsSync(evidencePath)) fs.writeFileSync(evidencePath, bytes, { flag: 'wx', flush: true, mode: 0o600 });
        else if (sha256(fs.readFileSync(evidencePath)) !== digest) throw new Error('Private evidence copy changed');
        const file: InventoryFile = { source: folder, relativePath: entry.relative, sha256: digest, size: bytes.length,
          kind: entry.kind, originalPath: entry.path, evidencePath };
        result.files.push(file);
        if (entry.kind !== 'bundle' && entry.kind !== 'snapshot') continue;
        const payload = unpackBundle(bytes, passphrase);
        if (payload.schemaVersion !== CRR_SCHEMA_VERSION) throw new Error('The history schema needs a compatible Fidra version');
        if (payload.changesets.some((row) => typeof row.pk === 'string' && row.pk.includes('\uFFFD'))) {
          throw new Error('Legacy primary-key bytes were lost. Provide the originating device’s SQLite backup instead of guessing its key.');
        }
        const kind = entry.kind === 'snapshot' ? `snapshot:${payload.snapshotGeneration ?? payload.bundleId}` : 'bundle';
        const keys = [`${kind}:${payload.deviceId}:${payload.sequenceNumber}`, `id:${payload.bundleId}`];
        if (keys.some((key) => identities.has(key) && identities.get(key) !== digest)) throw new Error('Same history identity has different ciphertext. Both originals were preserved for review');
        if (keys.some((key) => identities.get(key) === digest)) { result.duplicates++; continue; }
        for (const key of keys) identities.set(key, digest);
        if (entry.kind === 'snapshot') {
          result.warnings.push(`Snapshot preserved as evidence: ${entry.relative}. Device ledger backups establish the recovery baseline.`);
          continue;
        }
        const filename = parseBundleFilename(path.basename(entry.relative));
        if (filename && (filename.deviceId !== payload.deviceId || filename.sequenceNumber !== payload.sequenceNumber)) throw new Error('Bundle filename and authenticated identity disagree');
        if (!filename) result.warnings.push(`Authenticated provider conflict copy will be reviewed under its embedded identity: ${entry.relative}`);
        result.bundles.push({ file, payload });
      } catch (error) {
        result.issues.push(`${entry.relative}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (rootIdentity(folder) !== identity) throw new Error('A source mailbox moved or was replaced while it was being inventoried.');
  }
  result.bundles.sort((a, b) => a.payload.sequenceNumber - b.payload.sequenceNumber || a.payload.deviceId.localeCompare(b.payload.deviceId));
  return result;
}

/** Refuse a stale review, including newly arrived files, not just edited files. */
export async function verifyInventory(inventory: RecoveryInventory): Promise<void> {
  for (const root of inventory.roots) {
    if (rootIdentity(root.path) !== root.identity) throw new Error('A source mailbox moved or was replaced after review.');
    const current = collect(root.path).map((file) => file.relative).sort();
    const previous = inventory.files.filter((file) => file.source === root.path).map((file) => file.relativePath).sort();
    if (JSON.stringify(current) !== JSON.stringify(previous)) throw new Error('New or missing mailbox objects require a refreshed recovery review.');
  }
  for (const file of inventory.files) {
    await yieldToApplication();
    const stat = fs.lstatSync(file.originalPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size || sha256(fs.readFileSync(file.originalPath)) !== file.sha256) {
      throw new Error('Mailbox history changed after review. Preserved evidence is available; refresh the review.');
    }
    if (sha256(fs.readFileSync(file.evidencePath)) !== file.sha256) throw new Error('Private recovery evidence changed.');
  }
}
