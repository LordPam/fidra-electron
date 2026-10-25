import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = process.argv.indexOf('--private-key');
const privatePath = process.argv[index + 1];
const publicPath = path.join(root, 'resources', 'update-public-key.pem');
if (index < 0 || !privatePath || !path.isAbsolute(privatePath)) throw new Error('Use --private-key with an absolute path outside the project.');
const resolved = path.resolve(privatePath);
const relative = path.relative(root, resolved);
if (!relative.startsWith(`..${path.sep}`) && relative !== '..') throw new Error('Keep the private release key outside the project.');
if (existsSync(resolved) || existsSync(publicPath)) throw new Error('An update key already exists. Never replace it for an ordinary release.');
const pair = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
writeFileSync(resolved, pair.privateKey, { flag: 'wx', mode: 0o600 });
writeFileSync(publicPath, pair.publicKey, { flag: 'wx', mode: 0o644 });
console.log('Created a Fidra update key pair. Back up the private key securely; only the public key belongs in the project.');
