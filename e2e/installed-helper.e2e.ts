import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, assertSandboxed } from './fixtures';
import { packagedFidraClient, toolData } from './helpers/packaged-fidra-client';

const executable = process.env.FIDRA_E2E_PACKAGED_EXECUTABLE;
const pluginRoot = process.env.FIDRA_E2E_PLUGIN_ROOT;
test.skip(!executable || !pluginRoot, 'Set the packaged executable and plugin root for installed-startup acceptance.');

test('installed Fidra refreshes the recognised helper automatically at startup', async ({ userHome }) => {
  if (!executable || !pluginRoot) throw new Error('Missing packaged candidates');
  assertSandboxed(userHome);
  const root = path.join(userHome, '.fidra/ai-plugin/2.0.4');
  fs.cpSync(pluginRoot, root, { recursive: true });
  fs.copyFileSync(path.resolve('src/main/services/__tests__/fixtures/fidra-helper-2.0.4.cjs'), path.join(root, 'server/server.cjs'));
  const runtime = path.join(root, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
  const beforeRuntime = fs.statSync(runtime).mtimeMs;
  // Release fuses disable Node inspection; launch the real executable without
  // weakening them for Playwright's debugger. Observe the public helper interface.
  const app = spawn(executable, [`--user-data-dir=${path.join(userHome, 'userData')}`, ...(process.platform === 'darwin' ? ['--use-mock-keychain'] : [])], {
    env: { ...process.env, HOME: userHome, USERPROFILE: userHome, FIDRA_E2E: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  app.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  app.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  let spawnError: Error | undefined;
  app.on('error', (error) => { spawnError = error; });
  try {
    await expect.poll(() => { if (spawnError) throw spawnError; if (app.exitCode !== null || app.signalCode !== null) throw new Error(`Packaged startup exited: ${app.exitCode}/${app.signalCode} ${output}`); return fs.existsSync(path.join(root, 'current.json')); }).toBe(true);
    await expect.poll(() => fs.existsSync(path.join(userHome, '.fidra/ai-access/endpoint.json'))).toBe(true);
    expect(app.exitCode).toBeNull();
    expect(fs.statSync(runtime).mtimeMs).toBe(beforeRuntime);
    expect(fs.readFileSync(path.join(root, 'server/server.cjs'), 'utf8')).toContain('Stable entry point');
    const client = packagedFidraClient(root, userHome);
    try {
      expect((await client.request('tools/list')).result?.tools).toHaveLength(19);
      const connections = await client.call('list_connections');
      // A fresh isolated home may have no unlocked OS encryption store. Native
      // denial is expected; do not weaken packaged safeStorage to bypass it.
      if (connections.error) expect(connections.error.message).toContain('credential store');
      else expect(toolData(connections)).toEqual([]);
    } finally { await client.close(); }
    expect(fs.existsSync(path.join(userHome, '.codex/config.toml'))).toBe(false);
  } catch (error) {
    await test.info().attach('packaged-startup.log', { body: output, contentType: 'text/plain' });
    throw error;
  } finally {
    if (app.exitCode === null && app.signalCode === null && app.pid) {
      const exited = new Promise<void>((resolve) => app.once('exit', () => resolve()));
      app.kill();
      const timer = setTimeout(() => app.kill('SIGKILL'), 3_000);
      try { await exited; } finally { clearTimeout(timer); }
    }
  }
});
