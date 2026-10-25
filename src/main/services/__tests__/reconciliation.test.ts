import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../database/connection';
import { ReconciliationService } from '../reconciliation';
import { SheetRepo } from '../../repositories/sheet-repo';
import { TransactionRepo } from '../../repositories/transaction-repo';
import { PlannedRepo } from '../../repositories/planned-repo';
import { initializeCrr } from '../../sync/crr-schema';
import type { ReconciliationScope, ReconciliationDraft, ReconciliationProposal } from '../../../shared/reconciliation-types';
import type { TransactionRow, PlannedTemplateRow } from '../../../shared/ipc-types';
import type { CrChangesetRow } from '../../sync/bundle-format';

let directory: string;
let db: Database.Database;
let service: ReconciliationService;
const scope: ReconciliationScope = { sheetIds: ['account-a'], from: '2026-10-01', to: '2026-10-31', fields: ['description', 'party', 'category', 'activity'] };
const draft = (overrides: Partial<ReconciliationDraft['rows'][number]> = {}): ReconciliationDraft => ({ label: 'October statement', rows: [{
  sheetId: 'account-a', source: { statementHash: 'a'.repeat(64), row: 0, bankId: 'bank-001', evidence: '24 Oct CLUB PAYMENT 12.00 debit', date: '2026-10-24', amount: '12.00', type: 'expense', description: 'CLUB PAYMENT' },
  description: 'Pool hire', party: 'Pool', category: 'Venue', activity: 'Training', action: 'new', ...overrides,
}] });
const approve = (proposal: ReconciliationProposal) => ({ id: proposal.id, digest: proposal.digest, reviewedRows: proposal.rows.map((_, index) => index) });
const tx = (changes: Partial<TransactionRow> = {}): TransactionRow => ({ id: 'existing', date: '2026-10-24', amount: '12.00', type: 'expense', status: 'pending', sheet: 'Current',
  description: 'Pool hire', category: 'Venue', party: 'Pool', activity: 'Training', reference: null, notes: 'private notes', linked_id: null, version: 1, created_at: '2026-10-24T12:00:00Z', modified_at: null, modified_by: null, ...changes });
const template = (changes: Partial<PlannedTemplateRow> = {}): PlannedTemplateRow => ({ id: 'plan', start_date: '2026-10-24', description: 'Pool hire', amount: '12.00', type: 'expense', frequency: 'monthly', target_sheet: 'Current', category: 'Venue', party: 'Pool', activity: 'Training', notes: null,
  transfer_target_sheet: null, end_date: null, occurrence_count: null, skipped_dates: '[]', fulfilled_dates: '[]', version: 1, created_at: '2026-10-01T12:00:00Z', ...changes });

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-reconciliation-'));
  db = openDatabase(path.join(directory, 'ledger.fdra')).db;
  new SheetRepo(db).create('account-a', 'Current'); new SheetRepo(db).create('account-b', 'Savings');
  service = new ReconciliationService(db);
});
afterEach(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

describe('reconciliation proposals', () => {
  it('discloses only selected accounts, dates and optional fields', () => {
    const repo = new TransactionRepo(db);
    repo.save(tx()); repo.save(tx({ id: 'other', sheet: 'Savings' })); repo.save(tx({ id: 'old', date: '2026-09-01' }));
    const result = service.context({ ...scope, fields: [] });
    expect(result.transactions).toEqual([{ id: 'existing', date: '2026-10-24', amount: '12.00', type: 'expense', sheet: 'Current' }]);
    expect(JSON.stringify(result)).not.toContain('private notes');
    expect(JSON.stringify(result)).not.toContain('Savings');
  });
  it('does not change any financial row until native approval', () => {
    const proposal = service.stage('grant', scope, draft());
    expect(new TransactionRepo(db).getAll()).toEqual([]);
    expect(proposal.review[0].questions.length).toBeGreaterThan(0);
    expect(() => service.commit({ ...approve(proposal), reviewedRows: [] }, 'Sam')).toThrow('Confirm every row');
  });
  it('keeps account and income/expense direction distinct during duplicate detection', () => {
    new TransactionRepo(db).save(tx({ sheet: 'Savings' }));
    new TransactionRepo(db).save(tx({ id: 'income', type: 'income' }));
    const proposal = service.stage('grant', scope, draft());
    expect(proposal.review[0].duplicateIds).toEqual([]);
  });
  it('compares decimal money values consistently and asks about possible duplicates', () => {
    new TransactionRepo(db).save(tx({ amount: '12' }));
    const proposal = service.stage('grant', scope, draft());
    expect(proposal.review[0].duplicateIds).toEqual(['existing']);
    expect(proposal.review[0].questions.join(' ')).toContain('separate payment');
  });
  it('rejects missing/invalid financial fields and scope escapes', () => {
    const invalid = draft(); invalid.rows[0].source.date = '2026-02-31';
    expect(() => service.stage('grant', scope, invalid)).toThrow();
    const invalidAmount = draft(); invalidAmount.rows[0].source.amount = '12abc';
    expect(() => service.stage('grant', scope, invalidAmount)).toThrow();
    expect(() => service.stage('grant', scope, draft({ sheetId: 'account-b' }))).toThrow('selected');
  });
  it('binds approval to the exact draft and refuses stale previews', () => {
    const proposal = service.stage('grant', scope, draft());
    expect(() => service.commit({ ...approve(proposal), digest: 'b'.repeat(64) }, 'Sam')).toThrow('changed');
    new TransactionRepo(db).save(tx({ id: 'arrived-later' }));
    expect(() => service.commit(approve(proposal), 'Sam')).toThrow('ledger changed');
    expect(new TransactionRepo(db).getAll()).toHaveLength(1);
  });
  it('imports once, records provenance and supports a guarded atomic undo and redo', () => {
    const proposal = service.stage('grant', scope, draft());
    const first = service.commit(approve(proposal), 'Sam');
    expect(first.count).toBe(1);
    expect(service.commit(approve(proposal), 'Sam')).toEqual(first);
    expect(new TransactionRepo(db).getAll()).toHaveLength(1);
    expect(db.prepare("SELECT details FROM audit_log WHERE entity_type='reconciliation'").pluck().get()).toContain('CLUB PAYMENT');
    service.undo(proposal.id, 'Sam'); expect(new TransactionRepo(db).getAll()).toEqual([]);
    expect(service.commit(approve(proposal), 'Sam').transactionIds).toEqual(first.transactionIds);
  });
  it('does not undo over another person’s later edits', () => {
    const proposal = service.stage('grant', scope, draft());
    const imported = service.commit(approve(proposal), 'Sam');
    const repo = new TransactionRepo(db); const row = repo.getById(imported.transactionIds[0])!;
    repo.save({ ...row, amount: '14.00', version: row.version + 1 });
    expect(() => service.undo(proposal.id, 'Sam')).toThrow('edited');
    expect(repo.getById(row.id)?.amount).toBe('14.00');
  });
  it('creates the actual and fulfils only the selected recurring occurrence together', () => {
    const repo = new PlannedRepo(db); repo.save(template());
    const proposal = service.stage('grant', scope, draft({ action: 'fulfil', planned: { templateId: 'plan', date: '2026-10-24' } }));
    expect(proposal.review[0].blockers).toEqual([]);
    service.commit(approve(proposal), 'Sam');
    expect(JSON.parse(repo.getById('plan')!.fulfilled_dates)).toEqual(['2026-10-24']);
    expect(new TransactionRepo(db).getAll()).toHaveLength(1);
    service.undo(proposal.id, 'Sam');
    expect(repo.getById('plan')!.fulfilled_dates).toBe('[]');
  });
  it('fulfils a planned occurrence against an existing actual without creating or editing it', () => {
    const actual = tx(); new TransactionRepo(db).save(actual); new PlannedRepo(db).save(template());
    const proposal = service.stage('grant', scope, draft({ action: 'link', existingId: actual.id, planned: { templateId: 'plan', date: '2026-10-24' } }));
    expect(service.commit(approve(proposal), 'Sam').count).toBe(0);
    expect(new TransactionRepo(db).getAll()).toEqual([actual]);
    expect(new PlannedRepo(db).getById('plan')!.fulfilled_dates).toBe('["2026-10-24"]');
    service.undo(proposal.id, 'Sam');
    expect(new TransactionRepo(db).getAll()).toEqual([actual]);
    expect(new PlannedRepo(db).getById('plan')!.fulfilled_dates).toBe('[]');
  });
  it('keeps skipped statement details out of the synced audit trail', () => {
    const input = draft(); input.rows.push({ ...structuredClone(input.rows[0]), source: { ...input.rows[0].source, bankId: 'personal-row', row: 1, description: 'PRIVATE PERSONAL PURCHASE', evidence: 'PRIVATE PERSONAL PURCHASE' }, action: 'skip' });
    const proposal = service.stage('grant', scope, input); service.commit(approve(proposal), 'Sam');
    const audit = db.prepare("SELECT details FROM audit_log WHERE entity_type='reconciliation'").pluck().get() as string;
    expect(audit).not.toContain('PRIVATE PERSONAL PURCHASE'); expect(audit).toContain('skippedCount');
  });
  it('blocks already fulfilled/skipped occurrences and transfers', () => {
    const repo = new PlannedRepo(db); repo.save(template({ fulfilled_dates: '["2026-10-24"]' }));
    expect(service.stage('grant', scope, draft({ action: 'fulfil', planned: { templateId: 'plan', date: '2026-10-24' } })).review[0].blockers.length).toBeGreaterThan(0);
    repo.save(template({ skipped_dates: '["2026-10-24"]' }));
    expect(service.stage('grant', scope, draft({ action: 'fulfil', planned: { templateId: 'plan', date: '2026-10-24' } })).review[0].blockers.length).toBeGreaterThan(0);
    repo.save(template({ transfer_target_sheet: 'Savings' }));
    expect(service.stage('grant', scope, draft({ action: 'fulfil', planned: { templateId: 'plan', date: '2026-10-24' } })).review[0].blockers.join(' ')).toContain('transfer');
  });
  it('rolls back all actual and planned changes if audit/provenance cannot be recorded', () => {
    new PlannedRepo(db).save(template());
    const proposal = service.stage('grant', scope, draft({ action: 'fulfil', planned: { templateId: 'plan', date: '2026-10-24' } }));
    db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'test audit failure'); END;");
    expect(() => service.commit(approve(proposal), 'Sam')).toThrow('test audit failure');
    expect(new TransactionRepo(db).getAll()).toEqual([]);
    expect(new PlannedRepo(db).getById('plan')!.fulfilled_dates).toBe('[]');
    expect(service.list()[0].state).toBe('draft');
  });
  it('does not import a repeated source row within one batch', () => {
    const input = draft(); input.rows.push(structuredClone(input.rows[0]));
    const proposal = service.stage('grant', scope, input);
    expect(() => service.commit(approve(proposal), 'Sam')).toThrow('blocked');
    expect(new TransactionRepo(db).getAll()).toEqual([]);
  });
  it('converges on one transaction when two offline peers import the same bank identity', () => {
    initializeCrr(db);
    const other = openDatabase(path.join(directory, 'peer.fdra')).db;
    try {
      initializeCrr(other); new SheetRepo(other).create('account-a', 'Current');
      const peer = new ReconciliationService(other);
      const a = service.stage('grant-a', scope, draft()); const b = peer.stage('grant-b', scope, draft());
      expect(service.commit(approve(a), 'Sam').transactionIds).toEqual(peer.commit(approve(b), 'Alex').transactionIds);
      const changes = db.prepare('SELECT "table", pk, cid, val, col_version, db_version, site_id, cl, seq FROM crsql_changes WHERE "table" = ?').all('transactions') as CrChangesetRow[];
      const insert = other.prepare('INSERT INTO crsql_changes ("table", pk, cid, val, col_version, db_version, site_id, cl, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      other.transaction(() => { for (const row of changes) insert.run(row.table, row.pk, row.cid, row.val, row.col_version, row.db_version, row.site_id, row.cl, row.seq); })();
      expect(new TransactionRepo(other).getAll()).toHaveLength(1);
    } finally { other.close(); }
  });
});
