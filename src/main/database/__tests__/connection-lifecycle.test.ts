import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../connection';
import { loadCrSqlite } from '../crsqlite-lifecycle';
import { initializeCrr } from '../../sync/crr-schema';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-close-lifecycle-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('database connection resource lifecycle', () => {
  it('releases closed standalone and CRR files for replacement while preserving persisted rows', () => {
    for (const sync of [false, true]) {
      const file = path.join(root, `ledger-${sync}.fdra`);
      const first = openDatabase(file).db;
      if (sync) initializeCrr(first);
      // Calling the loader again must retain the existing extension's state.
      loadCrSqlite(first);
      first.prepare("INSERT INTO sheets (id, name) VALUES ('kept', 'Kept account')").run();
      first.close(); first.close();
      const moved = `${file}.moved`; fs.renameSync(file, moved);
      const reopened = openDatabase(moved).db;
      try { expect(reopened.prepare("SELECT name FROM sheets WHERE id = 'kept'").pluck().get()).toBe('Kept account'); }
      finally { reopened.close(); }
      fs.rmSync(moved);
    }
  });
  it('closes an initialization failure so the damaged file can be removed or recovered', () => {
    const file = path.join(root, 'invalid.fdra');
    fs.writeFileSync(file, 'synthetic invalid SQLite input');
    expect(() => openDatabase(file)).toThrow();
    fs.renameSync(file, `${file}.recovery`);
    expect(fs.readFileSync(`${file}.recovery`, 'utf8')).toBe('synthetic invalid SQLite input');
  });
});
