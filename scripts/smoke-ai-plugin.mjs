import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import JSZip from 'jszip';

const archive = process.argv[2] ?? path.resolve('out', 'ai-plugin', `${process.platform}-${process.arch}`, 'Fidra-plugin.zip');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-plugin-smoke-'));
try {
  const zip = await JSZip.loadAsync(fs.readFileSync(archive));
  for (const item of Object.values(zip.files)) {
    if (item.dir) continue;
    const file = path.resolve(root, item.name);
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid archive path.');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, await item.async('nodebuffer'), { mode: Number(item.unixPermissions ?? 0o600) & 0o777 });
  }
  assert(fs.readFileSync(path.join(root, 'runtime/LICENSE'), 'utf8').includes('Permission'));
  assert(fs.existsSync(path.join(root, 'LICENSE')));
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'BUILD.json'), 'utf8'));
  assert.equal(metadata.platform, process.platform); assert.equal(metadata.arch, process.arch);
  const runtime = path.join(root, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(runtime)).digest('hex'), metadata.runtimeSha256);
  const requests = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }];
  const output = execFileSync(runtime, [path.join(root, 'server/server.cjs')], { input: requests.map((item) => JSON.stringify(item)).join('\n') + '\n', encoding: 'utf8', timeout: 20_000 });
  const responses = output.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(responses.length, 2); assert.equal(responses[0].result.serverInfo.version, '2.0.0');
  const names = responses[1].result.tools.map((tool) => tool.name);
  assert(names.includes('connect_fidra') && names.includes('read_context') && names.includes('apply_reconciliation'));
  console.log(`Packaged ${process.platform}/${process.arch} runtime, native binding, initialization and offline tools passed. No credential read/write or financial tool was requested.`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
