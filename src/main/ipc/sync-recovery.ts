import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ipcMain } from 'electron';
import { z } from 'zod';
import { resolveContext } from './context-resolver';
import { getWindowManager } from '../window/window-manager';
import { assertApplicationPermission } from '../services/application-access';
import { prepareRecovery, recoveryPreview, resolveRecoveryChoice, chooseRecoveryAttachment, readRecoveryJournal } from '../sync/recovery-session';
import { publishRecovery } from '../sync/recovery-publication';
import type { RecoverySource } from '../sync/recovery-database';
import type { IpcMainInvokeEvent } from 'electron';

const uuid = z.string().uuid(); const digest = z.string().regex(/^[a-f0-9]{64}$/);
const file = z.string().min(1).max(4096).refine((value) => path.isAbsolute(value) && !value.includes('\0'));
const pending = new Set<string>();
function sourceFor(event: IpcMainInvokeEvent, publishing = false): { source: RecoverySource; passphrase: string } {
  const ctx = resolveContext(event); const actor = assertApplicationPermission(ctx, 'teamAdministration');
  if (actor.kind !== 'team' || !ctx.localSyncPassphrase) throw new Error('Sign in as a team administrator before reviewing recovery.');
  const verifyAccess = () => {
    const current = resolveContext(event); const signedIn = assertApplicationPermission(current, 'teamAdministration');
    if (current !== ctx || signedIn.kind !== 'team' || signedIn.id !== actor.id || !current.localSyncPassphrase) throw new Error('The active account or signed-in administrator changed.');
    if (publishing && getWindowManager().otherWindowsWithFile(event.sender.id, ctx.dbPath).length) throw new Error('Close other windows using this ledger before publishing recovery.');
  };
  verifyAccess();
  return { source: { sqlite: ctx.sqlite, databaseId: ctx.databaseId, dbPath: ctx.dbPath, actorId: actor.id, actorName: actor.name, verifyAccess }, passphrase: ctx.localSyncPassphrase };
}
export function registerRecoveryHandlers(): void {
  const handle = <T>(channel: string, action: (event: IpcMainInvokeEvent, input: unknown) => T | Promise<T>) => {
    ipcMain.handle(channel, async (event, input: unknown) => {
      let key: string | undefined;
      let acquired = false;
      try {
        const ctx = resolveContext(event); key = ctx.databaseId;
        if (pending.has(key)) throw new Error('Another recovery operation is still running. Wait for it to finish.');
        pending.add(key); acquired = true;
        return { success: true, value: await action(event, input) };
      } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
      finally { if (key && acquired) pending.delete(key); }
    });
  };
  handle('localSync:recoveryList', (event) => {
    const { source, passphrase } = sourceFor(event);
    const parent = path.join(os.homedir(), '.fidra', 'recovery', source.databaseId);
    if (!fs.existsSync(parent)) return [];
    return fs.readdirSync(parent).filter((id) => uuid.safeParse(id).success).flatMap((id) => {
      try { const journal = readRecoveryJournal(source, id, passphrase); return [{ id, createdAt: journal.createdAt, phase: journal.phase }]; }
      catch { return []; } // Interrupted preparation without a valid journal has no review to resume.
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
  handle('localSync:recoveryPrepare', (event, raw) => {
    const input = z.object({ mailboxes: z.array(file).max(20), peerLedgers: z.array(file).max(50) }).strict().parse(raw);
    const { source, passphrase } = sourceFor(event); return prepareRecovery(source, input, passphrase);
  });
  handle('localSync:recoveryPreview', (event, raw) => {
    const id = uuid.parse(raw); const { source, passphrase } = sourceFor(event); return recoveryPreview(source, id, passphrase);
  });
  handle('localSync:recoveryResolve', (event, raw) => {
    const input = z.object({ id: uuid, conflictId: uuid, choice: z.enum(['keep-local', 'accept-remote', 'delete-both']), reviewDigest: digest }).strict().parse(raw);
    const { source, passphrase } = sourceFor(event); return resolveRecoveryChoice(source, input.id, input.conflictId, input.choice, input.reviewDigest, passphrase);
  });
  handle('localSync:recoveryAttachment', (event, raw) => {
    const input = z.object({ id: uuid, attachmentId: z.string().min(1).max(200), hash: digest, reviewDigest: digest }).strict().parse(raw);
    const { source, passphrase } = sourceFor(event); return chooseRecoveryAttachment(source, input.id, input.attachmentId, input.hash, input.reviewDigest, passphrase);
  });
  handle('localSync:recoveryPublish', (event, raw) => {
    const input = z.object({ id: uuid, destinationFolder: file, retiredDevices: z.array(z.string().min(1).max(200)).max(200), confirmPausedClients: z.boolean(), confirmReviewedChanges: z.boolean(), reviewDigest: digest }).strict().parse(raw);
    const { source, passphrase } = sourceFor(event, true); return publishRecovery(source, input, passphrase);
  });
}
