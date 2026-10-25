import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, generateKeyPairSync, sign } from 'node:crypto';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../database/connection';
import { SettingsRepo } from '../../database/settings-repo';
import { SheetRepo } from '../../repositories/sheet-repo';
import { PersonnelRepo } from '../../repositories/personnel-repo';
import { AuditRepo } from '../../repositories/audit-repo';
import { AiAuthorizationStore } from '../ai-authorization-store';
import { AiAccessBroker } from '../ai-access-broker';
import { AiBridge } from '../ai-bridge';
import { ReconciliationService } from '../reconciliation';
import type { WindowContext } from '../../window/window-context';
const { createAdapter } = require('../../../../resources/ai-bridge/server.cjs');
let root: string; let db: Database.Database; let ctx: WindowContext; let store: AiAuthorizationStore; let broker: AiAccessBroker; let bridge: AiBridge; let available: boolean;
const policy = { sheetIds: ['main'], fields: ['description'] as ['description'], permissions: { allowAdd: true, allowStatementUploads: true } };
const password = 'synthetic-owner-password';
function makeBroker() {
  bridge = new AiBridge({ isCurrent: (candidate) => candidate === ctx, isPreparing: () => false, onChanged: () => undefined, beforeApply: async () => undefined });
  return new AiAccessBroker({ discoveryFile: path.join(root, 'endpoint.json'), store, bridge, contexts: () => [ctx], preparing: () => false, changed: () => undefined });
}
function adapter() {
  let secret: string | null = null;
  return createAdapter({ client: 'chatgpt', discoveryFile: path.join(root, 'endpoint.json'), credential: { getPassword: async () => secret, setPassword: async (value: string) => { secret = value; } } });
}
let client: ReturnType<typeof adapter>;
async function call(name: string, args = {}, selected = client) { return selected.call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }); }
function data(result: { result: { content: { text: string }[] } }) { return JSON.parse(result.result.content[0].text); }
async function approve() {
  const requested = data(await call('connect_fidra'));
  broker.approve(ctx, requested.pending.id, policy); return broker.state(ctx).authorizations[0];
}
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-access-')); db = openDatabase(path.join(root, 'ledger.fdra')).db;
  const sheets = new SheetRepo(db); sheets.create('main', 'Main'); sheets.create('private', 'Private');
  ctx = { dbPath: path.join(root, 'ledger.fdra'), databaseId: 'test-ledger-id', isClosed: false, isLocalSyncAuthEnabled: false, localAuthPersonnel: null, sheetRepo: sheets, settingsRepo: new SettingsRepo(db), personnelRepo: new PersonnelRepo(db), auditRepo: new AuditRepo(db), reconciliation: new ReconciliationService(db) } as unknown as WindowContext;
  const key = randomBytes(32); available = true;
  store = new AiAuthorizationStore(path.join(root, 'authorizations.enc'), { available: () => available, encrypt: (value) => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const bytes = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); }, decrypt: (value) => { const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString(); } });
  broker = makeBroker(); broker.unlockOwner(ctx, 'Trial owner', password); await broker.start(); client = adapter();
});
afterEach(() => { vi.useRealTimers(); broker.stop(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
describe('persistent administrator approval', () => {
  it('reveals no ledger data before native approval and requires selected accounts', async () => {
    expect(data(await call('list_connections'))).toEqual([]);
    expect((await call('read_context', { from: '2026-10-01', to: '2026-10-31' })).error).toBeDefined();
    const pending = data(await call('connect_fidra')).pending;
    expect(pending.code).toBe(broker.state(ctx).requests[0].code);
    expect(() => broker.approve(ctx, pending.id, { ...policy, sheetIds: [] })).toThrow();
    await approve();
    const result = data(await call('read_context', { from: '2026-10-01', to: '2026-10-31' }));
    expect(result.accounts).toEqual([{ id: 'main', name: 'Main' }]); expect(JSON.stringify(result)).not.toContain('Private');
  });
  it('survives broker restart, renews task sessions and never repeats approval', async () => {
    const grant = await approve(); const encrypted = fs.readFileSync(path.join(root, 'authorizations.enc'));
    expect(encrypted.toString()).not.toContain('Trial owner'); expect(encrypted.toString()).not.toContain('publicKey');
    broker.stop(); broker = makeBroker(); await broker.start();
    expect(data(await call('list_connections'))[0]).toMatchObject({ id: grant.id, active: false });
    broker.unlockOwner(ctx, 'Trial owner', password);
    expect(data(await call('connect_fidra'))).toMatchObject({ connected: true });
    expect(data(await call('read_context', { from: '2026-10-01', to: '2026-10-31' })).accounts).toHaveLength(1);
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 16 * 60_000);
    expect(data(await call('read_context', { from: '2026-10-01', to: '2026-10-31' })).accounts).toHaveLength(1);
    expect(broker.state(ctx).authorizations).toHaveLength(1); expect(broker.state(ctx).requests).toHaveLength(0);
  });
  it('requests additional consent without silently changing an existing permission', async () => {
    const approved = await approve();
    const pending = data(await call('connect_fidra', { newConnection: true })).pending;
    expect(pending.id).toBeDefined();
    expect(broker.state(ctx).authorizations[0].id).toBe(approved.id);
    expect(() => broker.approve(ctx, pending.id, { ...policy, sheetIds: ['private'] })).toThrow('Revoke');
    expect(data(await call('read_context', { from: '2026-10-01', to: '2026-10-31' })).accounts).toEqual([{ id: 'main', name: 'Main' }]);
  });
  it('pauses on lock, resumes after owner unlock, and revokes persistently', async () => {
    const grant = await approve(); broker.pause();
    expect((await call('read_context', { from: '2026-10-01', to: '2026-10-31' })).error).toBeDefined();
    broker.resume(); expect(broker.state(ctx).owner).toBe('locked');
    expect(() => broker.unlockOwner(ctx, 'Trial owner', 'wrong-password')).toThrow('Incorrect');
    broker.unlockOwner(ctx, 'Trial owner', password); broker.revoke(ctx, grant.id);
    expect(data(await call('list_connections'))).toEqual([]);
    expect((await call('read_context', { from: '2026-10-01', to: '2026-10-31' })).error).toBeDefined();
  });
  it('never enrols a standalone owner for an uninitialised team ledger', () => {
    ctx.settingsRepo.setSetting('localSync.syncFolder', '/synthetic-team');
    expect(broker.state(ctx).owner).toBe('unavailable');
    expect(() => broker.unlockOwner(ctx, 'Another owner', password)).toThrow('administrator');
  });
  it('rejects non-admin approval and stale signed-in admin roles', async () => {
    const pending = data(await call('connect_fidra')).pending;
    const person = ctx.personnelRepo.save({ id: 'member', name: 'Member', email: 'member@example.test', role: 'member', auth_uid: null, invited_by: null, password_hash: 'fake-hash', encrypted_passphrase: null, passphrase_salt: null });
    ctx.localAuthPersonnel = person;
    expect(() => broker.approve(ctx, pending.id, policy)).toThrow('administrator');
    ctx.localAuthPersonnel = { ...person, role: 'admin' };
    expect(() => broker.approve(ctx, pending.id, policy)).toThrow('administrator');
  });
  it('checks current roles on every call and isolates identities and ledgers', async () => {
    const person = ctx.personnelRepo.save({ id: 'admin', name: 'Admin', email: 'admin@example.test', role: 'admin', auth_uid: null, invited_by: null, password_hash: 'fake-hash', encrypted_passphrase: null, passphrase_salt: null });
    ctx.localAuthPersonnel = person; await approve();
    expect((await call('read_context', { from: '2026-10-01', to: '2026-10-31', sheetIds: ['private'] })).error).toBeDefined();
    expect(data(await call('list_connections', {}, adapter()))).toEqual([]);
    ctx.personnelRepo.save({ ...person, role: 'member' });
    expect((await call('read_context', { from: '2026-10-01', to: '2026-10-31' })).error).toBeDefined();
    ctx.personnelRepo.save(person); Object.defineProperty(ctx, 'databaseId', { value: 'different-ledger', configurable: true });
    expect((await call('read_context', { from: '2026-10-01', to: '2026-10-31' })).error).toBeDefined();
  });
  it('denies browser origins and unsigned/replayed challenges', async () => {
    const endpoint = JSON.parse(fs.readFileSync(path.join(root, 'endpoint.json'), 'utf8'));
    const pair = generateKeyPairSync('ed25519'); const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const post = (route: string, value: unknown, headers = {}) => fetch(endpoint.url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
    expect((await post('/challenge', { publicKey, client: 'chatgpt' }, { Origin: 'https://evil.test' })).status).toBe(403);
    const challenge = await (await post('/challenge', { publicKey, client: 'chatgpt' })).json();
    const request = { jsonrpc: '2.0', id: 1, method: 'ping' }; const proof = sign(null, Buffer.from(JSON.stringify([challenge.serverId, challenge.id, challenge.value, 'chatgpt', request])), pair.privateKey).toString('base64');
    const envelope = { publicKey, client: 'chatgpt', challengeId: challenge.id, signature: proof, request };
    expect((await post('/rpc', envelope)).status).toBe(200);
    expect((await post('/rpc', envelope)).status).toBe(400);
  });
  it('fails closed with unavailable or corrupted secure storage and clears approval on reset', async () => {
    await approve(); available = false;
    expect((await call('read_context', { from: '2026-10-01', to: '2026-10-31' })).error).toBeDefined();
    available = true; fs.writeFileSync(path.join(root, 'authorizations.enc'), 'corrupted');
    expect(() => broker.unlockOwner(ctx, 'Trial owner', password)).toThrow();
    broker.reset(); expect(fs.existsSync(path.join(root, 'authorizations.enc'))).toBe(false);
  });
});
