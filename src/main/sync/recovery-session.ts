import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { setImmediate as yieldToApplication } from 'node:timers/promises';
import { z } from 'zod';
import { openDatabase } from '../database/connection';
import { initializeCrr, CRR_SCHEMA_VERSION } from './crr-schema';
import { captureCurrentLedger, capturePeerLedger, assertPeerLineage, copyChanges, type LedgerCapture, type RecoverySource } from './recovery-database';
import { sourceFingerprint, readLedgerState, ledgerDigest, accountChanges, ledgerChanges, sha256, currentChanges } from './recovery-state';
import { inventoryMailboxes, type RecoveryInventory } from './recovery-inventory';
import { encryptAndSign, verifyAndDecrypt } from './bundle-crypto';
import { initializeOrBindSyncFolder, getFolderBinding, readFolderManifest } from './folder-binding';
import { authorityFingerprint } from './organisation-authority';
import { SyncOrchestrator } from './sync-orchestrator';
import { ConflictQueue } from './conflict-queue';
import { CausalHistory } from './causal-history';
import { AppliedBundles } from './applied-bundles';
import { classifyChangesets, applyMergeResult, LINKED_TRANSFER_REVIEW, entityChanges, CRSQL_DELETE_SENTINEL } from './merge-gate';
import { packBundle, unpackBundle, serializeChangesetRow, type CrChangesetRow } from './bundle-format';
import { settingsKey, isOrgChangeset } from './settings-filter';
import { validateRecoveryLedger } from './recovery-validation';
import { captureRecoveryAttachments, attachmentReview, type AttachmentEvidence } from './recovery-attachments';
import { compareRecoveryTransfer, resolveRecoveryTransfer } from './recovery-transfers';
import { resolveSyncConflict, decodeConflictRows } from './conflict-resolution';
import { OutboundBundles } from './outbound-bundles';
import type { RecoveryPrepareInput, RecoveryPreview } from '../../shared/sync-recovery-types';

export interface CapturedSource extends Omit<LedgerCapture, 'rows' | 'state' | 'conflicts'> { originalPath: string; backupFile: string }
export interface RecoveryJournal {
  version: 1;
  id: string;
  phase: RecoveryPreview['phase'];
  createdAt: string;
  sourcePath: string;
  sourceDatabaseId: string;
  sourceFingerprint: string;
  actorId: string;
  actorName: string;
  stageDatabaseId: string;
  stageDeviceId: string;
  captures: CapturedSource[];
  inventory: RecoveryInventory;
  issues: string[];
  warnings: string[];
  retiredDevices: string[];
  attachmentSelections: Record<string, string>;
  attachments: AttachmentEvidence[];
  publication?: { destination: string; rootIdentity: string; databasePath: string; databaseHash: string; reviewDigest: string; files: { relative: string; hash: string }[] };
  publishedDbPath?: string;
  publishedFolder?: string;
}

export function recoveryDirectory(source: RecoverySource, id: string): string {
  z.string().uuid().parse(source.databaseId); z.string().uuid().parse(id);
  return path.join(os.homedir(), '.fidra', 'recovery', source.databaseId, id);
}
export function saveRecoveryJournal(directory: string, journal: RecoveryJournal, passphrase: string): void {
  const temporary = path.join(directory, `${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temporary, encryptAndSign(Buffer.from(JSON.stringify(journal)), passphrase), { flag: 'wx', flush: true, mode: 0o600 });
  fs.renameSync(temporary, path.join(directory, 'stage.journal'));
}
export function readRecoveryJournal(source: RecoverySource, id: string, passphrase: string): RecoveryJournal {
  const directory = recoveryDirectory(source, id);
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid private recovery directory.');
  const journal = JSON.parse(verifyAndDecrypt(fs.readFileSync(path.join(directory, 'stage.journal')), passphrase).toString('utf8')) as RecoveryJournal;
  if (journal.version !== 1 || journal.id !== id || journal.sourceDatabaseId !== source.databaseId
    || journal.sourcePath !== fs.realpathSync(source.dbPath)) throw new Error('This recovery belongs to another ledger.');
  for (const capture of journal.captures) {
    if (path.basename(capture.backupFile) !== capture.backupFile
      || sha256(fs.readFileSync(path.join(directory, capture.backupFile))) !== capture.backupHash) throw new Error('A preserved recovery backup changed.');
  }
  return journal;
}

function retained(capture: LedgerCapture, originalPath: string, backupFile: string): CapturedSource {
  return { deviceId: capture.deviceId, siteId: capture.siteId, databaseId: capture.databaseId, groupId: capture.groupId,
    fingerprint: capture.fingerprint, applied: capture.applied, exportedSequence: capture.exportedSequence,
    backupHash: capture.backupHash, historyPins: capture.historyPins, originalPath, backupFile };
}
function recoverableRows(rows: CrChangesetRow[], expectedGroup: string | null): CrChangesetRow[] {
  return rows.filter(isOrgChangeset).filter((row) => {
    if (row.table !== 'settings' || settingsKey(row) !== 'localSync.groupId') return true;
    if (row.cid === 'value' && expectedGroup && row.val !== expectedGroup) throw new Error('Incoming history attempts to adopt another team identity.');
    return false; // The reviewed new team receives a fresh group ID.
  });
}

/** A full current ledger is the baseline. Old snapshots remain evidence; they
 * never skip a bundle or overwrite an existing operational file. */
export async function prepareRecovery(source: RecoverySource, input: RecoveryPrepareInput, passphrase: string): Promise<RecoveryPreview> {
  source.verifyAccess?.();
  const id = crypto.randomUUID();
  const directory = recoveryDirectory(source, id);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const base = captureCurrentLedger(source, path.join(directory, 'source.fdra'));
  const captures: CapturedSource[] = [retained(base, fs.realpathSync(source.dbPath), 'source.fdra')];
  const peers: LedgerCapture[] = [];
  for (const [index, file] of input.peerLedgers.entries()) {
    await yieldToApplication();
    const name = `peer-${index}.fdra`;
    const captured = capturePeerLedger(file, path.join(directory, name));
    assertPeerLineage(base, captured);
    if (captures.some((capture) => capture.deviceId === captured.deviceId)) throw new Error('Two selected ledgers share a device identity. Review their fork before recovery.');
    peers.push(captured); captures.push(retained(captured, fs.realpathSync(file), name));
  }
  const configured = source.sqlite.prepare("SELECT value FROM settings WHERE key='localSync.syncFolder'").pluck().get() as string | undefined;
  const roots = [...input.mailboxes];
  if (configured && fs.existsSync(configured)) roots.push(configured);
  const inventory = await inventoryMailboxes(roots, passphrase, path.join(directory, 'evidence'));
  if (configured && !fs.existsSync(configured)) inventory.warnings.push('The configured old mailbox is unavailable. Its uncaptured history may be missing; keep every original account and review all device backup or retirement decisions.');
  const privateMailbox = path.join(directory, 'mailbox'); fs.mkdirSync(privateMailbox);
  const opened = openDatabase(path.join(directory, 'stage.fdra'));
  const db = opened.db;
  const stageDeviceId = crypto.randomUUID();
  const journal: RecoveryJournal = { version: 1, id, phase: 'preparing', createdAt: new Date().toISOString(),
    sourcePath: fs.realpathSync(source.dbPath), sourceDatabaseId: source.databaseId, sourceFingerprint: base.fingerprint,
    actorId: source.actorId, actorName: source.actorName, stageDatabaseId: opened.databaseId, stageDeviceId,
    captures, inventory: { ...inventory, bundles: [] }, issues: [...inventory.issues], warnings: [...inventory.warnings],
    retiredDevices: [], attachmentSelections: {}, attachments: [] };
  saveRecoveryJournal(directory, journal, passphrase);
  try {
    initializeCrr(db);
    db.transaction(() => {
      copyChanges(db, recoverableRows(base.rows, base.groupId));
      db.prepare("INSERT INTO sync_meta(key,value) VALUES ('device.id',?)").run(stageDeviceId);
      db.prepare("INSERT INTO sync_meta(key,value) VALUES ('device.createdAt',?)").run(new Date().toISOString());
    })();
    initializeOrBindSyncFolder(db, privateMailbox, passphrase);
    // A new team baseline deliberately includes the captured revisions from all
    // original sites. Ordinary export only sends this fresh site's own edits.
    const baselineHistory = new CausalHistory(db); const outbox = new OutboundBundles(db);
    db.transaction(() => {
      const rows = currentChanges(db).filter(isOrgChangeset);
      const payload = packBundle({ deviceId: stageDeviceId, siteId: db.prepare('SELECT crsql_site_id()').pluck().get() as Buffer,
        sequenceNumber: 1, schemaVersion: CRR_SCHEMA_VERSION, changesets: rows, passphrase,
        groupId: getFolderBinding(db)!.groupId, observedBundles: {} });
      outbox.insert(stageDeviceId, 1, payload);
      baselineHistory.record({ deviceId: stageDeviceId, sequenceNumber: 1, observed: {} }, rows, true);
      db.prepare("INSERT INTO sync_meta(key,value) VALUES ('sync.sequenceNumber','1')").run();
    }).immediate();
    const sync = new SyncOrchestrator({ db, syncFolder: privateMailbox, deviceId: stageDeviceId, passphrase });
    sync.exportNow();
    if (sync.getStatus().lastError) throw new Error(sync.getStatus().lastError ?? 'Could not preserve the recovery baseline.');
    const history = new CausalHistory(db); const queue = new ConflictQueue(db); const applied = new AppliedBundles(db);
    // Review queues are local-only and are not represented by crsql_changes.
    // A database backup without this queue would silently lose held alternatives.
    for (const capture of [base, ...peers]) for (const conflict of capture.conflicts) {
      let local = conflict.local_changeset_json;
      if (!local && conflict.changeset_json) {
        try {
          const remote = decodeConflictRows(conflict.changeset_json);
          if (!remote.length || remote.some((row) => Buffer.from(row.pk).toString().includes('\uFFFD'))) throw new Error('Incomplete legacy key');
          const current = entityChanges(db, remote[0].table, remote[0].pk);
          const comparison = conflict.field_name === CRSQL_DELETE_SENTINEL || conflict.field_name === LINKED_TRANSFER_REVIEW
            ? current : current.filter((row) => row.cid === conflict.field_name);
          if (!comparison.length) throw new Error('Missing current comparison');
          local = JSON.stringify(comparison.map(serializeChangesetRow));
          journal.warnings.push(`Legacy conflict ${conflict.id} is compared against the captured current row. Its original comparison remains in the preserved ledger backup.`);
        } catch { /* Missing or lossy history remains a blocking preserved issue. */ }
      }
      queue.insert({ ...conflict, changeset_json: conflict.changeset_json ?? '', local_changeset_json: local ?? undefined });
      if (!conflict.changeset_json || !local) journal.issues.push(`Preserved legacy conflict ${conflict.id} needs complete originating history before publication.`);
    }
    const apply = (deviceId: string, sequenceNumber: number, bundleId: string, rows: CrChangesetRow[], payload: Buffer) => {
      const incoming = { deviceId, sequenceNumber, observed: {} };
      const classified = classifyChangesets(db, rows, { history, incoming, reviewSameSiteDivergence: true });
      db.transaction(() => {
        applyMergeResult(db, classified, queue, bundleId);
        applied.insert(bundleId, deviceId, sequenceNumber, payload);
        history.record(incoming, rows, classified.conflicts.length === 0);
      })();
    };
    for (const [index, peer] of peers.entries()) {
      await yieldToApplication();
      const peerDevice = `recovery-copy-${id}-${index}`;
      const rows = recoverableRows(peer.rows, base.groupId);
      const evidence = packBundle({ deviceId: peerDevice, siteId: Buffer.from(peer.siteId, 'hex'), sequenceNumber: 1,
        schemaVersion: 1, groupId: getFolderBinding(db)?.groupId, changesets: rows, passphrase });
      fs.writeFileSync(path.join(directory, `peer-${index}.sealed`), evidence, { flag: 'wx', flush: true, mode: 0o600 });
      apply(peerDevice, 1, unpackBundle(evidence, passphrase).bundleId, rows, evidence);
    }
    const pins = captures.flatMap((capture) => capture.historyPins);
    for (const bundle of inventory.bundles) {
      await yieldToApplication();
      const payload = bundle.payload;
      if (payload.groupId && base.groupId && payload.groupId !== base.groupId) {
        journal.issues.push(`History from ${payload.deviceId} belongs to another team.`); continue;
      }
      const matches = pins.filter((pin) => pin.bundleId === payload.bundleId || (pin.deviceId === payload.deviceId && pin.sequence === payload.sequenceNumber));
      if (matches.some((pin) => pin.hash !== bundle.file.sha256)) {
        journal.issues.push(`History identity ${payload.deviceId}/${payload.sequenceNumber} differs from a captured ledger’s retained ciphertext. Both originals need separate fork review.`); continue;
      }
      if (matches.length) continue;
      const rows = recoverableRows(payload.changesets, base.groupId);
      apply(payload.deviceId, payload.sequenceNumber, payload.bundleId, rows, fs.readFileSync(bundle.file.evidencePath));
    }
    journal.attachments = await captureRecoveryAttachments(readLedgerState(db).attachments, captures, inventory, base.groupId, directory, passphrase);
    journal.phase = 'review';
    db.pragma('wal_checkpoint(TRUNCATE)');
    saveRecoveryJournal(directory, journal, passphrase);
  } finally { db.close(); }
  return recoveryPreview(source, id, passphrase);
}

export function recoveryPreview(source: RecoverySource, id: string, passphrase: string): RecoveryPreview {
  const journal = readRecoveryJournal(source, id, passphrase);
  const directory = recoveryDirectory(source, id);
  const { db } = openDatabase(path.join(directory, 'stage.fdra'));
  try {
    const state = readLedgerState(db);
    const base = capturePeerLedger(path.join(directory, 'source.fdra'));
    const peerIds = new Set(journal.captures.map((capture) => capture.deviceId));
    for (const row of base.state.personnel) if (row.device_id) peerIds.add(String(row.device_id));
    for (const file of journal.inventory.files) {
      if (file.kind !== 'bundle') continue;
      const match = /^(.*)_(\d{10})\.bundle$/.exec(path.basename(file.relativePath));
      if (match) peerIds.add(match[1]);
    }
    const issues = [...journal.issues, ...validateRecoveryLedger(db)];
    if (journal.phase !== 'published' && sourceFingerprint(source.sqlite) !== journal.sourceFingerprint) issues.push('The operational ledger changed after this recovery started. Preserve this review and start a fresh stage.');
    const manifest = readFolderManifest(path.join(directory, 'mailbox'), passphrase);
    const conflicts = new ConflictQueue(db).getUnresolved().map((conflict) => {
      const summary = { id: conflict.id, table: conflict.entity_type,
        entity: conflict.entity_id, field: conflict.field_name, local: conflict.local_value, remote: conflict.remote_value,
        jointTransfer: conflict.field_name === LINKED_TRANSFER_REVIEW };
      if (!summary.jointTransfer) return summary;
      try {
        const comparison = compareRecoveryTransfer(db, conflict);
        const rows = (values: typeof comparison.local) => values.map((row) => ({ id: String(row.id), sheet: String(row.sheet), amount: String(row.amount), type: String(row.type), date: String(row.date) }));
        return { ...summary, transfer: { local: rows(comparison.local), remote: rows(comparison.remote), remoteError: comparison.remoteError } };
      } catch (error) { return { ...summary, transfer: { local: [], remote: [], remoteError: error instanceof Error ? error.message : String(error) } }; }
    });
    const attachments = attachmentReview(state.attachments, journal.attachments, journal.attachmentSelections);
    const digest = ledgerDigest(state, Object.fromEntries(attachments.filter((item) => item.selectedHash).map((item) => [item.id, item.selectedHash!])));
    return { id, phase: journal.phase, createdAt: journal.createdAt, sourceName: path.basename(source.dbPath),
      files: journal.inventory.files.length, duplicates: journal.inventory.duplicates, issues: [...new Set(issues)], warnings: journal.warnings,
      peers: [...peerIds].map((deviceId) => ({ deviceId, name: String(base.state.personnel.find((row) => row.device_id === deviceId)?.name ?? 'Unidentified device'),
        hasLedger: journal.captures.some((capture) => capture.deviceId === deviceId), retired: journal.retiredDevices.includes(deviceId) })),
      conflicts, attachments, accounts: accountChanges(base.state, state), changes: ledgerChanges(base.state, state), ledgerDigest: digest,
      reviewDigest: sha256(JSON.stringify({ digest, conflicts, attachments, issues, phase: journal.phase })),
      authorityFingerprint: manifest.authorityPublicKey ? authorityFingerprint(manifest.authorityPublicKey) : '',
      publicationFolder: journal.publication?.destination, publicationReviewDigest: journal.publication?.reviewDigest,
      publishedDbPath: journal.publishedDbPath, publishedFolder: journal.publishedFolder,
    };
  } finally { db.close(); }
}

export function resolveRecoveryChoice(source: RecoverySource, id: string, conflictId: string, choice: 'keep-local' | 'accept-remote' | 'delete-both', reviewDigest: string, passphrase: string): RecoveryPreview {
  const preview = recoveryPreview(source, id, passphrase);
  const journal = readRecoveryJournal(source, id, passphrase);
  if (journal.phase !== 'review' || preview.reviewDigest !== reviewDigest || sourceFingerprint(source.sqlite) !== journal.sourceFingerprint) throw new Error('This recovery review changed. Reload it before choosing.');
  const conflict = preview.conflicts.find((item) => item.id === conflictId);
  if (!conflict) throw new Error('This comparison is no longer pending.');
  const { db } = openDatabase(path.join(recoveryDirectory(source, id), 'stage.fdra'));
  try {
    if (conflict.jointTransfer) resolveRecoveryTransfer(db, conflictId, choice, source.actorName);
    else {
      if (choice === 'delete-both') throw new Error('Only a linked transfer has a two-entry delete action.');
      const result = resolveSyncConflict(db, conflictId, choice, source.actorName);
      if (!result.success) throw new Error(result.error);
    }
  } finally { db.close(); }
  return recoveryPreview(source, id, passphrase);
}

export function chooseRecoveryAttachment(source: RecoverySource, id: string, attachmentId: string, hash: string, reviewDigest: string, passphrase: string): RecoveryPreview {
  const preview = recoveryPreview(source, id, passphrase);
  const journal = readRecoveryJournal(source, id, passphrase);
  if (journal.phase !== 'review' || preview.reviewDigest !== reviewDigest || sourceFingerprint(source.sqlite) !== journal.sourceFingerprint) throw new Error('This recovery review changed. Reload it before choosing.');
  const item = preview.attachments.find((entry) => entry.id === attachmentId);
  if (!item?.alternatives.some((entry) => entry.hash === hash)) throw new Error('Choose a preserved attachment from this review.');
  const { db } = openDatabase(path.join(recoveryDirectory(source, id), 'stage.fdra'));
  try {
    const name = db.prepare('SELECT stored_name FROM attachments WHERE id=?').pluck().get(attachmentId) as string;
    journal.attachmentSelections[name] = hash;
    saveRecoveryJournal(recoveryDirectory(source, id), journal, passphrase);
  } finally { db.close(); }
  return recoveryPreview(source, id, passphrase);
}
