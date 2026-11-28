import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { setImmediate as yieldToApplication } from 'node:timers/promises';
import { openDatabase, getAttachmentStoragePath } from '../database/connection';
import { newAccountPath } from '../services/account-catalog';
import { bindExistingSyncFolder, readFolderManifest, getFolderBinding } from './folder-binding';
import { assertSyncRootExists, writeSyncFileExclusively } from './bundle-io';
import { writeAttachmentFile } from './attachment-transport';
import { createSnapshot } from './compaction';
import { SyncOrchestrator } from './sync-orchestrator';
import { encryptAndSign } from './bundle-crypto';
import { signOrganisationDecision } from './organisation-authority';
import { recoveryDirectory, readRecoveryJournal, saveRecoveryJournal, recoveryPreview } from './recovery-session';
import { readRecoveryAttachment, verifyLocalAttachmentEvidence } from './recovery-attachments';
import { verifyInventory } from './recovery-inventory';
import { capturePeerLedger, isWithin, type RecoverySource } from './recovery-database';
import { sourceFingerprint, sha256 } from './recovery-state';
import type { RecoveryPreview, RecoveryPublishInput } from '../../shared/sync-recovery-types';

function rootIdentity(folder: string): string {
  assertSyncRootExists(folder);
  const stat = fs.statSync(folder, { bigint: true });
  return JSON.stringify({ path: fs.realpathSync(folder), dev: String(stat.dev), ino: String(stat.ino) });
}
function exclusive(file: string, bytes: Buffer): void {
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !fs.readFileSync(file).equals(bytes)) throw new Error('A publication destination contains different data. Both copies were preserved.');
    return;
  }
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', flush: true, mode: 0o600 });
    try { fs.linkSync(temporary, file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || fs.lstatSync(file).isSymbolicLink() || !fs.readFileSync(file).equals(bytes)) throw error;
    }
  } finally { fs.rmSync(temporary, { force: true }); }
  if (!fs.readFileSync(file).equals(bytes)) throw new Error('Published bytes could not be verified.');
}
function mailboxFiles(folder: string): { relative: string; hash: string }[] {
  const files = [{ relative: '.fidra-sync', hash: sha256(fs.readFileSync(path.join(folder, '.fidra-sync'))) }];
  for (const dir of ['sync', 'snapshots', 'attachments', 'receipts', 'invites']) {
    const child = path.join(folder, dir); if (!fs.existsSync(child)) continue;
    for (const entry of fs.readdirSync(child, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Unexpected private publication object.');
      files.push({ relative: path.join(dir, entry.name), hash: sha256(fs.readFileSync(path.join(child, entry.name))) });
    }
  }
  // The manifest is the commit marker, so it is always copied last.
  return files.sort((a, b) => Number(a.relative === '.fidra-sync') - Number(b.relative === '.fidra-sync') || a.relative.localeCompare(b.relative));
}

/** Publishes a closed new account and new mailbox. A durable plan pins all
 * bytes before publication. Failures can retry the same plan; no original or
 * competing object is replaced, and no existing peer is silently reassigned. */
export async function publishRecovery(source: RecoverySource, input: RecoveryPublishInput, passphrase: string): Promise<RecoveryPreview> {
  source.verifyAccess?.();
  const directory = recoveryDirectory(source, input.id);
  const journal = readRecoveryJournal(source, input.id, passphrase);
  const pending = source.sqlite.prepare("SELECT value FROM sync_meta WHERE key='recovery.pending'").pluck().get() as string | undefined;
  if (pending && JSON.parse(pending).id !== input.id) throw new Error('Another recovery reached its final commit. Resume that saved review before publishing a different recovery.');
  const markPublished = (databasePath: string) => source.sqlite.transaction(() => {
    source.sqlite.prepare("INSERT INTO sync_meta(key,value) VALUES ('recovery.published',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify({ id: journal.id, newDbPath: databasePath }));
    source.sqlite.prepare("DELETE FROM sync_meta WHERE key='recovery.pending'").run();
  }).immediate();
  if (journal.phase === 'published') {
    const plan = journal.publication;
    if (!plan || sha256(fs.readFileSync(plan.databasePath)) !== plan.databaseHash) throw new Error('The published account changed. Open it directly; do not repeat this recovery publication.');
    markPublished(plan.databasePath);
    return recoveryPreview(source, input.id, passphrase);
  }
  if (!input.confirmPausedClients || !input.confirmReviewedChanges) throw new Error('Review the account changes and pause every old client before publishing.');
  if (sourceFingerprint(source.sqlite) !== journal.sourceFingerprint) throw new Error('The operational ledger changed. Start a fresh recovery review.');
  const destination = path.resolve(input.destinationFolder);
  const identity = rootIdentity(destination);
  if (journal.inventory.roots.some((root) => isWithin(root.path, destination) || isWithin(destination, root.path)) || isWithin(directory, destination) || isWithin(destination, directory)) throw new Error('Choose a new dedicated mailbox outside the old history and private recovery directories.');
  await verifyInventory(journal.inventory);
  await verifyLocalAttachmentEvidence(journal.attachments);
  for (const capture of journal.captures.slice(1)) {
    await yieldToApplication();
    if (capturePeerLedger(capture.originalPath).fingerprint !== capture.fingerprint) throw new Error('A peer ledger changed after capture. Preserve its latest backup in a fresh review.');
  }
  if (!journal.publication) {
    const preview = recoveryPreview(source, input.id, passphrase);
    if (journal.phase !== 'review' || preview.reviewDigest !== input.reviewDigest) throw new Error('The review changed. Reload it before publishing.');
    if (preview.issues.length || preview.conflicts.length) throw new Error('Resolve every conflict and recovery issue before publishing.');
    if (preview.attachments.some((item) => !item.selectedHash)) throw new Error('Choose every attachment alternative and supply missing files before publishing.');
    const retired = new Set(input.retiredDevices);
    if ([...retired].some((id) => !preview.peers.some((peer) => peer.deviceId === id && !peer.hasLedger))) throw new Error('Only an identified device without a captured ledger may be explicitly retired.');
    if (preview.peers.some((peer) => !peer.hasLedger && !retired.has(peer.deviceId))) throw new Error('Supply a full ledger backup or explicitly retire each known old device. A receipt does not prove that its local edits were captured.');
    if (fs.readdirSync(destination).some((name) => name !== '.DS_Store')) throw new Error('The new mailbox must be empty. Existing objects were preserved.');
    const privateMailbox = path.join(directory, 'mailbox');
    const { db } = openDatabase(path.join(directory, 'stage.fdra'));
    try {
      const group = getFolderBinding(db)!.groupId;
      const storage = getAttachmentStoragePath(journal.stageDatabaseId); fs.mkdirSync(storage, { recursive: true, mode: 0o700 });
      for (const attachment of preview.attachments) {
        await yieldToApplication();
        const row = db.prepare('SELECT stored_name FROM attachments WHERE id=?').get(attachment.id) as { stored_name: string };
        const evidence = journal.attachments.find((item) => item.storedName === row.stored_name)!;
        const bytes = readRecoveryAttachment(directory, evidence, attachment.selectedHash!, passphrase);
        const local = path.join(storage, row.stored_name); exclusive(local, bytes);
        db.prepare('UPDATE attachments SET file_size=? WHERE id=?').run(bytes.length, attachment.id);
        writeAttachmentFile(privateMailbox, row.stored_name, local, passphrase, group);
      }
      db.prepare("UPDATE personnel SET device_id=? WHERE id=?").run(journal.stageDeviceId, source.actorId);
      const sync = new SyncOrchestrator({ db, syncFolder: privateMailbox, deviceId: journal.stageDeviceId, passphrase });
      sync.exportNow(); if (sync.getStatus().lastError) throw new Error(sync.getStatus().lastError!);
      const sequence = Number(db.prepare("SELECT value FROM sync_meta WHERE key='sync.sequenceNumber'").pluck().get());
      createSnapshot(db, privateMailbox, journal.stageDeviceId, db.prepare('SELECT crsql_site_id()').pluck().get() as Buffer, sequence, passphrase);
      const manifest = readFolderManifest(privateMailbox, passphrase);
      const decision = { version: 1, migrationId: journal.id, groupId: group, locationId: manifest.locationId,
        authorityPublicKey: manifest.authorityPublicKey!, manifestHash: getFolderBinding(db)!.manifestHash,
        retiredDevices: [...retired].sort(), predecessors: journal.captures.map((item) => ({ deviceId: item.deviceId, fingerprint: item.fingerprint })),
        reviewedLedgerDigest: preview.ledgerDigest, createdAt: journal.createdAt };
      const certificate = encryptAndSign(Buffer.from(JSON.stringify({ decision, signature: signOrganisationDecision(db, manifest.authorityPublicKey!, passphrase, decision) })), passphrase);
      writeSyncFileExclusively(privateMailbox, 'receipts', `${journal.id}.recovery`, certificate);
      // Device settings do not leave this database. Bind only after copying the
      // pinned mailbox; the original private binding remains until then.
      db.prepare("INSERT INTO settings(key,value,scope) VALUES ('localSync.syncFolder',?,'device') ON CONFLICT(key) DO UPDATE SET value=excluded.value,scope='device'").run(destination);
      db.pragma('wal_checkpoint(TRUNCATE)');
      journal.retiredDevices = [...retired];
    } finally { db.close(); }
    journal.publication = { destination, rootIdentity: identity, databasePath: newAccountPath(),
      databaseHash: '', reviewDigest: input.reviewDigest, files: mailboxFiles(privateMailbox) };
    journal.phase = 'publishing'; saveRecoveryJournal(directory, journal, passphrase);
  }
  const plan = journal.publication!;
  if (plan.destination !== destination || plan.rootIdentity !== identity || plan.reviewDigest !== input.reviewDigest) throw new Error('Retry this publication with its original destination and reviewed version.');
  for (const file of plan.files) {
    await yieldToApplication();
    if (rootIdentity(destination) !== plan.rootIdentity) throw new Error('The destination moved or was replaced. Publication is paused.');
    const bytes = fs.readFileSync(path.join(directory, 'mailbox', file.relative));
    if (sha256(bytes) !== file.hash) throw new Error('Prepared publication bytes changed.');
    // Do not publish the manifest if a source changed while large objects copied.
    if (file.relative === '.fidra-sync') {
      source.verifyAccess?.();
      await verifyInventory(journal.inventory);
      await verifyLocalAttachmentEvidence(journal.attachments);
      for (const capture of journal.captures.slice(1)) if (capturePeerLedger(capture.originalPath).fingerprint !== capture.fingerprint) throw new Error('A peer changed during publication. Start a fresh review.');
      source.verifyAccess?.();
      if (sourceFingerprint(source.sqlite) !== journal.sourceFingerprint) throw new Error('Local edits arrived during publication. No mailbox commit marker was published; start a fresh recovery stage.');
      if (rootIdentity(destination) !== plan.rootIdentity) throw new Error('The destination moved before publication completed.');
      // Persist the transport pause before the shared commit marker. If disk or
      // process failure interrupts final retirement, even a restart stays paused.
      source.sqlite.prepare("INSERT INTO sync_meta(key,value) VALUES ('recovery.pending',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(JSON.stringify({ id: journal.id }));
    }
    const parts = file.relative.split(path.sep);
    if (parts.length === 1) exclusive(path.join(destination, file.relative), bytes);
    else writeSyncFileExclusively(destination, parts[0] as 'sync' | 'snapshots' | 'attachments' | 'receipts' | 'invites', parts[1], bytes);
  }
  // This last section has no await. The live ledger cannot accept a renderer
  // edit between final recheck, source retirement and returning the new path.
  if (sourceFingerprint(source.sqlite) !== journal.sourceFingerprint) throw new Error('Local edits arrived during publication. Preserve both stages and review again.');
  source.verifyAccess?.();
  const stage = path.join(directory, 'stage.fdra');
  if (!plan.databaseHash) {
    const { db } = openDatabase(stage);
    try { bindExistingSyncFolder(db, destination, passphrase); db.pragma('wal_checkpoint(TRUNCATE)'); } finally { db.close(); }
  }
  const bytes = fs.readFileSync(stage);
  if (plan.databaseHash && plan.databaseHash !== sha256(bytes)) throw new Error('Prepared recovered account changed.');
  plan.databaseHash = sha256(bytes); saveRecoveryJournal(directory, journal, passphrase);
  exclusive(plan.databasePath, bytes);
  journal.publishedDbPath = plan.databasePath; journal.publishedFolder = destination; journal.phase = 'published';
  // Persist completed journal before the old transport marker. A crash retry can
  // repair the marker from this same, already verified publication.
  saveRecoveryJournal(directory, journal, passphrase);
  markPublished(plan.databasePath);
  return recoveryPreview(source, input.id, passphrase);
}
