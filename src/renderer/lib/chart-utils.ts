import type { TransactionRow } from '../../shared/ipc-types';

const COUNTABLE_INCOME = new Set(['--', 'approved']);
const COUNTABLE_EXPENSE = new Set(['approved']);

export interface MonthlyData {
  month: string; // 'Jan 2026'
  monthKey: string; // '2026-01'
  income: number;
  expense: number;
}

export interface DailyBalance {
  date: string; // 'Mar 15'
  dateISO: string; // '2026-03-15'
  balance: number;
}

export interface CategoryData {
  category: string;
  total: number;
}

function isCountable(t: TransactionRow): boolean {
  if (t.type === 'income') return COUNTABLE_INCOME.has(t.status);
  if (t.type === 'expense') return COUNTABLE_EXPENSE.has(t.status);
  return false;
}

export function groupByMonth(transactions: TransactionRow[]): MonthlyData[] {
  const map = new Map<string, { income: number; expense: number }>();

  for (const t of transactions) {
    if (t.status === 'planned' || t.status === 'rejected') continue;
    const monthKey = t.date.slice(0, 7); // 'YYYY-MM'
    let entry = map.get(monthKey);
    if (!entry) {
      entry = { income: 0, expense: 0 };
      map.set(monthKey, entry);
    }
    const amount = parseFloat(t.amount) || 0;
    if (t.type === 'income' && COUNTABLE_INCOME.has(t.status)) {
      entry.income += amount;
    } else if (t.type === 'expense' && COUNTABLE_EXPENSE.has(t.status)) {
      entry.expense += amount;
    }
  }

  const sorted = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return sorted.map(([monthKey, data]) => {
    const [year, month] = monthKey.split('-').map(Number);
    const d = new Date(year, month - 1, 1);
    const label = d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    return { month: label, monthKey, income: data.income, expense: data.expense };
  });
}

export function computeDailyBalances(
  transactions: TransactionRow[],
  startDate: string,
  endDate: string,
): DailyBalance[] {
  // Sort transactions date ASC
  const sorted = [...transactions]
    .filter((t) => isCountable(t))
    .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));

  // Compute opening balance (transactions before startDate)
  let balance = 0;
  const inRangeTransactions: TransactionRow[] = [];

  for (const t of sorted) {
    if (t.date < startDate) {
      const amount = parseFloat(t.amount) || 0;
      balance += t.type === 'income' ? amount : -amount;
    } else if (t.date <= endDate) {
      inRangeTransactions.push(t);
    }
  }

  // Group by date
  const dateMap = new Map<string, number>();
  for (const t of inRangeTransactions) {
    const amount = parseFloat(t.amount) || 0;
    const delta = t.type === 'income' ? amount : -amount;
    dateMap.set(t.date, (dateMap.get(t.date) || 0) + delta);
  }

  // Build daily points
  const points: DailyBalance[] = [];
  let current = startDate;
  const end = endDate;

  while (current <= end) {
    balance += dateMap.get(current) || 0;
    const [y, m, d] = current.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const label = dateObj.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
    points.push({ date: label, dateISO: current, balance: Math.round(balance * 100) / 100 });

    // Advance one day
    dateObj.setDate(dateObj.getDate() + 1);
    current = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
  }

  return points;
}

export function groupByCategory(
  transactions: TransactionRow[],
  type: 'income' | 'expense',
  topN = 5,
): CategoryData[] {
  const map = new Map<string, number>();

  for (const t of transactions) {
    if (t.type !== type) continue;
    if (t.status === 'planned' || t.status === 'rejected') continue;
    if (type === 'expense' && t.status !== 'approved') continue;
    if (type === 'income' && !COUNTABLE_INCOME.has(t.status)) continue;

    const category = t.category || 'Uncategorized';
    const amount = parseFloat(t.amount) || 0;
    map.set(category, (map.get(category) || 0) + amount);
  }

  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);

  if (sorted.length <= topN) {
    return sorted.map(([category, total]) => ({ category, total }));
  }

  const top = sorted.slice(0, topN);
  const otherTotal = sorted.slice(topN).reduce((sum, [, v]) => sum + v, 0);
  return [
    ...top.map(([category, total]) => ({ category, total })),
    { category: 'Other', total: otherTotal },
  ];
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getFYStart(startMonth: number): string {
  const now = new Date();
  if (startMonth === 1) {
    // FY = calendar year
    return `${now.getFullYear()}-01-01`;
  }
  // FY starts in startMonth. If we're before startMonth, FY started last year.
  const year = now.getMonth() + 1 >= startMonth ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${String(startMonth).padStart(2, '0')}-01`;
}

export function getFYEnd(startMonth: number): string {
  const now = new Date();
  if (startMonth === 1) {
    // FY = calendar year
    return `${now.getFullYear()}-12-31`;
  }
  // FY ends the last day of the month before startMonth, next year
  const year = now.getMonth() + 1 >= startMonth ? now.getFullYear() + 1 : now.getFullYear();
  const endMonth = startMonth - 1; // month before start
  // Last day of endMonth
  const lastDay = new Date(year, endMonth, 0).getDate();
  return `${year}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}
