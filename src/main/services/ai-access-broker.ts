import { createServer, type Server } from 'node:http';
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { WindowContext } from '../window/window-context';
import type { AiBridge } from './ai-bridge';
import { AiAuthorizationStore, type AiAuthorization } from './ai-authorization-store';
import { aiAccessPolicySchema, type AiAccessRequest, type AiAccessState } from '../../shared/ai-access-types';
import { reconciliationScopeSchema } from '../../shared/reconciliation-types';
import { hashPassword, verifyPassword } from '../sync/key-wrap';
import { aiLedgerReads, isAiLedgerRead } from './ai-ledger-reads';
import { aiToolCatalog } from './ai-tool-catalog';
import { aiPermittedAccounts } from './ai-operation-access';
import { aiRunSync } from './ai-sync-operations';
import { aiCreateBackup, aiReadBackups } from './ai-backup-operations';

const publicKeySchema = z.string().max(200).refine((value) => {
  try { return createPublicKey({ key: Buffer.from(value, 'base64'), type: 'spki', format: 'der' }).asymmetricKeyType === 'ed25519'; }
  catch { return false; }
}, 'Invalid installation identity.');
const identitySchema = z.object({ publicKey: publicKeySchema, client: z.enum(['chatgpt', 'claude']) }).strict();
const rpcSchema = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.string().max(200), z.number()]), method: z.string().max(100), params: z.record(z.string(), z.unknown()).optional() }).strict();
const signedSchema = identitySchema.extend({ challengeId: z.string().uuid(), signature: z.string().max(200), request: rpcSchema }).strict();
const querySchema = z.object({ from: z.string(), to: z.string(), sheetIds: z.array(z.string()).optional() }).strict();
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const canonical = (file: string) => fs.realpathSync.native(file);
const ledgerKey = (ctx: WindowContext) => `${ctx.databaseId}:${canonical(ctx.dbPath)}`;
interface Pending { info: AiAccessRequest; publicKey: string }
interface BrokerOptions {
  discoveryFile: string; store: AiAuthorizationStore; bridge: AiBridge;
  contexts(): WindowContext[]; preparing(): boolean; changed(): void;
}

/** Native consent is the only path to durable access. Signed requests prove possession of an OS-stored installation key. */
export class AiAccessBroker {
  private server: Server | null = null;
  private serverId = randomUUID();
  private port = 0;
  private paused = false;
  private readonly challenges = new Map<string, { value: string; expires: number }>();
  private readonly pending = new Map<string, Pending>();
  private readonly unlocked = new Map<string, string>();
  private readonly sessions = new Map<string, { context: WindowContext; id: string; query: string }>();
  constructor(private readonly options: BrokerOptions) {}

  ownerStatus(ctx: WindowContext): AiAccessState['owner'] {
    if (ctx.temporaryDirectory || ctx.isClosed) return 'unavailable';
    const person = ctx.localAuthPersonnel && ctx.personnelRepo.getById(ctx.localAuthPersonnel.id);
    if (person?.password_hash && person.role === 'admin') return 'admin';
    if (ctx.isLocalSyncAuthEnabled || ctx.settingsRepo.getSetting('localSync.syncFolder') || ctx.personnelRepo.getAll().some((item) => item.password_hash)) return 'unavailable';
    const owner = this.options.store.read().owners.find((item) => item.databaseId === ctx.databaseId && item.dbPath === canonical(ctx.dbPath));
    if (!owner) return 'setup';
    return this.unlocked.get(ledgerKey(ctx)) === sha(owner.passwordHash) ? 'admin' : 'locked';
  }
  private identity(ctx: WindowContext): { id: string; name: string; hash: string } {
    if (this.paused || this.options.preparing() || this.ownerStatus(ctx) !== 'admin') throw new Error('A Fidra administrator must approve or unlock access to this ledger.');
    const person = ctx.localAuthPersonnel && ctx.personnelRepo.getById(ctx.localAuthPersonnel.id);
    if (person?.password_hash && person.role === 'admin') return { id: person.id, name: person.email, hash: sha(person.password_hash) };
    const owner = this.options.store.read().owners.find((item) => item.databaseId === ctx.databaseId && item.dbPath === canonical(ctx.dbPath));
    if (!owner) throw new Error('Set up the ledger access owner first.');
    return { id: 'device-owner', name: owner.name, hash: sha(owner.passwordHash) };
  }
  unlockOwner(ctx: WindowContext, name: string, password: string): void {
    if (this.paused || this.options.preparing()) throw new Error('Unlock Fidra before continuing.');
    const status = this.ownerStatus(ctx);
    if (status !== 'setup' && status !== 'locked') throw new Error('Use the existing Fidra administrator account for this ledger.');
    const data = this.options.store.read(); const dbPath = canonical(ctx.dbPath);
    let owner = data.owners.find((item) => item.databaseId === ctx.databaseId && item.dbPath === dbPath);
    if (owner) {
      if (!verifyPassword(password, owner.passwordHash)) throw new Error('Incorrect owner password.');
    } else {
      owner = { databaseId: ctx.databaseId, dbPath, name, passwordHash: hashPassword(password) };
      data.owners.push(owner); this.options.store.write(data);
    }
    this.unlocked.set(ledgerKey(ctx), sha(owner.passwordHash)); this.options.changed();
  }
  private allowed(record: AiAuthorization, ctx: WindowContext): boolean {
    try {
      if (ctx.isClosed || ctx.databaseId !== record.databaseId || canonical(ctx.dbPath) !== record.dbPath) return false;
      if (!this.options.store.read().authorizations.some((item) => item.id === record.id && JSON.stringify(item) === JSON.stringify(record))) return false;
      const current = this.identity(ctx);
      return current.id === record.personId && current.hash === record.identityHash;
    } catch { return false; }
  }
  state(ctx: WindowContext): AiAccessState {
    const secureStorageAvailable = this.options.store.available();
    if (!secureStorageAvailable) return { requests: [], authorizations: [], owner: 'unavailable', secureStorageAvailable };
    this.prune(); const owner = this.ownerStatus(ctx);
    const authorizations = owner === 'admin' ? this.options.store.read().authorizations.filter((item) => item.databaseId === ctx.databaseId && item.dbPath === canonical(ctx.dbPath)).map((item) => ({
      id: item.id, client: item.client, approvedAt: item.approvedAt, approvedBy: item.approvedBy, policy: item.policy, active: this.allowed(item, ctx),
    })) : [];
    return { requests: owner === 'admin' ? [...this.pending.values()].map((item) => item.info) : [], authorizations, owner, secureStorageAvailable };
  }
  approve(ctx: WindowContext, requestId: string, raw: unknown): void {
    const actor = this.identity(ctx); this.prune();
    const request = this.pending.get(requestId); if (!request) throw new Error('This connection request expired. Ask the plugin to connect again.');
    const policy = aiAccessPolicySchema.parse(raw);
    const available = ctx.sheetRepo.getAll().filter((sheet) => !sheet.is_virtual && !sheet.is_planned);
    if (policy.sheetIds.some((id) => !available.some((sheet) => sheet.id === id))) throw new Error('Choose accounts that exist in this ledger.');
    const data = this.options.store.read();
    if (data.authorizations.some((item) => item.publicKey === request.publicKey && item.databaseId === ctx.databaseId && item.dbPath === canonical(ctx.dbPath))) throw new Error('This installation already has access. Revoke it before changing permissions.');
    const record: AiAuthorization = { id: randomUUID(), publicKey: request.publicKey, client: request.info.client, databaseId: ctx.databaseId,
      dbPath: canonical(ctx.dbPath), personId: actor.id, identityHash: actor.hash, approvedBy: actor.name, approvedAt: new Date().toISOString(), policy };
    this.audit(ctx, 'create', record.id, `Approved ${record.client} access`, { approvedBy: actor.name, policy, fingerprint: request.info.fingerprint });
    this.options.store.write({ ...data, authorizations: [...data.authorizations, record] });
    this.pending.delete(requestId); this.options.changed();
  }
  deny(ctx: WindowContext, requestId: string): void { this.identity(ctx); this.pending.delete(requestId); this.options.changed(); }
  revoke(ctx: WindowContext, id: string): void {
    const actor = this.identity(ctx); const data = this.options.store.read();
    const record = data.authorizations.find((item) => item.id === id && item.databaseId === ctx.databaseId && item.dbPath === canonical(ctx.dbPath));
    if (!record) throw new Error('This connected app does not belong to this ledger.');
    this.options.store.write({ ...data, authorizations: data.authorizations.filter((item) => item.id !== id) });
    const session = this.sessions.get(id); if (session) this.options.bridge.revoke(session.id);
    this.sessions.delete(id); this.audit(ctx, 'delete', id, `Revoked ${record.client} access`, { revokedBy: actor.name }); this.options.changed();
  }
  private audit(ctx: WindowContext, action: 'create' | 'delete', id: string, summary: string, details: unknown): void {
    ctx.auditRepo.log({ id: randomUUID(), timestamp: new Date().toISOString(), action, entity_type: 'ai_access', entity_id: id, user: this.identity(ctx).name, summary, details: JSON.stringify(details) });
  }
  pause(): void { this.paused = true; this.unlocked.clear(); this.sessions.clear(); this.options.bridge.stop(); this.options.changed(); }
  resume(): void { this.paused = false; this.options.changed(); }
  reset(): void { this.pause(); this.pending.clear(); this.options.store.clear(); }
  private prune(): void {
    const now = Date.now();
    for (const [id, item] of this.challenges) if (item.expires < now) this.challenges.delete(id);
    for (const [id, item] of this.pending) if (Date.parse(item.info.expiresAt) < now) this.pending.delete(id);
  }
  private request(publicKey: string, client: 'chatgpt' | 'claude'): AiAccessRequest {
    this.prune();
    const existing = [...this.pending.values()].find((item) => item.publicKey === publicKey && item.info.client === client);
    if (existing) return existing.info;
    if (this.pending.size >= 8) throw new Error('Too many connection requests. Try again later.');
    const info: AiAccessRequest = { id: randomUUID(), client, fingerprint: sha(publicKey).slice(0, 16), code: randomBytes(3).toString('hex').toUpperCase(), expiresAt: new Date(Date.now() + 300_000).toISOString() };
    this.pending.set(info.id, { info, publicKey }); this.options.changed(); return info;
  }
  private records(publicKey: string, client: string) {
    return this.options.store.read().authorizations.filter((item) => item.publicKey === publicKey && item.client === client);
  }
  private async dispatch(publicKey: string, client: 'chatgpt' | 'claude', request: z.infer<typeof rpcSchema>): Promise<unknown> {
    if (request.method === 'initialize') return { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fidra', version: '2.0.0' }, instructions: 'Use connect_fidra for first-time administrator approval. Call list_connections, then read_context with the user-requested date range before reconciliation. Only access data needed for the request. The installed connection persists; never ask for exports or pairing files.' };
    if (request.method === 'ping') return {};
    if (request.method === 'tools/list') return aiToolCatalog(this.options.bridge);
    if (request.method !== 'tools/call') throw new Error('Unsupported request.');
    const call = z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).optional() }).strict().parse(request.params);
    const args = { ...call.arguments }; const connectionId = z.string().uuid().optional().parse(args.connectionId); delete args.connectionId;
    if (call.name === 'connect_fidra' || call.name === 'list_connections') {
      const options = call.name === 'connect_fidra' ? z.object({ newConnection: z.boolean().optional() }).strict().parse(args) : (z.object({}).strict().parse(args), {});
      const records = this.records(publicKey, client);
      const result = call.name === 'connect_fidra' ? (records.length && !('newConnection' in options && options.newConnection) ? { connected: true, instructions: 'Access is already approved. Use list_connections; paused access resumes when the authorised user returns.' } : { pending: this.request(publicKey, client), instructions: 'Compare this code with the native Fidra permission prompt. Only approve a request you initiated.' })
        : records.map((item) => { const ctx = this.options.contexts().find((candidate) => this.allowed(item, candidate)); return { id: item.id, ledger: ctx ? path.basename(item.dbPath) : 'Approved ledger (paused)', active: !!ctx, accounts: ctx ? aiPermittedAccounts(ctx, { policy: item.policy, isCurrent: () => this.allowed(item, ctx) }).map(({ id, name }) => ({ id, name })) : [], permissions: item.policy.permissions, fields: item.policy.fields }; });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    const records = this.records(publicKey, client);
    const record = connectionId ? records.find((item) => item.id === connectionId) : records.length === 1 ? records[0] : undefined;
    if (!record) throw new Error(records.length ? 'Choose an approved connectionId from list_connections.' : 'Use connect_fidra and obtain administrator approval first.');
    const ctx = this.options.contexts().find((candidate) => this.allowed(record, candidate));
    if (!ctx) throw new Error('Fidra access is paused. Open the approved ledger and sign in as the authorised administrator, or unlock its standalone owner.');
    if (call.name === 'read_backups' || call.name === 'create_backup') {
      const access = { policy: record.policy, isCurrent: () => this.allowed(record, ctx) };
      const result = call.name === 'read_backups' ? aiReadBackups(ctx, access, args) : await aiCreateBackup(ctx, access, record.id, args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    if (call.name === 'run_sync') {
      const result = aiRunSync(ctx, { policy: record.policy, isCurrent: () => this.allowed(record, ctx) }, args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    if (isAiLedgerRead(call.name)) {
      const result = aiLedgerReads[call.name](ctx, { policy: record.policy, isCurrent: () => this.allowed(record, ctx) }, args);
      const text = JSON.stringify(result);
      if (Buffer.byteLength(text) > 4_000_000) throw new Error('Request a smaller page or date range.');
      return { content: [{ type: 'text', text }] };
    }
    let session = this.sessions.get(record.id);
    if (call.name === 'read_context') {
      const query = querySchema.parse(args);
      const permitted = aiPermittedAccounts(ctx, { policy: record.policy, isCurrent: () => this.allowed(record, ctx) }).map((sheet) => sheet.id);
      const sheetIds = query.sheetIds ?? permitted;
      if (sheetIds.some((id) => !permitted.includes(id))) throw new Error('That account is outside the approved permission.');
      const scope = reconciliationScopeSchema.parse({ from: query.from, to: query.to, sheetIds, fields: record.policy.fields });
      const key = JSON.stringify(scope);
      if (session && (session.context !== ctx || session.query !== key)) { this.options.bridge.revoke(session.id); session = undefined; }
      if (session) { try { this.options.bridge.requireConnection(ctx, session.id); } catch { session = undefined; } }
      if (!session) {
        const grant = await this.options.bridge.connect(ctx, client, scope, record.policy.permissions, () => this.allowed(record, ctx));
        session = { context: ctx, id: grant.id, query: key }; this.sessions.set(record.id, session);
      }
      return this.options.bridge.invoke(ctx, session.id, 'tools/call', { name: call.name, arguments: {} });
    }
    if (!session || session.context !== ctx) throw new Error('Read the user-requested context range before reconciling.');
    return this.options.bridge.invoke(ctx, session.id, request.method, { name: call.name, arguments: args });
  }
  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      if (req.method !== 'POST' || !['/challenge', '/rpc'].includes(req.url ?? '') || req.headers.origin || req.headers.host !== `127.0.0.1:${this.port}`) { res.writeHead(403).end(); return; }
      try {
        let size = 0; const chunks: Buffer[] = [];
        for await (const part of req) { const chunk = Buffer.from(part); size += chunk.length; if (size > 2_000_000) { res.writeHead(413).end(); req.destroy(); return; } chunks.push(chunk); }
        const raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); this.prune();
        let result: unknown;
        if (req.url === '/challenge') {
          identitySchema.parse(raw);
          if (this.challenges.size >= 64) throw new Error('Too many pending requests. Try again shortly.');
          const id = randomUUID(); const value = randomBytes(32).toString('hex');
          this.challenges.set(id, { value, expires: Date.now() + 30_000 }); result = { serverId: this.serverId, id, value };
        } else {
          const signed = signedSchema.parse(raw); const challenge = this.challenges.get(signed.challengeId); this.challenges.delete(signed.challengeId);
          if (!challenge || challenge.expires < Date.now()) throw new Error('Request proof expired. Retry.');
          const message = JSON.stringify([this.serverId, signed.challengeId, challenge.value, signed.client, signed.request]);
          if (!verify(null, Buffer.from(message), createPublicKey({ key: Buffer.from(signed.publicKey, 'base64'), type: 'spki', format: 'der' }), Buffer.from(signed.signature, 'base64'))) throw new Error('Invalid installation proof.');
          try { result = { jsonrpc: '2.0', id: signed.request.id, result: await this.dispatch(signed.publicKey, signed.client, signed.request) }; }
          catch (error) { result = { jsonrpc: '2.0', id: signed.request.id, error: { code: -32603, message: error instanceof z.ZodError ? 'Invalid tool arguments.' : error instanceof Error ? error.message : 'Access failed.' } }; }
        }
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
      } catch { res.writeHead(400).end('Invalid request or installation proof.'); }
    });
    server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.maxConnections = 10;
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
    const address = server.address(); if (!address || typeof address === 'string') { server.close(); throw new Error('Could not start the local app connection.'); }
    this.server = server; this.port = address.port;
    const dir = path.dirname(this.options.discoveryFile); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(dir).isSymbolicLink()) { this.stop(); throw new Error('The app discovery directory must not be a link.'); }
    const temporary = `${this.options.discoveryFile}.${this.serverId}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ url: `http://127.0.0.1:${this.port}`, serverId: this.serverId }), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, this.options.discoveryFile);
  }
  stop(): void {
    this.pause(); this.server?.closeAllConnections(); this.server?.close(); this.server = null;
    this.challenges.clear(); this.pending.clear();
    try { if (JSON.parse(fs.readFileSync(this.options.discoveryFile, 'utf8')).serverId === this.serverId) fs.rmSync(this.options.discoveryFile); } catch { /* already absent */ }
  }
}
