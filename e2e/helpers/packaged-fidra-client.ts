import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { assertSandboxed } from '../fixtures';

interface RpcReply {
  id: number;
  result?: { content?: { type: string; text: string }[]; tools?: { name: string }[]; instructions?: string };
  error?: { code: number; message: string };
}

/** Actual packaged runtime + unchanged adapter. Only the OS credential boundary
 * is replaced, so acceptance tests never request the developer's Keychain. */
export function packagedFidraClient(pluginRoot: string, userHome: string) {
  assertSandboxed(userHome);
  const runtime = path.join(pluginRoot, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
  const server = path.join(pluginRoot, 'server', 'server.cjs');
  if (!fs.existsSync(runtime) || !fs.existsSync(server)) throw new Error('Build a plugin first and set FIDRA_E2E_PLUGIN_ROOT to its extracted root.');
  const preload = path.join(userHome, 'synthetic-keyring.cjs');
  fs.writeFileSync(preload, `
    const Module = require('node:module');
    const load = Module._load;
    const fs = require('node:fs');
    const credentialFile = require('node:path').join(require('node:os').homedir(), 'synthetic-test-identity.pem');
    Module._load = function (name, ...args) {
      if (name === '@napi-rs/keyring') return { AsyncEntry: class {
        async getPassword() { return fs.existsSync(credentialFile) ? fs.readFileSync(credentialFile, 'utf8') : null; }
        async setPassword(value) { fs.writeFileSync(credentialFile, value, { mode: 0o600 }); }
      } };
      return load.call(this, name, ...args);
    };
  `);
  const child = spawn(runtime, ['--require', preload, server], {
    env: { ...process.env, HOME: userHome, USERPROFILE: userHome, FIDRA_E2E: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map<number, { resolve: (reply: RpcReply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let nextId = 0;
  function fail(error: Error) {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  }
  child.on('error', fail);
  child.on('exit', (code) => fail(new Error(`Packaged Fidra test client exited (${code}).`)));
  lines.on('line', (line) => {
    try {
      const reply = JSON.parse(line) as RpcReply;
      const item = pending.get(reply.id);
      if (!item) return;
      pending.delete(reply.id); clearTimeout(item.timer); item.resolve(reply);
    } catch { fail(new Error('The packaged adapter returned invalid JSON.')); }
  });
  return {
    request(method: string, params?: unknown): Promise<RpcReply> {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Packaged Fidra tool timed out.')); }, 25_000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }) + '\n');
      });
    },
    call(name: string, args: unknown = {}) {
      return this.request('tools/call', { name, arguments: args, _meta: { 'openai/session': 'synthetic-packaged-e2e' } });
    },
    async close() {
      lines.close(); fail(new Error('Test client closed.'));
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        child.kill(); await exited;
      }
    },
  };
}

export function toolData(reply: RpcReply) {
  if (reply.error) throw new Error(reply.error.message);
  const text = reply.result?.content?.find((item) => item.type === 'text')?.text;
  if (!text) throw new Error('Expected a Fidra JSON tool result.');
  return JSON.parse(text);
}
