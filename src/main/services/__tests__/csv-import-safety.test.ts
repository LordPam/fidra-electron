import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../database/connection';
import { SettingsRepo } from '../../database/settings-repo';
import { TransactionRepo } from '../../repositories/transaction-repo';
import { SheetRepo } from '../../repositories/sheet-repo';
import { analyzeForImport, commitImport } from '../csv-import';
import type { CsvAnalyzeRequest, CsvCommitRequest } from '../../../shared/csv-import-types';
import type { WindowContext } from '../../window/window-context';
import type { TransactionRow } from '../../../shared/ipc-types';

let directory: string; let db: Database.Database; let context: WindowContext; let request: CsvAnalyzeRequest;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-csv-safety-'));
  db = openDatabase(path.join(directory, 'test.fdra')).db;
  new SheetRepo(db).create('a', 'Current'); new SheetRepo(db).create('b', 'Savings');
  context = { sqlite: db, repos: { transactions: new TransactionRepo(db) }, settingsRepo: new SettingsRepo(db) } as unknown as WindowContext;
  const file = path.join(directory, 'statement.csv'); fs.writeFileSync(file, 'Date,Description,Amount\n2026-10-24,Pool,-12.00\n');
  request = { filePath: file, columnMapping: { date: 0, description: 1, amount: 2, debit: -1, credit: -1, typeIndicator: -1, reference: -1, party: -1, notes: -1, category: -1 },
    amountMode: 'signed', signConvention: 'positive-income', dateFormat: null, decimalSeparator: '.', skipRows: 0, targetSheet: 'Current', defaultStatus: 'pending' };
});
afterEach(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
function row(changes: Partial<TransactionRow> = {}): TransactionRow {
  return { id: 'old', date: '2026-10-24', description: 'Pool', amount: '12.00', type: 'expense', status: 'pending', sheet: 'Current', category: null, party: null, reference: null,
    activity: null, notes: null, linked_id: null, version: 1, created_at: '2026-10-24T12:00:00Z', modified_at: null, modified_by: null, ...changes };
}
const preview = (): CsvCommitRequest => ({ rows: analyzeForImport(context, request).previewRows, targetSheet: request.targetSheet, defaultStatus: request.defaultStatus });

describe('ordinary CSV import safety', () => {
  it('does not treat another account or the opposite payment direction as a duplicate', () => {
    context.repos.transactions.save(row({ sheet: 'Savings' })); context.repos.transactions.save(row({ id: 'income', type: 'income' }));
    const result = preview(); expect(result.rows[0].include).toBe(true);
    expect(result.rows[0].duplicateMatch.matchType).toBe('none');
  });
  it('rejects missing dates and amounts rather than replacing them with today or zero', () => {
    const result = preview(); result.rows[0].parsed.date = null;
    expect(() => commitImport(context, result)).toThrow('unresolved financial fields');
    expect(context.repos.transactions.getAll()).toEqual([]);
    result.rows[0].parsed.date = '2026-10-24'; result.rows[0].parsed.amount = null;
    expect(() => commitImport(context, result)).toThrow('unresolved financial fields');
  });
  it('rechecks duplicates on commit and rejects replaying an old preview', () => {
    const result = preview(); expect(commitImport(context, result).importedCount).toBe(1);
    expect(() => commitImport(context, result)).toThrow('ledger changed');
    expect(context.repos.transactions.getAll()).toHaveLength(1);
  });
  it('rolls back the batch if persisting learned conventions fails', () => {
    const result = preview(); result.rows[0].userOverrides.description = 'Pool hire';
    db.exec("CREATE TRIGGER fail_learning BEFORE INSERT ON settings WHEN NEW.key='csvImport.bayesianModel' BEGIN SELECT RAISE(ABORT, 'test learning failure'); END;");
    expect(() => commitImport(context, result)).toThrow('test learning failure');
    expect(context.repos.transactions.getAll()).toEqual([]);
  });
});
