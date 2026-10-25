import fs from 'node:fs';
import path from 'node:path';

// Explicit allowlists only. Ledgers, attachments, backups, accounts.json, and
// release-keys are deliberately not candidates, even when inside app data.
const homeFiles = ['settings.json', 'settings.json.tmp', '.first-run-complete', 'startup-diag.log'];
const homeDirectories = ['sessions', 'logs', 'ai-connections', 'ai-access'];
const cacheDirectories = ['updates', 'Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Session Storage', 'Local Storage'];

function removeOwned(root: string, relative: string, directory: boolean): void {
  if (!fs.existsSync(root)) return;
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Device settings folder is a link. Cleanup stopped to protect your files.');
  const candidate = path.join(root, relative);
  if (!fs.existsSync(candidate)) return;
  // Unlink a link itself; never traverse to its destination.
  if (fs.lstatSync(candidate).isSymbolicLink()) { fs.unlinkSync(candidate); return; }
  if (directory) {
    // Never recurse into a directory that contains something other than the
    // owned cache. A ledger accidentally saved there must survive too.
    const containsFinance = (entry: string): boolean => fs.readdirSync(entry, { withFileTypes: true }).some((child) => {
      if (child.isSymbolicLink()) return true;
      if (child.isDirectory()) return containsFinance(path.join(entry, child.name));
      return /\.(fdra|db|sqlite|pdf|csv|xlsx|zip)$/i.test(child.name);
    });
    if (containsFinance(candidate)) throw new Error(`Cleanup kept ${relative} because it contains possible financial files. Move them to a safe place and retry.`);
  }
  fs.rmSync(candidate, { recursive: directory, force: true });
}

export function clearDeviceFiles(fidraHome: string, userData: string): void {
  for (const name of homeDirectories) removeOwned(fidraHome, name, true);
  for (const name of cacheDirectories) removeOwned(userData, name, true);
  for (const name of homeFiles) removeOwned(fidraHome, name, false);
}
