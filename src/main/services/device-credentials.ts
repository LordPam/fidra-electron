import fs from 'node:fs';
import { openDatabase } from '../database/connection';

/** Only device settings are changed; organisation rows and CRDT history remain. */
export function forgetDatabaseCredentials(paths: string[]): void {
  for (const file of new Set(paths)) {
    if (!fs.existsSync(file)) continue;
    const { db } = openDatabase(file);
    try {
      db.prepare("DELETE FROM settings WHERE key = 'localSync.passphrase' AND scope = 'device'").run();
      db.pragma('wal_checkpoint(TRUNCATE)');
    } finally { db.close(); }
  }
}
