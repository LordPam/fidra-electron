// Runs only on disposable GitHub runners. Never installs over a developer's app.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const asar = require('@electron/asar');
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true') throw Error('Installer smoke checks require a disposable GitHub Actions runner.');
const [previous, candidate, manifestPath, pluginRoot] = process.argv.slice(2).map((value) => path.resolve(value));
if (![previous, candidate, manifestPath, pluginRoot].every(fs.existsSync)) throw Error('Provide previous/candidate installers, signed manifest and extracted plugin root.');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}
const { signature, ...manifest } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert(crypto.verify(null, Buffer.from(canonical(manifest)), fs.readFileSync('resources/update-public-key.pem'), Buffer.from(signature, 'base64')));
assert.equal(manifest.version, pkg.version); assert.equal(manifest.platform, process.platform); assert.equal(manifest.arch, process.arch);
assert.equal(fs.statSync(candidate).size, manifest.artifact.size);
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(candidate)).digest('hex'), manifest.artifact.sha256);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-installer-upgrade-'));
const home = path.join(root, 'home'); fs.mkdirSync(home);
const env = { ...process.env, HOME: home, USERPROFILE: home, FIDRA_E2E: '1' };
for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'FIDRA_UPDATE_PRIVATE_KEY_PATH']) delete env[name];
const fidra = path.join(home, '.fidra'); fs.mkdirSync(path.join(fidra, 'accounts'), { recursive: true });
const ledger = path.join(fidra, 'accounts', 'preserved.fdra');
// A valid SQLite retention probe; it is deliberately not selected as the startup
// ledger. App-domain migration and open-ledger behaviour have separate E2E checks.
let db = new Database(ledger); db.exec("CREATE TABLE retention_probe (id TEXT PRIMARY KEY, amount TEXT); INSERT INTO retention_probe VALUES ('keep-me', '12.34')"); db.close();
const attachment = path.join(fidra, 'attachments', 'retention-probe', 'receipt.txt'); fs.mkdirSync(path.dirname(attachment), { recursive: true }); fs.writeFileSync(attachment, 'Preserve this synthetic attachment');
const helper = path.join(fidra, 'ai-plugin/2.0.4'); fs.cpSync(pluginRoot, helper, { recursive: true });
fs.copyFileSync('src/main/services/__tests__/fixtures/fidra-helper-2.0.4.cjs', path.join(helper, 'server/server.cjs'));
const helperBefore = fs.readFileSync(path.join(helper, 'server/server.cjs'));
const windowsBases = process.platform === 'win32' ? [...new Set([process.env.LOCALAPPDATA, path.join(home, 'AppData/Local')].filter(Boolean))] : [];
const windowsNames = ['fidra_web', 'fidra-web', 'Fidra'];
let installed;
if (process.platform === 'win32') {
  for (const base of windowsBases) for (const name of windowsNames) assert(!fs.existsSync(path.join(base, name)), 'Refuse an existing runner installation');
} else if (process.platform === 'darwin') installed = path.join(root, 'Fidra.app');
else throw Error('Unsupported installer platform');
async function install(file) {
  if (process.platform === 'win32') {
    execFileSync(file, ['--silent'], { env, timeout: 180_000, stdio: 'pipe' });
    await delay(1_500);
    // Squirrel may launch the app after installing. Only this disposable runner
    // can reach here; stop that process before inspecting/replacing the package.
    try { execFileSync('taskkill', ['/IM', 'Fidra.exe', '/T', '/F'], { stdio: 'ignore' }); } catch { /* no auto-started app */ }
    await delay(500);
  } else {
    const mount = path.join(root, crypto.randomUUID()); fs.mkdirSync(mount);
    execFileSync('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, file], { stdio: 'pipe', timeout: 60_000 });
    try {
      const app = fs.readdirSync(mount).find((name) => name.endsWith('.app')); assert(app, 'DMG has no app');
      fs.rmSync(installed, { recursive: true, force: true });
      execFileSync('ditto', [path.join(mount, app), installed], { stdio: 'pipe', timeout: 60_000 });
    } finally { execFileSync('hdiutil', ['detach', mount], { stdio: 'pipe', timeout: 30_000 }); }
  }
}
function registeredWindowsInstallRoot() {
  try {
    const output = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\fidra_web', '/v', 'InstallLocation'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return /InstallLocation\s+REG_SZ\s+(.+)/.exec(output)?.[1].trim();
  } catch { return undefined; }
}
async function application(version) {
  let base;
  if (process.platform === 'win32') {
    // Squirrel's install root depends on the profile/known-folder APIs. Locate
    // and verify the actual installed package instead of guessing that root.
    const until = Date.now() + 60_000;
    while (Date.now() < until && !base) {
      const registered = registeredWindowsInstallRoot();
      const roots = [...windowsBases.flatMap((directory) => windowsNames.map((name) => path.join(directory, name))), ...(registered ? [registered] : [])];
      for (const installRoot of [...new Set(roots)]) {
        const appRoot = path.join(installRoot, `app-${version}`);
        if (!fs.existsSync(path.join(appRoot, 'resources/app.asar'))) continue;
        if (installed) assert.equal(installRoot.toLowerCase(), installed.toLowerCase(), 'Upgrade must replace the same installation');
        installed = installRoot; base = appRoot;
      }
      if (!base) await delay(500);
    }
    if (!base) {
      const diagnostics = windowsBases.map((directory) => ({ directory, entries: fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => /fidra|squirrel/i.test(name)) : [] }));
      const logs = windowsBases.flatMap((directory) => ['SquirrelTemp/SquirrelSetup.log', 'fidra_web/SquirrelSetup.log'].map((name) => path.join(directory, name))).filter(fs.existsSync).map((file) => ({ file, tail: fs.readFileSync(file, 'utf8').slice(-6000) }));
      throw Error(`Installer did not produce version ${version}: ${JSON.stringify({ directories: diagnostics, registered: registeredWindowsInstallRoot(), logs })}`);
    }
  } else base = path.join(installed, 'Contents');
  const resources = path.join(base, process.platform === 'win32' ? 'resources' : 'Resources');
  const actual = JSON.parse(asar.extractFile(path.join(resources, 'app.asar'), 'package.json').toString());
  assert.equal(actual.version, version);
  return process.platform === 'win32' ? path.join(base, 'Fidra.exe') : path.join(base, 'MacOS/Fidra');
}

async function boot(executable) {
  const child = spawn(executable, [`--user-data-dir=${path.join(root, 'userData')}`, ...(process.platform === 'darwin' ? ['--use-mock-keychain'] : [])], { env, stdio: 'ignore' });
  let error; child.on('error', (value) => { error = value; });
  const log = path.join(fidra, 'startup-diag.log');
  try {
    const until = Date.now() + 30_000;
    while (Date.now() < until) {
      if (error) throw error;
      if (child.exitCode !== null) throw Error('Installed app exited during startup');
      if (fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('Window created successfully')) return;
      await delay(200);
    }
    throw Error('Installed app did not finish startup: ' + (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : 'no startup log'));
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill();
      const timer = setTimeout(() => { if (process.platform === 'win32') { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* exited */ } } else child.kill('SIGKILL'); }, 3_000);
      try { await exited; } finally { clearTimeout(timer); }
    }
    fs.rmSync(log, { force: true });
  }
}
function retained() {
  db = new Database(ledger, { readonly: true });
  try { assert.deepEqual(db.prepare('SELECT * FROM retention_probe').all(), [{ id: 'keep-me', amount: '12.34' }]); } finally { db.close(); }
  assert.equal(fs.readFileSync(attachment, 'utf8'), 'Preserve this synthetic attachment');
}
try {
  await install(previous); await boot(await application('0.1.23')); retained();
  assert.deepEqual(fs.readFileSync(path.join(helper, 'server/server.cjs')), helperBefore);
  await install(candidate); await boot(await application(pkg.version)); retained();
  assert(fs.readFileSync(path.join(helper, 'server/server.cjs'), 'utf8').includes('Stable entry point'));
  const { digest } = JSON.parse(fs.readFileSync(path.join(helper, 'current.json'), 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(path.join(helper, 'releases', digest, 'tools.json'), 'utf8'));
  assert.equal(catalog.tools.length, 19);
  console.log(`Actual ${process.platform}/${process.arch} 0.1.23 → ${pkg.version} installer replacement, startup, synthetic financial/attachment retention and helper refresh passed.`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
