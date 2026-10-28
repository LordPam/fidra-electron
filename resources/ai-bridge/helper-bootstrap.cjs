'use strict';
// Stable entry point for the explicitly installed local compatibility helper.
// Fidra selects a complete snapshot before replacing this entry point.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const files = ['server/server.cjs', 'tools.json', 'skills/setup/SKILL.md', 'skills/fidra-reconcile/SKILL.md', 'skills/fidra-ledger/SKILL.md'];
try {
  const root = path.resolve(__dirname, '..');
  function regular(file) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000) throw Error('Invalid helper file');
    return fs.readFileSync(file, 'utf8');
  }
  const pointer = JSON.parse(regular(path.join(root, 'current.json')));
  if (!/^[a-f0-9]{64}$/.test(pointer.digest)) throw Error('Invalid helper version');
  const snapshot = path.join(root, 'releases', pointer.digest);
  for (const directory of ['releases', `releases/${pointer.digest}`, `releases/${pointer.digest}/server`, `releases/${pointer.digest}/skills`, ...['setup', 'fidra-reconcile', 'fidra-ledger'].map((name) => `releases/${pointer.digest}/skills/${name}`)]) {
    const stat = fs.lstatSync(path.join(root, directory));
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Invalid helper directory');
  }
  const content = files.map((name) => [name, regular(path.join(snapshot, name))]);
  if (crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex') !== pointer.digest) throw Error('Helper integrity check failed');
  require(path.join(snapshot, 'server/server.cjs')).main().catch(fail);
} catch { fail(); }
function fail() {
  process.stderr.write('Open the updated Fidra app, then restart your AI app to refresh its connection helper. No permissions have changed.\n');
  process.exitCode = 1;
}
