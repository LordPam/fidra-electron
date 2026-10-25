import fs from 'node:fs';
import path from 'node:path';

/** Retire only the former adapter's recognised capability files; never recurse. */
export function retireLegacyAiConnections(directory: string): void {
  if (!fs.existsSync(directory) || fs.lstatSync(directory).isSymbolicLink()) return;
  for (const name of fs.readdirSync(directory)) {
    if (!/^(chatgpt|claude)-[a-f0-9]{24}\.json$/.test(name)) continue;
    const file = path.join(directory, name); const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) continue;
    try {
      const item = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (/^http:\/\/127\.0\.0\.1:\d+\/bridge$/.test(item.url) && /^[a-f0-9]{64}$/.test(item.token) && typeof item.expiresAt === 'string') fs.unlinkSync(file);
    } catch { /* Keep unrecognised or unreadable files. */ }
  }
  if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
}
