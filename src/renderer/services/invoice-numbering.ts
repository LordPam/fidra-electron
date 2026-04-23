/**
 * Invoice number generation.
 * Counter state is stored in SQLite settings (via IPC), not localStorage.
 */

function todayStamp(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

/** Parse the counter JSON string. Returns { date, count } or defaults. */
function parseCounter(raw: string): { date: string; count: number } {
  try {
    if (raw) {
      const parsed = JSON.parse(raw) as { date: string; count: number };
      return parsed;
    }
  } catch { /* ignore */ }
  return { date: '', count: 0 };
}

/**
 * Generate the next invoice number and return the updated counter JSON.
 * Format: INV-YYYYMMDD-NNN
 *
 * The caller is responsible for persisting the returned counter string.
 */
export function nextInvoiceNumber(
  existingNumbers: Set<string>,
  counterJson: string,
): { invoiceNumber: string; counter: string } {
  const stamp = todayStamp();
  const prev = parseCounter(counterJson);
  let count = prev.date === stamp ? prev.count + 1 : 1;

  let candidate = `INV-${stamp}-${String(count).padStart(3, '0')}`;
  while (existingNumbers.has(candidate)) {
    count++;
    candidate = `INV-${stamp}-${String(count).padStart(3, '0')}`;
  }

  return {
    invoiceNumber: candidate,
    counter: JSON.stringify({ date: stamp, count }),
  };
}

/**
 * Preview what the next invoice number would be without updating the counter.
 */
export function peekInvoiceNumber(existingNumbers: Set<string>, counterJson: string): string {
  const stamp = todayStamp();
  const prev = parseCounter(counterJson);
  let count = prev.date === stamp ? prev.count + 1 : 1;

  let candidate = `INV-${stamp}-${String(count).padStart(3, '0')}`;
  while (existingNumbers.has(candidate)) {
    count++;
    candidate = `INV-${stamp}-${String(count).padStart(3, '0')}`;
  }
  return candidate;
}
