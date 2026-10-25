import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../database/connection';
import { SheetRepo } from '../../repositories/sheet-repo';
import { TransactionRepo } from '../../repositories/transaction-repo';
import { AiBridge } from '../ai-bridge';
import { ReconciliationService } from '../reconciliation';
import type { WindowContext } from '../../window/window-context';

let directory: string; let db: Database.Database; let bridge: AiBridge; let context: WindowContext;
let allowed: boolean; let current: boolean; let preparing: boolean; let beforeApply: ReturnType<typeof vi.fn>;
const content = 'Date,Description,Amount\n2026-10-24,BANK PAYMENT,-12.00\n';
const scope = { sheetIds: ['current'], from: '2026-10-01', to: '2026-10-31', fields: ['description'] as ['description'] };
const draft = { label: 'Test bank statement', rows: [{ sheetId: 'current', source: { statementHash: 'a'.repeat(64), row: 0, date: '2026-10-24', amount: '12.00', type: 'expense', description: 'BANK PAYMENT', evidence: '2026-10-24,BANK PAYMENT,-12.00' }, description: 'Pool hire', party: null, category: null, activity: null, action: 'new' }] };
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-ai-domain-')); db = openDatabase(path.join(directory, 'ledger.fdra')).db;
  new SheetRepo(db).create('current', 'Current'); new SheetRepo(db).create('private', 'Private');
  context = { dbPath: path.join(directory, 'ledger.fdra'), reconciliation: new ReconciliationService(db), isClosed: false, isLocalSyncAuthEnabled: false, localAuthPersonnel: null } as unknown as WindowContext;
  allowed = true; current = true; preparing = false; beforeApply = vi.fn(async () => undefined);
  bridge = new AiBridge({ isCurrent: () => current, isPreparing: () => preparing, onChanged: () => undefined, beforeApply });
});
afterEach(() => { vi.useRealTimers(); bridge.stop(); db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
async function pair(add = true, uploads = true) {
  const info = await bridge.connect(context, 'chatgpt', scope, { allowAdd: add, allowStatementUploads: uploads }, () => allowed);
  const call = (name: string, args: unknown = {}) => bridge.invoke(context, info.id, 'tools/call', { name, arguments: args });
  if (uploads) {
    const result = await call('register_statement', { name: 'statement.csv', encoding: 'utf8', content }) as { content: { text: string }[] };
    draft.rows[0].source.statementHash = JSON.parse(result.content[0].text).hash;
  }
  return { info, call };
}
describe('guarded reconciliation sessions', () => {
  it('cannot create a session without current authorisation', async () => {
    allowed = false; await expect(pair()).rejects.toThrow('not authorised');
  });
  it('enforces separate upload and add permissions', async () => {
    const p = await pair(false, false);
    await expect(p.call('register_statement', { name: 'a.csv', encoding: 'utf8', content })).rejects.toThrow('cannot receive');
    await expect(p.call('apply_reconciliation', {})).rejects.toThrow('draft-only');
    expect(beforeApply).not.toHaveBeenCalled();
  });
  it('requires actual flagged-row answers, backs up, adds once and refuses an undone replay', async () => {
    const p = await pair(); const proposal = bridge.stage(context, p.info.id, draft);
    const input = { id: proposal.id, digest: proposal.digest, resolutions: [] as { rowIndex: number; answer: string }[] };
    await expect(p.call('apply_reconciliation', input)).rejects.toThrow('Ask the user');
    input.resolutions = [{ rowIndex: 0, answer: 'User confirmed the pool hire and unassigned optional fields.' }];
    await p.call('apply_reconciliation', input); await p.call('apply_reconciliation', input);
    expect(new TransactionRepo(db).getAll()).toHaveLength(1); expect(beforeApply).toHaveBeenCalledTimes(1);
    context.reconciliation.undo(proposal.id, 'User');
    await expect(p.call('apply_reconciliation', input)).rejects.toThrow('user undid');
  });
  it('rechecks access after backup and never writes after revocation', async () => {
    const p = await pair(); const proposal = bridge.stage(context, p.info.id, draft);
    beforeApply.mockImplementation(async () => { allowed = false; });
    await expect(p.call('apply_reconciliation', { id: proposal.id, digest: proposal.digest, resolutions: [{ rowIndex: 0, answer: 'Confirmed' }] })).rejects.toThrow('connection ended');
    expect(new TransactionRepo(db).getAll()).toHaveLength(0);
  });
  it('does not write if the backup fails', async () => {
    const p = await pair(); const proposal = bridge.stage(context, p.info.id, draft);
    beforeApply.mockRejectedValue(new Error('Disk full'));
    await expect(p.call('apply_reconciliation', { id: proposal.id, digest: proposal.digest, resolutions: [{ rowIndex: 0, answer: 'Confirmed' }] })).rejects.toThrow('Disk full');
    expect(new TransactionRepo(db).getAll()).toHaveLength(0);
  });
  it('isolates drafts and accounts and rejects fabricated evidence', async () => {
    const a = await pair(); const b = await pair(); const proposal = bridge.stage(context, a.info.id, draft);
    await expect(b.call('get_proposal', { id: proposal.id })).rejects.toThrow('another connection');
    const escape = structuredClone(draft); escape.rows[0].sheetId = 'private';
    expect(() => bridge.stage(context, a.info.id, escape)).toThrow();
    const invented = structuredClone(draft); invented.rows[0].source.evidence = 'invented';
    expect(() => bridge.stage(context, a.info.id, invented)).toThrow('original source');
  });
  it('rejects filesystem paths and unknown editing tools', async () => {
    const p = await pair();
    await expect(p.call('register_statement', { name: '../secret.csv', encoding: 'utf8', content })).rejects.toThrow();
    await expect(p.call('delete_transactions', {})).rejects.toThrow();
    await expect(p.call('read_context', { path: '/etc/passwd' })).rejects.toThrow();
  });
  it('fails closed on window changes and app preparation without expiring durable approval', async () => {
    const p = await pair(); current = false; await expect(p.call('read_context')).rejects.toThrow(); current = true;
    preparing = true; await expect(p.call('read_context')).rejects.toThrow(); preparing = false;
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 16 * 60_000);
    await expect(p.call('read_context')).resolves.toBeDefined();
  });
});
