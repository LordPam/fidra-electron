import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { aiBackupCreateSchema as createSchema } from '../../shared/ai-application-tools';
import type { WindowContext } from '../window/window-context';
import type { BackupListItem } from '../../shared/ipc-types';
import { assertAiOperationAccess, type AiOperationAccess } from './ai-operation-access';
import { backupsCreate, backupsGetSettings, backupsList } from './backup-operations';
import { aiEmptyQuerySchema } from '../../shared/ai-ledger-read-types';

function summary(item: BackupListItem) {
  return { id: item.metadata.id, createdAt: item.metadata.createdAt, size: item.metadata.dbSize,
    attachmentsCount: item.metadata.attachmentsCount, attachmentsSize: item.metadata.attachmentsSize, trigger: item.metadata.trigger };
}
export function aiReadBackups(ctx: WindowContext, access: AiOperationAccess, raw: unknown) {
  assertAiOperationAccess(ctx, access, 'backups.read'); aiEmptyQuerySchema.parse(raw);
  const settings = backupsGetSettings(ctx);
  return { backups: backupsList(ctx).filter((item) => item.metadata.databaseId === ctx.databaseId).map(summary),
    settings: { retentionCount: settings.retentionCount, autoBackupOnClose: settings.autoBackupOnClose },
    instructions: 'Older backups without ledger identity are available in native Fidra. Restore and deletion require native review.' };
}
// Coalesces simultaneous deliveries; the metadata hash also survives app restart.
const creating = new Map<string, Promise<BackupListItem>>();
export async function aiCreateBackup(ctx: WindowContext, access: AiOperationAccess, connectionId: string, raw: unknown) {
  assertAiOperationAccess(ctx, access, 'backups.create');
  const input = createSchema.parse(raw);
  const key = createHash('sha256').update(JSON.stringify([connectionId, input.requestId])).digest('hex');
  const runningKey = `${fs.realpathSync.native(ctx.dbPath)}:${key}`;
  let operation = creating.get(runningKey);
  if (!operation) { operation = backupsCreate(ctx, key); creating.set(runningKey, operation); }
  try {
    const result = await operation;
    // Do not return data after revocation during the asynchronous backup.
    assertAiOperationAccess(ctx, access, 'backups.create');
    return summary(result);
  } finally { if (creating.get(runningKey) === operation) creating.delete(runningKey); }
}
