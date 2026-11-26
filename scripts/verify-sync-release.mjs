import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const info = read('release-candidate.json');
const pkg = read('package.json');
const lock = read('package-lock.json');
if (info.version !== pkg.version || pkg.version !== lock.version || pkg.version !== lock.packages[''].version) {
  throw new Error('Candidate, package and lockfile versions must match.');
}
if (!Array.isArray(info.outstanding) || info.outstanding.some((item) => typeof item !== 'string' || !item.trim())) {
  throw new Error('Release gate is invalid.');
}
if (process.argv.includes('--candidate')) {
  if (info.status !== 'candidate' || info.outstanding.length === 0) throw new Error('Expected an explicitly gated release candidate.');
  console.log(`Fidra ${pkg.version}: candidate build only; ${info.outstanding.length} release gates remain.`);
} else {
  if (info.status !== 'ready' || info.outstanding.length !== 0) {
    throw new Error(`Stable publication is blocked: ${info.outstanding.join('; ')}`);
  }
  console.log(`Fidra ${pkg.version}: recorded release gates are complete.`);
}
