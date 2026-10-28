import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const helperPayloadFiles = ['server/server.cjs', 'tools.json', 'skills/setup/SKILL.md', 'skills/fidra-reconcile/SKILL.md', 'skills/fidra-ledger/SKILL.md'] as const;
export type HelperPayload = Record<typeof helperPayloadFiles[number], string>;
// The exact 2.0.4 adapter installed by the owner-authorised launcher repair.
const legacyAdapterHash = '60a0bfd7588d25ec1d9569f64b3f76ab0df12c3508d11e41b8f4a7fb2bc7cd89';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function exists(target: string): boolean {
  try { fs.lstatSync(target); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
function directory(target: string, create = false): void {
  if (create && !exists(target)) fs.mkdirSync(target, { mode: 0o700 });
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unrecognised helper directory');
}
function read(target: string): string {
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000) throw new Error('Unrecognised helper file');
  return fs.readFileSync(target, 'utf8');
}
function atomicWrite(target: string, content: string): void {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally { fs.rmSync(temporary, { force: true }); }
}

/** Updates only the recognised compatibility copy, never a host plugin cache,
 * runtime, keyring, approval store or host settings. Errors leave local ledger
 * startup independent of this optional helper. Caller reports failures. */
export function refreshInstalledAiHelper(home: string, bootstrap: string, payload: HelperPayload): 'absent' | 'updated' | 'current' {
  const parts = ['.fidra', 'ai-plugin', '2.0.4'];
  let root = home;
  for (const part of parts) {
    root = path.join(root, part);
    try { directory(root); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
      throw error;
    }
  }
  directory(path.join(root, 'server'));
  const entry = path.join(root, 'server/server.cjs');
  const old = read(entry);
  if (old !== bootstrap && hash(old) !== legacyAdapterHash) throw new Error('The installed helper was modified; it was left unchanged');
  const entries = helperPayloadFiles.map((name) => [name, payload[name]]);
  if (entries.some(([, value]) => typeof value !== 'string' || value.length > 2_000_000)) throw new Error('Invalid helper payload');
  const digest = hash(JSON.stringify(entries));
  const releases = path.join(root, 'releases'); directory(releases, true);
  const snapshot = path.join(releases, digest); directory(snapshot, true);
  for (const [name, content] of entries) {
    const target = path.join(snapshot, name);
    let parent = snapshot;
    for (const part of name.split('/').slice(0, -1)) { parent = path.join(parent, part); directory(parent, true); }
    if (exists(target)) {
      if (read(target) !== content) throw new Error('The helper snapshot failed its integrity check');
    } else atomicWrite(target, content);
  }
  const pointer = path.join(root, 'current.json');
  const selection = JSON.stringify({ digest });
  if (exists(pointer) && read(pointer) === selection && old === bootstrap) return 'current';
  // Keep the known original for diagnosis. Never replace it or create credentials.
  if (old !== bootstrap) {
    const backup = path.join(root, 'server/server-2.0.4.original.cjs');
    if (exists(backup)) { if (read(backup) !== old) throw new Error('Unrecognised helper backup'); }
    else fs.writeFileSync(backup, old, { mode: 0o600, flag: 'wx' });
  }
  atomicWrite(pointer, selection);
  if (old !== bootstrap) atomicWrite(entry, bootstrap);
  return 'updated';
}
