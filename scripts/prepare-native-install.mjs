// Maintainer install compatibility only. npm ci --ignore-scripts first, then
// this patch and npm rebuild. The pinned CR-SQLite installer predates Node 22's
// removal of JSON import assertions; its native extension is unchanged.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2] ?? '.');
const directory = path.join(root, 'node_modules/@vlcn.io/crsqlite');
const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
if (pkg.version !== '0.16.3') throw Error('Review the CR-SQLite install compatibility patch for this dependency version.');
const file = path.join(directory, 'nodejs-install-helper.js');
const original = 'import pkg from "./package.json" assert { type: "json" };';
const replacement = 'const pkg = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"));';
const source = fs.readFileSync(file, 'utf8');
if (source.includes(replacement) && !source.includes(original)) console.log('CR-SQLite installer is already compatible.');
else {
  if (source.split(original).length !== 2) throw Error('Unexpected CR-SQLite installer; refusing an unreviewed patch.');
  fs.writeFileSync(file, source.replace(original, replacement));
  console.log('Prepared the pinned CR-SQLite installer for Node 22+. Native extension and application code unchanged.');
}
