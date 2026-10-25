#!/usr/bin/env node
'use strict';
/* eslint-disable @typescript-eslint/no-var-requires */
// Deliberately dependency-free: Claude supplies the Node runtime. This adapter
// reads only a pairing file and forwards MCP to the running, unlocked Fidra app.
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const pairingIndex = args.indexOf('--connection-file');
const pairingFile = pairingIndex >= 0 ? args[pairingIndex + 1] : undefined;
let buffer = '';
let chain = Promise.resolve();

function connection() {
  if (!pairingFile || !path.isAbsolute(pairingFile)) throw new Error('Connect this AI from Fidra Settings first.');
  const details = fs.lstatSync(pairingFile);
  if (!details.isFile() || details.isSymbolicLink() || details.size > 4096) throw new Error('The Fidra connection file is invalid. Reconnect from Fidra Settings.');
  if (process.platform !== 'win32' && (details.mode & 0o077)) throw new Error('The Fidra connection file must be private. Reconnect from Fidra Settings.');
  const value = JSON.parse(fs.readFileSync(pairingFile, 'utf8'));
  if (typeof value.url !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+\/bridge$/.test(value.url)
    || typeof value.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token) || !(Date.parse(value.expiresAt) > Date.now())) {
    throw new Error('This Fidra connection has expired or is invalid. Reconnect from Fidra Settings.');
  }
  return value;
}

async function dispatch(line) {
  let request;
  try {
    request = JSON.parse(line);
    if (!request || typeof request.method !== 'string') throw new Error('Invalid MCP request.');
    // No response is sent for client notifications, including initialized/cancel.
    if (request.id === undefined) return;
    const paired = connection();
    const response = await fetch(paired.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${paired.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    if (!response.ok) throw new Error(response.status === 401 ? 'Fidra is locked, disconnected or preparing to close. Reconnect in Fidra Settings.' : 'Fidra could not process this request. Keep it open and retry.');
    const raw = await response.text();
    if (raw.length > 8_000_000) throw new Error('Select a smaller context range in Fidra.');
    const result = JSON.parse(raw);
    if (result.jsonrpc !== '2.0' || result.id !== request.id) throw new Error('Invalid Fidra response.');
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    if (request && request.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id,
      error: { code: -32603, message: error && error.code === 'ENOENT' ? 'Open Fidra and connect your AI from Settings.' : error instanceof Error ? error.message : 'The Fidra connection failed.' } }) + '\n');
    else process.stderr.write('Fidra received an invalid MCP message.\n');
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (part) => {
  buffer += part;
  if (buffer.length > 2_000_000) { process.stderr.write('MCP input is too large.\n'); process.exit(1); }
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
    if (line) chain = chain.then(() => dispatch(line));
  }
});
process.stdin.on('end', () => { if (buffer.trim()) chain = chain.then(() => dispatch(buffer)); });
