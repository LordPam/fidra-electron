import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../database/connection';
import { SettingsRepo } from '../../database/settings-repo';
import type { WindowContext } from '../../window/window-context';
import { aiAccessPolicySchema } from '../../../shared/ai-access-types';
import type { AiOperationAccess } from '../ai-operation-access';
import { aiCreateBackup, aiReadBackups } from '../ai-backup-operations';
import { backupsCreate, backupsDelete, backupsList, backupsRestore } from '../backup-operations';
import { createBackup } from '../backup-service';

let root: string;
let ctx: WindowContext;
let access: AiOperationAccess;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-external-backups-'));
  const dbPath = path.join(root, 'synthetic.fdra');
  const db = openDatabase(dbPath).db;
  ctx = { sqlite: db, dbPath, databaseId: randomUUID(), isClosed: false, isLocalSyncAuthEnabled: false,
    localAuthPersonnel: null, settingsRepo: new SettingsRepo(db), window: { webContents: { id: 1 } },
    stopLocalSyncServices: vi.fn(),
  } as unknown as WindowContext;
  ctx.settingsRepo.setSetting('backup.dir', path.join(root, 'backups'));
  access = { policy: aiAccessPolicySchema.parse({ sheetIds: [], fields: [], permissions: { allAccounts: true, capabilities: ['backups.read', 'backups.create'] } }), isCurrent: () => true };
});
afterEach(() => { if (ctx.sqlite.open) ctx.sqlite.close(); fs.rmSync(root, { recursive: true, force: true }); });

describe('scoped backup operations', () => {
  it('coalesces concurrent retries and reuses a retained backup after context recreation', async () => {
    const input = { requestId: randomUUID() };
    const [first, second] = await Promise.all([aiCreateBackup(ctx, access, 'connection', input), aiCreateBackup(ctx, access, 'connection', input)]);
    expect(second.id).toBe(first.id);
    expect((await aiCreateBackup({ ...ctx } as WindowContext, access, 'connection', input)).id).toBe(first.id);
    expect(backupsList(ctx)).toHaveLength(1);
    expect(first).not.toHaveProperty('path'); expect(first).not.toHaveProperty('requestKey');
    expect(JSON.stringify(first)).not.toContain(root);
    expect((await aiCreateBackup(ctx, access, 'another-connection', input)).id).not.toBe(first.id);
  });
  it('lists only identified backups of the approved ledger without paths or private deduplication hashes', async () => {
    await aiCreateBackup(ctx, access, 'connection', { requestId: randomUUID() });
    await createBackup(ctx.sqlite, ctx.dbPath, 'other-ledger', 'manual', { backupDir: path.join(root, 'backups'), retentionCount: 10, autoBackupOnClose: true });
    const legacy = path.join(root, 'backups', 'backup_legacy'); fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, 'metadata.json'), JSON.stringify({ id: 'legacy', dbName: 'synthetic.fdra', createdAt: '2020-01-01' }));
    const result = aiReadBackups(ctx, access, {});
    expect(result.backups).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(root);
    expect(JSON.stringify(result)).not.toContain('other-ledger');
    expect(JSON.stringify(result)).not.toContain('requestKey');
    expect(result.backups[0].id).not.toBe('legacy');
  });
  it('rejects missing capabilities, caller-supplied paths and access revoked during a backup', async () => {
    const narrow = { ...access, policy: aiAccessPolicySchema.parse({ sheetIds: ['main'], fields: [], permissions: {} }) };
    await expect(aiCreateBackup(ctx, narrow, 'connection', { requestId: randomUUID() })).rejects.toThrow('permission');
    await expect(aiCreateBackup(ctx, access, 'connection', { requestId: randomUUID(), path: root })).rejects.toThrow();
    expect(backupsList(ctx)).toHaveLength(0);
    const operation = aiCreateBackup(ctx, access, 'connection', { requestId: randomUUID() });
    access.isCurrent = () => false;
    await expect(operation).rejects.toThrow('revoked');
    expect(backupsList(ctx)).toHaveLength(1);
  });
  it('refuses arbitrary deletion and rechecks same-file windows after the asynchronous safety backup', async () => {
    const unrelated = path.join(root, 'do-not-delete'); fs.mkdirSync(unrelated);
    expect(() => backupsDelete(ctx, unrelated)).toThrow('backup list');
    expect(fs.existsSync(unrelated)).toBe(true);
    const target = await backupsCreate(ctx);
    const wm = { otherWindowsWithFile: vi.fn().mockReturnValueOnce([]).mockReturnValue([{}]), reopenWindowDatabase: vi.fn() };
    const result = await backupsRestore(ctx, target.path, wm);
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('another Fidra window') });
    expect(ctx.sqlite.open).toBe(true); expect(wm.reopenWindowDatabase).not.toHaveBeenCalled();
    expect(backupsDelete(ctx, target.path)).toBe(true);
  });
});
