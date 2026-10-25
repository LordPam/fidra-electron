import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { build } from 'esbuild';
import JSZip from 'jszip';

// Maintainer build task. No user-specific connection or financial data enters a package.
const root = path.resolve(import.meta.dirname, '..');
const runtime = process.env.FIDRA_PLUGIN_NODE_RUNTIME;
if (!runtime || !path.isAbsolute(runtime)) throw new Error('Set FIDRA_PLUGIN_NODE_RUNTIME to a verified official Node 22+ binary for this platform.');
const metadata = JSON.parse(execFileSync(runtime, ['-p', 'JSON.stringify({platform:process.platform,arch:process.arch,version:process.versions.node})'], { encoding: 'utf8' }));
if (metadata.platform !== process.platform || metadata.arch !== process.arch || Number(metadata.version.split('.')[0]) < 22) throw new Error('The bundled runtime must match this build platform and be Node 22+.');
const require = createRequire(import.meta.url);
const output = path.join(root, 'out', 'ai-plugin', `${process.platform}-${process.arch}`);
fs.mkdirSync(output, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-plugin-build-'));
try {
  if (process.platform === 'darwin') {
    const links = execFileSync('otool', ['-L', runtime], { encoding: 'utf8' });
    if (links.split('\n').slice(1).some((line) => line.trim() && !/^\s*\/(System|usr\/lib)\//.test(line))) throw new Error('Use an official standalone runtime, not a Homebrew runtime with external library dependencies.');
  }
  const catalog = path.join(temporary, 'catalog.cjs');
  await build({ entryPoints: [path.join(root, 'scripts/ai-plugin-catalog.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: catalog, logLevel: 'silent' });
  const tools = execFileSync(process.execPath, [catalog], { encoding: 'utf8' });
  const zip = new JSZip();
  zip.file('tools.json', tools);
  zip.file('assets/icon.png', fs.readFileSync(path.join(root, 'resources/icon.png')));
  zip.file('server/server.cjs', fs.readFileSync(path.join(root, 'resources/ai-bridge/server.cjs')));
  for (const name of ['setup', 'fidra-reconcile']) zip.file(`skills/${name}/SKILL.md`, fs.readFileSync(path.join(root, 'resources/ai-bridge/skills', name, 'SKILL.md')));
  const runtimeName = process.platform === 'win32' ? 'node.exe' : 'node';
  zip.file(`runtime/${runtimeName}`, fs.readFileSync(runtime), { unixPermissions: 0o100755 });
  const runtimeLicense = [path.join(path.dirname(runtime), 'LICENSE'), path.join(path.dirname(runtime), '..', 'LICENSE'), path.join(path.dirname(runtime), 'LICENSE.txt')].find((file) => fs.existsSync(file));
  if (!runtimeLicense) throw new Error('The official runtime license and third-party notices are required.');
  zip.file('runtime/LICENSE', fs.readFileSync(runtimeLicense));
  zip.file('LICENSE', fs.readFileSync(path.join(root, 'resources/ai-bridge/LICENSE')));
  function addPackage(name) {
    const directory = path.dirname(require.resolve(`${name}/package.json`));
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
    for (const file of fs.readdirSync(directory, { withFileTypes: true })) if (file.isFile()) zip.file(`node_modules/${name}/${file.name}`, fs.readFileSync(path.join(directory, file.name)));
    return pkg;
  }
  const keyring = addPackage('@napi-rs/keyring');
  const nativeName = `@napi-rs/keyring-${process.platform}-${process.arch}${process.platform === 'win32' ? '-msvc' : ''}`;
  if (!keyring.optionalDependencies[nativeName]) throw new Error('Unsupported credential-store target.');
  addPackage(nativeName);
  const nodeCommand = `\${PLUGIN_ROOT}/runtime/${runtimeName}`;
  zip.file('plugin.json', JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'fidra', version: '2.0.0', description: 'Connect Fidra with administrator-approved access. Reconcile statements, check planned payments and add missing entries safely.', author: { name: 'Fidra' }, extensions: { 'com.openai': { requires_local_executor: true, onboardingSkill: './skills/setup/SKILL.md', interface: { displayName: 'Fidra', shortDescription: 'Reconcile statements with your Fidra ledger', developerName: 'Fidra', category: 'Productivity', capabilities: ['Read', 'Write'], logo: './assets/icon.png', composerIcon: './assets/icon.png' } } } }, null, 2));
  zip.file('mcp.json', JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: { fidra: { type: 'stdio', command: nodeCommand, args: ['${PLUGIN_ROOT}/server/server.cjs'] } } }, null, 2));
  zip.file('BUILD.json', JSON.stringify({ pluginVersion: '2.0.0', ...metadata, runtimeSha256: crypto.createHash('sha256').update(fs.readFileSync(runtime)).digest('hex'), sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() }, null, 2));
  const destination = path.join(output, 'Fidra-plugin.zip');
  fs.writeFileSync(destination, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' }));
  console.log(destination);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
