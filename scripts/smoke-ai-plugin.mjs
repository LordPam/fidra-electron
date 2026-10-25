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
  const portableManifest = JSON.parse(await zip.file('plugin.json').async('string'));
  assert(portableManifest.extensions['com.openai'].interface.shortDescription.length <= 30);
  const accountZip = await JSZip.loadAsync(fs.readFileSync(path.join(path.dirname(path.resolve(archive)), 'Fidra-account.zip')));
  assert(!accountZip.file('plugin.json') && !accountZip.file('mcp.json'));
  const accountManifest = JSON.parse(await accountZip.file('.codex-plugin/plugin.json').async('string'));
  assert.equal(accountManifest.name, portableManifest.name);
  assert.equal(accountManifest.version, portableManifest.version);
  assert.equal(accountManifest.mcpServers, './.mcp.json');
  assert.equal(accountManifest.skills, './skills');
  const accountMcp = JSON.parse(await accountZip.file('.mcp.json').async('string'));
  const portableMcp = JSON.parse(await zip.file('mcp.json').async('string'));
  const { type, ...portableLaunch } = portableMcp.mcpServers.fidra;
  assert.equal(type, 'stdio');
  assert.deepEqual(accountMcp.mcpServers, { fidra: portableLaunch });
  for (const file of Object.values(zip.files)) {
    if (!file.dir && !['plugin.json', 'mcp.json'].includes(file.name)) {
      assert.deepEqual(await accountZip.file(file.name).async('nodebuffer'), await file.async('nodebuffer'));
    }
  }
  const privateArchive = path.join(path.dirname(path.resolve(archive)), 'Fidra-private.zip');
  const privateZip = await JSZip.loadAsync(fs.readFileSync(privateArchive));
  const marketplace = JSON.parse(await privateZip.file('Fidra/.agents/plugins/marketplace.json').async('string'));
  assert.equal(marketplace.name, 'fidra-desktop');
  assert.equal(marketplace.plugins[0].source.path, './');
  assert.equal(marketplace.plugins[0].name, 'fidra');
  assert(privateZip.file('Fidra/plugin.json') && privateZip.file('Fidra/INSTALL.md'));
  if (process.platform === 'darwin') assert(Number(privateZip.file('Fidra/Add Fidra source.command').unixPermissions) & 0o111);
  assert((await privateZip.file('Fidra/server/server.cjs').async('string')).includes('createAdapter'));
  if (process.platform === 'darwin') {
    // Exercise registration quoting without touching the host's real settings.
    const source = path.join(root, 'private source with spaces');
    const fakeBin = path.join(root, 'fake-bin'); const calls = path.join(root, 'registration-args.txt');
    fs.mkdirSync(source); fs.mkdirSync(fakeBin);
    const launcher = path.join(source, 'Add Fidra source.command');
    fs.writeFileSync(launcher, await privateZip.file('Fidra/Add Fidra source.command').async('nodebuffer'));
    fs.writeFileSync(path.join(fakeBin, 'codex'), '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$FIDRA_SOURCE_TEST_LOG"\n', { mode: 0o755 });
    execFileSync('/bin/zsh', [launcher], { input: '\n', encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, PATH: `${fakeBin}:/usr/bin:/bin`, FIDRA_SOURCE_TEST_LOG: calls } });
    assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n'), ['plugin', 'marketplace', 'add', source]);
  }
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
