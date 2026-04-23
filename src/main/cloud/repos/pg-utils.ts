import type { SupabaseClient } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;

/**
 * Paginate a Supabase PostgREST query to fetch all rows.
 *
 * PostgREST defaults to returning at most 1000 rows. This helper
 * pages through the entire result set so callers get complete data.
 *
 * The `buildQuery` callback receives the client and must return a
 * fresh query builder each time (filters + ordering, no `.range()`).
 */
export async function fetchAllRows<T = Record<string, unknown>>(
  client: SupabaseClient,
  buildQuery: (c: SupabaseClient) => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }> },
): Promise<T[]> {
  const allRows: T[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await buildQuery(client).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break; // Last page
    offset += PAGE_SIZE;
  }

  return allRows;
}

/** Convert a Postgres TIMESTAMPTZ value (Date object or string) to an ISO 8601 string. */
export function toISOString(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

/**
 * Normalize a Postgres DATE column to a YYYY-MM-DD string (matching SQLite format).
 * Uses local date components — toISOString() converts to UTC which shifts
 * the date back one day in timezones ahead of UTC (e.g. BST).
 */
export function toDateString(val: unknown): string {
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof val === 'string') return val.split('T')[0];
  return String(val);
}

/** Serialize a Postgres JSONB value to a JSON string (pg driver returns parsed objects). */
export function toJsonString(val: unknown): string {
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}
