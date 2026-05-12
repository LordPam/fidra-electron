// ─── Transaction Domain Rules ────────────────────────────────────────
//
// Centralised business rules for transactions. Used by both main and
// renderer so that validation is consistent across all creation paths
// (form, planned conversion, CSV import, bulk operations).

/**
 * Income transactions are never "pending" — they are always auto-approved ("--").
 * Given a type and a desired status, returns the status that should actually be stored.
 */
export function resolveStatus(
  type: 'income' | 'expense',
  desiredStatus: string,
): '--' | 'pending' | 'approved' | 'rejected' {
  if (type === 'income') return '--';
  if (desiredStatus === '--' || desiredStatus === 'pending' || desiredStatus === 'approved' || desiredStatus === 'rejected') {
    return desiredStatus;
  }
  return 'pending';
}

/**
 * When creating a new transaction and no explicit status is provided,
 * returns the appropriate default for the given type.
 */
export function defaultStatusForType(type: 'income' | 'expense'): '--' | 'pending' {
  return type === 'income' ? '--' : 'pending';
}
