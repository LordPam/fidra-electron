import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../database/connection';
import { SheetRepo } from '../../repositories/sheet-repo';
import { TransactionRepo } from '../../repositories/transaction-repo';
import { AiBridge } from '../ai-bridge';
import { ReconciliationService } from '../reconciliation';
import type { WindowContext } from '../../window/window-context';
import type { ReconciliationScope } from '../../../shared/reconciliation-types';

let directory: string;
let db: Database.Database;
let bridge: AiBridge;
let context: WindowContext;
let current: boolean;
let preparing: boolean;
let statementId: string;
let beforeApply: ReturnType<typeof vi.fn>;
const scope: ReconciliationScope = { sheetIds: ['current'], from: '2026-10-01', to: '2026-10-31', fields: ['description'] };
const draft = { label: 'Test bank statement', rows: [{ sheetId: 'current', source: { statementHash: 'a'.repeat(64), row: 0, date: '2026-10-24', amount: '12.00', type: 'expense', description: 'BANK PAYMENT', evidence: '2026-10-24,BANK PAYMENT,-12.00' },
  description: 'Pool hire', party: null, category: null, activity: null, action: 'new' }] };
type RpcResponse = { result?: { content?: { text: string }[]; tools?: { name: string }[] }; error?: { message: string } };

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-ai-test-'));
  db = openDatabase(path.join(directory, 'ledger.fdra')).db;
  new SheetRepo(db).create('current', 'Current'); new SheetRepo(db).create('private', 'Private');
  current = true; preparing = false;
  context = { dbPath: path.join(directory, 'ledger.fdra'), reconciliation: new ReconciliationService(db), isClosed: false,
    isLocalSyncAuthEnabled: false, localAuthPersonnel: null } as unknown as WindowContext;
  beforeApply = vi.fn(async () => undefined);
  bridge = new AiBridge({ directory: path.join(directory, 'connections'), isCurrent: () => current, isPreparing: () => preparing, onChanged: () => undefined, beforeApply });
  const file = path.join(directory, 'bank.csv'); fs.writeFileSync(file, 'Date,Description,Amount\n2026-10-24,BANK PAYMENT,-12.00\n');
  const statement = bridge.selectStatement(context, file); statementId = statement.id;
  draft.rows[0].source.statementHash = statement.hash;
});
afterEach(() => { vi.useRealTimers(); bridge.stop(); db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

async function pair(client: 'claude' | 'chatgpt' = 'claude', permissions = { allowAdd: false, allowStatementUploads: false }) {
  const info = await bridge.connect(context, client, { ...scope, statementIds: [statementId] }, permissions);
  const { file } = bridge.requireConnection(context, info.id);
  const details = JSON.parse(fs.readFileSync(file, 'utf8')) as { url: string; token: string };
  const call = async (method: string, params?: Record<string, unknown>, headers: Record<string, string> = {}) => fetch(details.url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${details.token}`, ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return { info, file, call };
}

describe('personal AI capability boundary', () => {
  it('does not expose or accept upload/apply calls without their explicit grant', async () => {
    const paired = await pair();
    for (const name of ['register_statement', 'apply_reconciliation']) {
      const result = await (await paired.call('tools/call', { name, arguments: {} })).json() as RpcResponse;
      expect(result.error).toBeDefined();
    }
    expect(beforeApply).not.toHaveBeenCalled();
    expect(new TransactionRepo(db).getAll()).toEqual([]);
  });
  it('accepts selected chat attachments as bytes without accepting filesystem paths', async () => {
    const paired = await pair('chatgpt', { allowAdd: false, allowStatementUploads: true });
    const uploaded = await (await paired.call('tools/call', { name: 'register_statement', arguments: { name: 'chat.csv', encoding: 'utf8', content: 'Date,Description,Amount\n2026-10-25,Membership,25.00\n' } })).json() as RpcResponse;
    const statement = JSON.parse(uploaded.result!.content![0].text) as { id: string; hash: string };
    const selected = bridge.context(context, paired.info.id) as { selectedStatements: { id: string }[] };
    expect(selected.selectedStatements.some((entry) => entry.id === statement.id)).toBe(true);
    const read = await (await paired.call('tools/call', { name: 'read_statement', arguments: { id: statement.id } })).json() as RpcResponse;
    expect(read.result!.content![0].text).toContain('Membership');
    const invalid = await (await paired.call('tools/call', { name: 'register_statement', arguments: { name: '../secret.csv', encoding: 'utf8', content: 'data' } })).json() as RpcResponse;
    expect(invalid.error).toBeDefined(); expect(new TransactionRepo(db).getAll()).toEqual([]);
  });
  it('requires answers to flagged rows, then adds once with backup and AI attribution', async () => {
    const paired = await pair('chatgpt', { allowAdd: true, allowStatementUploads: false });
    const proposal = bridge.stage(context, paired.info.id, draft);
    const input = { id: proposal.id, digest: proposal.digest, resolutions: [] as { rowIndex: number; answer: string }[] };
    const denied = await (await paired.call('tools/call', { name: 'apply_reconciliation', arguments: input })).json() as RpcResponse;
    expect(denied.error?.message).toContain('Ask the user'); expect(beforeApply).not.toHaveBeenCalled();
    input.resolutions = [{ rowIndex: 0, answer: 'The user confirmed pool hire with no party, category or activity.' }];
    const first = await (await paired.call('tools/call', { name: 'apply_reconciliation', arguments: input })).json() as RpcResponse;
    expect(first.error).toBeUndefined();
    expect(new TransactionRepo(db).getAll()).toHaveLength(1); expect(beforeApply).toHaveBeenCalledTimes(1);
    const retry = await (await paired.call('tools/call', { name: 'apply_reconciliation', arguments: input })).json() as RpcResponse;
    expect(retry.error).toBeUndefined(); expect(new TransactionRepo(db).getAll()).toHaveLength(1); expect(beforeApply).toHaveBeenCalledTimes(1);
    const audit = db.prepare("SELECT details FROM audit_log WHERE entity_type='reconciliation'").pluck().get() as string;
    expect(JSON.parse(audit)).toMatchObject({ origin: 'personal-ai', client: 'chatgpt', resolutions: input.resolutions });
    context.reconciliation.undo(proposal.id, 'User');
    const undone = await (await paired.call('tools/call', { name: 'apply_reconciliation', arguments: input })).json() as RpcResponse;
    expect(undone.error?.message).toContain('user undid'); expect(new TransactionRepo(db).getAll()).toEqual([]);
  });
  it('fails before writing when backup fails or access is revoked during backup', async () => {
    const paired = await pair('chatgpt', { allowAdd: true, allowStatementUploads: false });
    const proposal = bridge.stage(context, paired.info.id, draft);
    const input = { id: proposal.id, digest: proposal.digest, resolutions: [{ rowIndex: 0, answer: 'Confirmed by user' }] };
    beforeApply.mockRejectedValueOnce(new Error('Backup disk is full'));
    const failed = await (await paired.call('tools/call', { name: 'apply_reconciliation', arguments: input })).json() as RpcResponse;
    expect(failed.error?.message).toContain('Backup disk is full');
    beforeApply.mockImplementationOnce(async () => { bridge.revoke(paired.info.id); });
    const revoked = await (await paired.call('tools/call', { name: 'apply_reconciliation', arguments: input })).json() as RpcResponse;
    expect(revoked.error?.message).toContain('connection ended'); expect(new TransactionRepo(db).getAll()).toEqual([]);
  });
  it('rejects source changes between staging and direct application', async () => {
    const paired = await pair('chatgpt', { allowAdd: true, allowStatementUploads: false });
    const proposal = bridge.stage(context, paired.info.id, draft);
    fs.writeFileSync(path.join(directory, 'bank.csv'), 'changed');
    const response = await (await paired.call('tools/call', { name: 'apply_reconciliation', arguments: { id: proposal.id, digest: proposal.digest, resolutions: [{ rowIndex: 0, answer: 'Confirmed by user' }] } })).json() as RpcResponse;
    expect(response.error?.message).toContain('statement changed'); expect(new TransactionRepo(db).getAll()).toEqual([]);
  });
  it('advertises only selected-context, draft and proposal-status tools', async () => {
    const paired = await pair();
    const response = await paired.call('tools/list');
    const rpc = await response.json() as RpcResponse;
    expect(rpc.result!.tools!.map((tool) => tool.name)).toEqual(['read_context', 'read_statement', 'stage_reconciliation', 'get_proposal']);
    if (process.platform !== 'win32') expect(fs.statSync(paired.file).mode & 0o077).toBe(0);
    expect(JSON.stringify(paired.info)).not.toContain('token');
    const result = await (await paired.call('tools/call', { name: 'read_context', arguments: {} })).json() as RpcResponse;
    expect(result.result!.content![0].text).toContain('Current');
    expect(result.result!.content![0].text).not.toContain('Private');
  });
  it('rejects unauthenticated requests, browser origins, extra file arguments and write tools', async () => {
    const paired = await pair();
    expect((await paired.call('tools/list', undefined, { Authorization: 'Bearer invalid' })).status).toBe(401);
    expect((await paired.call('tools/list', undefined, { Origin: 'https://untrusted.example' })).status).toBe(403);
    for (const params of [{ name: 'approve', arguments: draft }, { name: 'read_context', arguments: { path: '/etc/passwd' } }]) {
      const result = await (await paired.call('tools/call', params)).json() as RpcResponse;
      expect(result.error).toBeDefined();
    }
    expect(new TransactionRepo(db).getAll()).toEqual([]);
  });
  it('stages a draft without changing the ledger and isolates proposal access by connection', async () => {
    const a = await pair(); const b = await pair('chatgpt');
    const result = await (await a.call('tools/call', { name: 'stage_reconciliation', arguments: draft })).json() as RpcResponse;
    const proposal = JSON.parse(result.result!.content![0].text) as { id: string };
    expect(new TransactionRepo(db).getAll()).toEqual([]);
    const blocked = await (await b.call('tools/call', { name: 'get_proposal', arguments: { id: proposal.id } })).json() as RpcResponse;
    expect(blocked.error?.message).toContain('another connection');
    const escape = structuredClone(draft); escape.rows[0].sheetId = 'private';
    expect((await (await a.call('tools/call', { name: 'stage_reconciliation', arguments: escape })).json() as RpcResponse).error).toBeDefined();
  });
  it('revokes old credentials on renewal and disconnect, and removes their files', async () => {
    const first = await pair(); const renewed = await pair();
    expect((await first.call('tools/list')).status).toBe(401);
    expect((await renewed.call('tools/list')).status).toBe(200);
    bridge.revoke(renewed.info.id);
    expect(fs.existsSync(renewed.file)).toBe(false);
    expect((await renewed.call('tools/list')).status).toBe(401);
  });
  it('rejects access when a window switches ledger, the connection expires, or reset starts', async () => {
    const paired = await pair();
    current = false; expect((await paired.call('tools/list')).status).toBe(401); current = true;
    preparing = true; expect((await paired.call('tools/list')).status).toBe(401); preparing = false;
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 61 * 60000);
    expect((await paired.call('tools/list')).status).toBe(401);
  });
  it('reads only selected statements and rejects changed files or invented source evidence', async () => {
    const paired = await pair();
    const good = await (await paired.call('tools/call', { name: 'read_statement', arguments: { id: statementId } })).json() as RpcResponse;
    expect(good.result!.content![0].text).toContain('BANK PAYMENT');
    const wrong = structuredClone(draft); wrong.rows[0].source.evidence = 'Invented source evidence';
    expect((await (await paired.call('tools/call', { name: 'stage_reconciliation', arguments: wrong })).json() as RpcResponse).error).toBeDefined();
    fs.writeFileSync(path.join(directory, 'bank.csv'), 'changed source file');
    expect((await (await paired.call('tools/call', { name: 'read_statement', arguments: { id: statementId } })).json() as RpcResponse).error).toBeDefined();
  });
  it('runs the dependency-free stdio adapter against the actual bridge', async () => {
    const paired = await pair();
    const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
      const child = spawn(process.execPath, [path.resolve('resources/ai-bridge/server.cjs'), '--connection-file', paired.file], { stdio: 'pipe' });
      let stdout = ''; let stderr = '';
      const timeout = setTimeout(() => { child.kill(); reject(new Error('stdio adapter timed out')); }, 8000);
      child.stdout.on('data', (part) => { stdout += String(part); }); child.stderr.on('data', (part) => { stderr += String(part); });
      child.once('error', reject); child.once('close', (code) => { clearTimeout(timeout); resolve({ stdout, stderr, code }); });
      child.stdin.end([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_context', arguments: {} } },
      ].map((value) => JSON.stringify(value)).join('\n') + '\n');
    });
    expect(result.code).toBe(0); expect(result.stderr).toBe('');
    const lines = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2); expect(lines[0].result.protocolVersion).toBe('2025-06-18');
    expect(lines[1].result.content[0].text).toContain('Current');
  });
});
