import type Database from 'better-sqlite3';
import { transactionRowSchema, plannedTemplateRowSchema, invoiceRowSchema, attachmentRowSchema, sheetRowSchema } from '../../shared/ipc-schemas';
import { readLedgerState } from './recovery-state';
import { parsePence } from '../../shared/money';

/** Recovery must finish a referentially complete state; unlike ordinary bundle
 * arrival, publication is not an intermediate out-of-order transport state. */
export function validateRecoveryLedger(db: Database.Database): string[] {
  const state = readLedgerState(db);
  const issues: string[] = [];
  for (const [table, schema] of [
    ['transactions', transactionRowSchema], ['planned_templates', plannedTemplateRowSchema],
    ['invoices', invoiceRowSchema], ['attachments', attachmentRowSchema], ['sheets', sheetRowSchema],
  ] as const) {
    for (const row of state[table]) {
      const parsed = schema.safeParse(row);
      if (!parsed.success) issues.push(`${table} ${String(row.id)}: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
    }
  }
  const sheets = new Set(state.sheets.map((row) => row.name));
  const names = new Set<string>();
  for (const sheet of state.sheets) {
    const name = String(sheet.name).toLocaleLowerCase('en-GB');
    if (names.has(name)) issues.push(`Duplicate account name requires review: ${String(sheet.name)}`);
    names.add(name);
  }
  const transactions = new Map(state.transactions.map((row) => [row.id, row]));
  for (const row of state.transactions) {
    if (!sheets.has(row.sheet)) issues.push(`Transaction ${String(row.id)} names a missing account.`);
    if (row.linked_id) {
      const other = transactions.get(row.linked_id);
      if (!other || other.linked_id !== row.id || other.id === row.id || other.sheet === row.sheet
        || other.type === row.type || parsePence(String(other.amount)) !== parsePence(String(row.amount))) {
        issues.push(`Transfer ${String(row.id)} is not a complete, balanced pair.`);
      }
    }
  }
  for (const row of state.planned_templates) if (!sheets.has(row.target_sheet)
    || (row.transfer_target_sheet && !sheets.has(row.transfer_target_sheet))) issues.push(`Planned payment ${String(row.id)} names a missing account.`);
  for (const row of state.attachments) if (!transactions.has(row.transaction_id)) issues.push(`Attachment ${String(row.id)} has no transaction.`);
  if (!state.personnel.some((row) => row.role === 'admin' && row.password_hash)) issues.push('A recovered team needs an active administrator.');
  return [...new Set(issues)];
}
