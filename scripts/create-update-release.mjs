import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function argument(name, fallback = '') { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}
const artifact = path.resolve(argument('--artifact'));
const platform = argument('--platform');
const arch = argument('--arch');
const version = argument('--version');
const keyPath = argument('--private-key', process.env.FIDRA_UPDATE_PRIVATE_KEY_PATH);
const expectedName = platform === 'darwin' && ['arm64', 'x64'].includes(arch)
  ? `Fidra-macOS${arch === 'x64' ? '' : `-${arch}`}.dmg`
  : platform === 'win32' && arch === 'x64' ? 'Fidra-Windows-Setup.exe' : null;
if (!argument('--artifact') || !expectedName || path.basename(artifact) !== expectedName) throw new Error('Use the correct Fidra installer, --platform and --arch.');
if (!keyPath || !path.isAbsolute(keyPath)) throw new Error('Provide an absolute private release key path.');
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Use a stable semantic version.');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (version !== pkg.version) throw new Error('Release version does not match package.json.');
const key = createPrivateKey(await readFile(keyPath, 'utf8'));
const publicPem = await readFile(path.join(root, 'resources', 'update-public-key.pem'), 'utf8');
if (key.asymmetricKeyType !== 'ed25519' || !createPublicKey(key).equals(createPublicKey(publicPem))) throw new Error('The signing key does not match the public key embedded in Fidra.');
const details = await stat(artifact);
if (!details.isFile() || details.size <= 0 || details.size > 2 * 1024 * 1024 * 1024) throw new Error('Installer must be a non-empty file smaller than 2GB.');
const hash = createHash('sha256');
for await (const chunk of createReadStream(artifact)) hash.update(chunk);
const notesPath = argument('--notes');
const releaseNotes = notesPath ? (await readFile(notesPath, 'utf8')).split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [`Fidra ${version}`];
if (releaseNotes.length > 30 || releaseNotes.some((note) => note.length > 2000)) throw new Error('Release notes are too long.');
const unsigned = { schemaVersion: 1, channel: 'stable', version, publishedAt: new Date().toISOString(), platform, arch, releaseNotes,
  artifact: { url: `https://github.com/LordPam/fidra-electron/releases/download/v${version}/${expectedName}`,
    fileName: expectedName, sha256: hash.digest('hex'), size: details.size } };
const signature = sign(null, Buffer.from(canonical(unsigned)), key).toString('base64');
const directory = path.resolve(argument('--out', path.dirname(artifact)));
await mkdir(directory, { recursive: true });
const target = path.join(directory, `fidra-update-${platform}-${arch}.json`);
const temporary = `${target}.${process.pid}.tmp`;
await writeFile(temporary, JSON.stringify({ ...unsigned, signature }, null, 2) + '\n', { flag: 'wx' });
await rename(temporary, target);
console.log(`Prepared verified update metadata: ${path.basename(target)}`);
