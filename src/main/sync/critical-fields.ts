/**
 * Critical field registry for Local Sync merge gate.
 *
 * Maps table names to the set of columns that require manual conflict
 * review when changed concurrently by different devices. These fields
 * guard financial data integrity — they must NEVER be silently overwritten.
 *
 * See CLAUDE.md § "Critical fields (manual review required on conflict)".
 */

const CRITICAL_FIELDS: Record<string, ReadonlySet<string>> = {
  // linked_id is intentionally NOT a critical field — it's set once at creation
  // and never edited. Concurrent changes to linked_id are not expected, so
  // cr-sqlite last-write-wins is safe for this column.
  transactions: new Set([
    'amount',
    'date',
    'type',
    'status',
    'sheet',
    'party',
  ]),
  planned_templates: new Set([
    'amount',
    'start_date',
    'type',
    'frequency',
    'target_sheet',
    // Reconciliation must not silently lose another device's fulfilment.
    'fulfilled_dates',
  ]),
  invoices: new Set([
    'subtotal',
    'date',
    'due_date',
    'status',
    'to_name',
  ]),
  sheets: new Set([
    'name',
  ]),
  personnel: new Set([
    'name',
    'role',
    'email',
  ]),
};

/** Check whether a specific column on a table is a critical field. */
export function isCriticalField(table: string, column: string): boolean {
  return CRITICAL_FIELDS[table]?.has(column) ?? false;
}

/** Get the set of critical fields for a table, or null if the table is not tracked. */
export function getCriticalFields(table: string): ReadonlySet<string> | null {
  return CRITICAL_FIELDS[table] ?? null;
}

/** Check whether a table has any critical fields defined. */
export function isTrackedTable(table: string): boolean {
  return table in CRITICAL_FIELDS;
}
