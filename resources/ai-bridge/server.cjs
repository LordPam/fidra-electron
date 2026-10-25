#!/usr/bin/env node
'use strict';
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function createAdapter({ client, credential, discoveryFile }) {
  let identity;
  async function key() {
    if (identity) return identity;
    let saved = await credential.getPassword();
    if (!saved) {
      saved = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      await credential.setPassword(saved);
      if (await credential.getPassword() !== saved) throw new Error('The operating system could not save the plugin identity securely.');
    }
    const privateKey = crypto.createPrivateKey(saved);
    identity = { privateKey, publicKey: crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64') };
    return identity;
  }
  async function call(request) {
    const stat = fs.lstatSync(discoveryFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error('Open Fidra to connect.');
    const endpoint = JSON.parse(fs.readFileSync(discoveryFile, 'utf8'));
    if (typeof endpoint.url !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint.url)) throw new Error('Open Fidra to restore its local connection.');
    const selected = await key();
    async function post(route, value) {
      const response = await fetch(endpoint.url + route, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
      if (!response.ok) throw new Error('Fidra could not verify this connection. Keep Fidra open and retry.');
      const text = await response.text(); if (text.length > 8_000_000) throw new Error('Request a smaller context range.');
      return JSON.parse(text);
    }
    const challenge = await post('/challenge', { publicKey: selected.publicKey, client });
    if (challenge.serverId !== endpoint.serverId) throw new Error('Fidra restarted. Retry the request.');
    const message = JSON.stringify([challenge.serverId, challenge.id, challenge.value, client, request]);
    return post('/rpc', { publicKey: selected.publicKey, client, challengeId: challenge.id, signature: crypto.sign(null, Buffer.from(message), selected.privateKey).toString('base64'), request });
  }
  return { call };
}

async function main() {
  const client = process.argv.includes('--claude') ? 'claude' : 'chatgpt';
  const { AsyncEntry } = require('@napi-rs/keyring');
  const adapter = createAdapter({ client, credential: new AsyncEntry('Fidra AI plugin', `${client}-installation-v2`), discoveryFile: path.join(os.homedir(), '.fidra', 'ai-access', 'endpoint.json') });
  let buffer = ''; let chain = Promise.resolve();
  async function dispatch(line) {
    let request;
    try {
      request = JSON.parse(line);
      if (!request || typeof request.method !== 'string') throw new Error('Invalid MCP request.');
      if (request.id === undefined) return;
      const result = request.method === 'initialize'
        ? { jsonrpc: '2.0', id: request.id, result: { protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18'].includes(request.params?.protocolVersion) ? request.params.protocolVersion : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fidra', version: '2.0.0' }, instructions: fs.readFileSync(path.join(__dirname, '..', 'skills', 'fidra-reconcile', 'SKILL.md'), 'utf8') } }
        : request.method === 'tools/list'
          ? { jsonrpc: '2.0', id: request.id, result: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tools.json'), 'utf8')) }
          : await adapter.call(request);
      process.stdout.write(JSON.stringify(result) + '\n');
    } catch (error) {
      if (request?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: error?.code === 'ENOENT' ? 'Open Fidra, then retry. The installed plugin and approved permissions remain in place.' : error instanceof Error ? error.message : 'The Fidra connection failed.' } }) + '\n');
    }
  }
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (part) => {
    buffer += part;
    if (buffer.length > 2_000_000) { process.stderr.write('MCP input is too large.\n'); process.exit(1); }
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1); if (line) chain = chain.then(() => dispatch(line)); }
  });
  process.stdin.on('end', () => { if (buffer.trim()) chain = chain.then(() => dispatch(buffer)); });
}
module.exports = { createAdapter };
if (require.main === module) main().catch(() => { process.stderr.write('Fidra could not open the operating system credential store. No plaintext fallback is used.\n'); process.exitCode = 1; });
