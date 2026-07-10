import type { TransactionRow } from '../../shared/ipc-types';

export function isTransfer(t: TransactionRow): boolean {
  return t.linked_id != null;
}

export function getCounterpart(
  t: TransactionRow,
  all: TransactionRow[],
): TransactionRow | null {
  if (!t.linked_id) return null;
  return all.find((other) => other.linked_id === t.linked_id && other.id !== t.id) ?? null;
}
