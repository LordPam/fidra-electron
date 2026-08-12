import type Database from 'better-sqlite3';

/**
 * App-level stand-ins for the constraints cr-sqlite will not allow.
 *
 * CRR tables can carry neither FOREIGN KEY nor UNIQUE (beyond the primary key), so
 * nothing in the database stops a transaction naming a sheet that does not exist, or
 * two sheets sharing a name. These checks put that back at the write boundary.
 *
 * They belong in IPC handlers, deliberately, and not in the repositories. Local Sync
 * applies incoming changes straight through `crsql_changes`, bypassing this code —
 * which is what we want. Bundles arrive per table and in no guaranteed order, so a
 * transaction can legitimately land before the sheet it names. Enforcing referential
 * rules on that path would reject a peer's perfectly good data.
 */

/** A write rejected because it would leave the database referentially inconsistent. */
export class ReferentialIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferentialIntegrityError';
  }
}

function sheetNames(db: Database.Database): Set<string> {
  const rows = db.prepare('SELECT name FROM sheets').all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

/**
 * Reject rows naming a sheet that does not exist.
 *
 * Sheets are referenced by name, so a bad name does not dangle visibly — the row
 * simply stops appearing anywhere in the UI, because every view filters by sheet.
 */
export function assertSheetsExist(
  db: Database.Database,
  references: { label: string; sheet: string | null }[],
): void {
  const pending = references.filter((r): r is { label: string; sheet: string } => !!r.sheet);
  if (pending.length === 0) return;

  const existing = sheetNames(db);
  const missing = pending.filter((r) => !existing.has(r.sheet));
  if (missing.length === 0) return;

  const detail = [...new Set(missing.map((m) => `${m.label} "${m.sheet}"`))].join(', ');
  throw new ReferentialIntegrityError(`No such sheet: ${detail}`);
}

/**
 * Reject a sheet name already in use.
 *
 * Compared case-insensitively: "Main" and "main" would be two separate sheets that
 * look identical in the sidebar, silently splitting a ledger in two. Pass the id of
 * the sheet being renamed so it does not collide with itself.
 */
export function assertSheetNameAvailable(
  db: Database.Database,
  name: string,
  exceptSheetId?: string,
): void {
  const clash = db
    .prepare('SELECT id, name FROM sheets WHERE LOWER(name) = LOWER(?)')
    .all(name) as { id: string; name: string }[];

  const other = clash.find((row) => row.id !== exceptSheetId);
  if (other) {
    throw new ReferentialIntegrityError(
      other.name === name
        ? `A sheet named "${name}" already exists`
        : `A sheet named "${other.name}" already exists, which differs only in capitalisation`,
    );
  }
}

/** Rows that reference something no longer present. */
export interface OrphanReport {
  /** Attachment rows whose transaction is gone (their files are still on disk). */
  attachments: string[];
  /** Transactions naming a sheet that does not exist. */
  transactions: string[];
  /** Planned templates whose target or transfer-target sheet does not exist. */
  plannedTemplates: string[];
  /** Invoices pointing at a transaction that is gone. */
  invoices: string[];
}

export function isEmptyOrphanReport(report: OrphanReport): boolean {
  return (
    report.attachments.length === 0 &&
    report.transactions.length === 0 &&
    report.plannedTemplates.length === 0 &&
    report.invoices.length === 0
  );
}

/**
 * Find rows left pointing at something that no longer exists.
 *
 * Read-only on purpose. Deleting an orphan is not obviously safe on a synced
 * database: a local delete is a real CRDT delete that propagates, so sweeping a row
 * whose parent simply has not arrived from a peer yet would destroy good data on
 * every device. Report first; repair is a decision for a human.
 */
export function findOrphans(db: Database.Database): OrphanReport {
  const ids = (sql: string): string[] =>
    (db.prepare(sql).all() as { id: string }[]).map((r) => r.id);

  return {
    attachments: ids(`
      SELECT a.id FROM attachments a
      WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = a.transaction_id)
    `),
    transactions: ids(`
      SELECT t.id FROM transactions t
      WHERE NOT EXISTS (SELECT 1 FROM sheets s WHERE s.name = t.sheet)
    `),
    plannedTemplates: ids(`
      SELECT p.id FROM planned_templates p
      WHERE NOT EXISTS (SELECT 1 FROM sheets s WHERE s.name = p.target_sheet)
         OR (p.transfer_target_sheet IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM sheets s WHERE s.name = p.transfer_target_sheet))
    `),
    invoices: ids(`
      SELECT i.id FROM invoices i
      WHERE i.transaction_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = i.transaction_id)
    `),
  };
}

/** One line per orphan category, for logging. Empty when there is nothing to report. */
export function describeOrphans(report: OrphanReport): string[] {
  const lines: string[] = [];
  const note = (count: number, what: string): void => {
    if (count > 0) lines.push(`${count} ${what}`);
  };
  note(report.attachments.length, 'attachment(s) whose transaction is gone');
  note(report.transactions.length, 'transaction(s) on a sheet that does not exist');
  note(report.plannedTemplates.length, 'planned template(s) targeting a missing sheet');
  note(report.invoices.length, 'invoice(s) linked to a transaction that is gone');
  return lines;
}
