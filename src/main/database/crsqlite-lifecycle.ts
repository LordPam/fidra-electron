import type Database from 'better-sqlite3';
import { crsqliteExtensionPath } from './native-paths';

const loaded = new WeakSet<Database.Database>();

/** cr-sqlite owns prepared statements that must be finalised before SQLite can
 * really release its file handles. Install teardown at the connection boundary
 * so every existing close path (including failures and backup restore) uses it.
 * Keep one extension initialization per handle. */
export function loadCrSqlite(sqlite: Database.Database): void {
  if (!sqlite.open) throw new Error('This database connection is closed.');
  if (loaded.has(sqlite)) return;
  sqlite.loadExtension(crsqliteExtensionPath);
  const close = sqlite.close.bind(sqlite);
  sqlite.close = function () {
    if (sqlite.open) sqlite.prepare('SELECT crsql_finalize()').get();
    return close();
  };
  loaded.add(sqlite);
}
