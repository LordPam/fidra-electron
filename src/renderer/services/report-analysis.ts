import type { TransactionRow } from '../../shared/ipc-types';
import { toISODate, shiftDateRange, getFYStartForDate } from '@/lib/chart-utils';
import { sumAmounts, toAmount } from '../../shared/money';

// --- Countable statuses (matches chart-utils.ts) ---

const COUNTABLE_INCOME = new Set<string>(['--', 'approved']);
const COUNTABLE_EXPENSE = new Set<string>(['approved']);

function isCountable(t: TransactionRow): boolean {
  if (t.type === 'income') return COUNTABLE_INCOME.has(t.status);
  if (t.type === 'expense') return COUNTABLE_EXPENSE.has(t.status);
  return false;
}

function countable(txns: TransactionRow[]): TransactionRow[] {
  return txns.filter(isCountable);
}

function excludeTransfers(txns: TransactionRow[]): TransactionRow[] {
  return txns.filter((t) => !t.linked_id);
}

// --- Normalize empty comparison arrays to null ---

function normalizeComparison(txns: TransactionRow[] | null): TransactionRow[] | null {
  if (!txns || txns.length === 0) return null;
  return txns;
}

// --- Comparison period calculation ---

/**
 * The window of the same length immediately before this one.
 *
 * Length, not calendar: Mar 1–31 is 31 days, so its comparison is Jan 29 – Feb 28,
 * spanning two months. (This previously claimed "Mar 1-31 → Feb 1-28", which is a
 * different rule and never what the code did.)
 */
export function getComparisonPeriod(start: string, end: string): { start: string; end: string } {
  return shiftDateRange(start, end, -1);
}

/** Get the same period in the previous financial year. */
export function getFYComparisonPeriod(
  start: string,
  end: string,
  fyStartMonth: number,
): { start: string; end: string } {
  const startDate = new Date(start + 'T00:00:00');
  const endDate = new Date(end + 'T00:00:00');

  // Find the FY start for the current period
  const currentFYStart = getFYStartForDate(startDate, fyStartMonth);
  const currentFYDate = new Date(currentFYStart + 'T00:00:00');

  // Previous FY start is one year earlier
  const prevFYDate = new Date(currentFYDate);
  prevFYDate.setFullYear(prevFYDate.getFullYear() - 1);

  // Offset from FY start
  const offsetStart = startDate.getTime() - currentFYDate.getTime();
  const offsetEnd = endDate.getTime() - currentFYDate.getTime();

  const newStart = new Date(prevFYDate.getTime() + offsetStart);
  const newEnd = new Date(prevFYDate.getTime() + offsetEnd);

  return { start: toISODate(newStart), end: toISODate(newEnd) };
}

// --- Summary with deltas ---

export interface PeriodSummary {
  totalIncome: number;
  totalExpenditure: number;
  net: number;
  transactionCount: number;
  transferVolume: number;
}

export interface DeltaEntry {
  absolute: number;
  percent: number;
  flagged: boolean;
}

export interface SummaryWithDeltas {
  current: PeriodSummary;
  comparison: PeriodSummary | null;
  deltas: Record<keyof PeriodSummary, DeltaEntry> | null;
}

const FLAG_THRESHOLD = 25; // percent

function computePeriodSummary(txns: TransactionRow[]): PeriodSummary {
  const counted = countable(txns);

  // Transfer volume = sum of expense-side transfer amounts (each transfer has one expense + one income)
  let transferVolume = 0;
  for (const t of counted) {
    if (t.linked_id && t.type === 'expense') {
      transferVolume += toAmount(t.amount);
    }
  }

  // Exclude transfers from income/expense totals
  const nonTransfer = excludeTransfers(counted);
  let totalIncome = 0;
  let totalExpenditure = 0;

  for (const t of nonTransfer) {
    const amt = toAmount(t.amount);
    if (t.type === 'income') totalIncome += amt;
    else totalExpenditure += amt;
  }

  const net = totalIncome - totalExpenditure;
  const transactionCount = nonTransfer.length;

  return { totalIncome, totalExpenditure, net, transactionCount, transferVolume };
}

function computeDelta(current: number, comparison: number): DeltaEntry {
  const absolute = current - comparison;
  const percent = comparison !== 0 ? (absolute / Math.abs(comparison)) * 100 : current !== 0 ? 100 : 0;
  return { absolute, percent, flagged: Math.abs(percent) >= FLAG_THRESHOLD };
}

export function computeSummaryWithDeltas(
  currentTxns: TransactionRow[],
  comparisonTxns: TransactionRow[] | null,
): SummaryWithDeltas {
  const current = computePeriodSummary(currentTxns);
  comparisonTxns = normalizeComparison(comparisonTxns);

  if (!comparisonTxns) {
    return { current, comparison: null, deltas: null };
  }

  const comparison = computePeriodSummary(comparisonTxns);
  const deltas: Record<keyof PeriodSummary, DeltaEntry> = {
    totalIncome: computeDelta(current.totalIncome, comparison.totalIncome),
    totalExpenditure: computeDelta(current.totalExpenditure, comparison.totalExpenditure),
    net: computeDelta(current.net, comparison.net),
    transactionCount: computeDelta(current.transactionCount, comparison.transactionCount),
    transferVolume: computeDelta(current.transferVolume, comparison.transferVolume),
  };

  return { current, comparison, deltas };
}

// --- Category breakdown with deltas ---

export interface CategoryBreakdownRow {
  category: string;
  count: number;
  total: number;
  pct: number;
  delta: { absolute: number; percent: number } | null;
  status: 'normal' | 'new' | 'gone' | 'flagged';
  subItems: { description: string; count: number; amount: number }[];
}

function buildCategoryMap(txns: TransactionRow[]): Map<string, TransactionRow[]> {
  const byCat = new Map<string, TransactionRow[]>();
  for (const t of txns) {
    const cat = t.category || 'Other';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push(t);
  }
  return byCat;
}

function categoryTotal(txns: TransactionRow[]): number {
  return sumAmounts(txns.map((t) => t.amount));
}

export function buildCategoryBreakdownWithDeltas(
  currentTxns: TransactionRow[],
  comparisonTxns: TransactionRow[] | null,
  type: 'INCOME' | 'EXPENSE',
): CategoryBreakdownRow[] {
  comparisonTxns = normalizeComparison(comparisonTxns);
  const statusSet = type === 'INCOME' ? COUNTABLE_INCOME : COUNTABLE_EXPENSE;
  const txnType = type === 'INCOME' ? 'income' : 'expense';

  const current = excludeTransfers(countable(currentTxns)).filter((t) => t.type === txnType && statusSet.has(t.status));
  const comparison = comparisonTxns
    ? excludeTransfers(countable(comparisonTxns)).filter((t) => t.type === txnType && statusSet.has(t.status))
    : null;

  const currentMap = buildCategoryMap(current);
  const comparisonMap = comparison ? buildCategoryMap(comparison) : null;

  const grandTotal = sumAmounts(current.map((t) => t.amount));

  // All categories from both periods
  const allCats = new Set([...currentMap.keys()]);
  if (comparisonMap) {
    for (const cat of comparisonMap.keys()) allCats.add(cat);
  }

  const rows: CategoryBreakdownRow[] = [];

  for (const category of allCats) {
    const items = currentMap.get(category) || [];
    const total = categoryTotal(items);
    const pct = grandTotal > 0 ? (total / grandTotal) * 100 : 0;

    // Sub-items
    const byDesc = new Map<string, { count: number; amount: number }>();
    for (const t of items) {
      const desc = t.description || 'Other';
      const existing = byDesc.get(desc) || { count: 0, amount: 0 };
      existing.count++;
      existing.amount += toAmount(t.amount);
      byDesc.set(desc, existing);
    }
    const subItems = [...byDesc.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([d, v]) => ({ description: d, count: v.count, amount: v.amount }));

    // Delta
    let delta: { absolute: number; percent: number } | null = null;
    let status: CategoryBreakdownRow['status'] = 'normal';

    if (comparisonMap) {
      const compItems = comparisonMap.get(category);
      if (!compItems || compItems.length === 0) {
        if (items.length > 0) status = 'new';
      } else if (items.length === 0) {
        status = 'gone';
      } else {
        const compTotal = categoryTotal(compItems);
        const abs = total - compTotal;
        const pctChange = compTotal !== 0 ? (abs / Math.abs(compTotal)) * 100 : total !== 0 ? 100 : 0;
        delta = { absolute: abs, percent: pctChange };
        if (Math.abs(pctChange) >= FLAG_THRESHOLD) status = 'flagged';
      }
    }

    rows.push({ category, count: items.length, total, pct, delta, status, subItems });
  }

  // Sort: biggest movers first (by absolute delta), falling back to amount
  rows.sort((a, b) => {
    const aDelta = a.delta ? Math.abs(a.delta.percent) : 0;
    const bDelta = b.delta ? Math.abs(b.delta.percent) : 0;
    // New/Gone always at top
    const aWeight = a.status === 'new' || a.status === 'gone' ? 1000 : aDelta;
    const bWeight = b.status === 'new' || b.status === 'gone' ? 1000 : bDelta;
    if (aWeight !== bWeight) return bWeight - aWeight;
    return b.total - a.total;
  });

  return rows;
}

// --- Activity breakdown with deltas ---

export interface ActivityBreakdownRow {
  activity: string;
  count: number;
  income: number;
  expenditure: number;
  net: number;
  delta: { absolute: number; percent: number } | null;
  status: 'normal' | 'new' | 'gone' | 'flagged';
}

function buildActivityMap(txns: TransactionRow[]): Map<string, { income: number; expenditure: number; count: number }> {
  const map = new Map<string, { income: number; expenditure: number; count: number }>();
  for (const t of txns) {
    const activity = t.activity || 'General';
    const existing = map.get(activity) || { income: 0, expenditure: 0, count: 0 };
    const amt = toAmount(t.amount);
    if (t.type === 'income') existing.income += amt;
    else existing.expenditure += amt;
    existing.count++;
    map.set(activity, existing);
  }
  return map;
}

export function buildActivityBreakdownWithDeltas(
  currentTxns: TransactionRow[],
  comparisonTxns: TransactionRow[] | null,
): ActivityBreakdownRow[] {
  comparisonTxns = normalizeComparison(comparisonTxns);
  const current = excludeTransfers(countable(currentTxns));
  const comparison = comparisonTxns ? excludeTransfers(countable(comparisonTxns)) : null;

  const currentMap = buildActivityMap(current);
  const comparisonMap = comparison ? buildActivityMap(comparison) : null;

  const allActivities = new Set([...currentMap.keys()]);
  if (comparisonMap) {
    for (const act of comparisonMap.keys()) allActivities.add(act);
  }

  const rows: ActivityBreakdownRow[] = [];

  for (const activity of allActivities) {
    const cur = currentMap.get(activity) || { income: 0, expenditure: 0, count: 0 };
    const net = cur.income - cur.expenditure;

    let delta: { absolute: number; percent: number } | null = null;
    let status: ActivityBreakdownRow['status'] = 'normal';

    if (comparisonMap) {
      const comp = comparisonMap.get(activity);
      if (!comp || comp.count === 0) {
        if (cur.count > 0) status = 'new';
      } else if (cur.count === 0) {
        status = 'gone';
      } else {
        const compNet = comp.income - comp.expenditure;
        const abs = net - compNet;
        const pctChange = compNet !== 0 ? (abs / Math.abs(compNet)) * 100 : net !== 0 ? 100 : 0;
        delta = { absolute: abs, percent: pctChange };
        if (Math.abs(pctChange) >= FLAG_THRESHOLD) status = 'flagged';
      }
    }

    rows.push({
      activity,
      count: cur.count,
      income: cur.income,
      expenditure: cur.expenditure,
      net,
      delta,
      status,
    });
  }

  // Sort by net descending
  rows.sort((a, b) => {
    const aWeight = a.status === 'new' || a.status === 'gone' ? 1 : 0;
    const bWeight = b.status === 'new' || b.status === 'gone' ? 1 : 0;
    if (aWeight !== bWeight) return bWeight - aWeight;
    return Math.abs(b.net) - Math.abs(a.net);
  });

  return rows;
}

// --- Description breakdown with intelligent grouping ---

export interface DescriptionBreakdownRow {
  description: string;
  count: number;
  totalAmount: number;
  avgAmount: number;
  type: 'income' | 'expense' | 'mixed';
  recurring: boolean;
  highValue: boolean;
  status: 'normal' | 'new';
  transactions: TransactionRow[];
}

export function buildDescriptionBreakdown(
  currentTxns: TransactionRow[],
  comparisonTxns: TransactionRow[] | null,
  opts: { recurringThreshold?: number } = {},
): DescriptionBreakdownRow[] {
  comparisonTxns = normalizeComparison(comparisonTxns);
  const recurringThreshold = opts.recurringThreshold ?? 3;
  const current = excludeTransfers(countable(currentTxns));
  const comparison = comparisonTxns ? excludeTransfers(countable(comparisonTxns)) : null;

  // Group by description (case-insensitive)
  const descMap = new Map<string, TransactionRow[]>();
  for (const t of current) {
    const key = (t.description || 'Other').toLowerCase();
    if (!descMap.has(key)) descMap.set(key, []);
    descMap.get(key)!.push(t);
  }

  // Comparison descriptions for "new" detection
  const compDescriptions = new Set<string>();
  if (comparison) {
    for (const t of comparison) {
      compDescriptions.add((t.description || 'Other').toLowerCase());
    }
  }

  // Compute mean and stddev for high-value detection
  const amounts = current.map((t) => toAmount(t.amount));
  const mean = amounts.length > 0 ? amounts.reduce((s, a) => s + a, 0) / amounts.length : 0;
  const variance =
    amounts.length > 1
      ? amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length
      : 0;
  const stddev = Math.sqrt(variance);
  const highValueThreshold = mean + stddev;

  const rows: DescriptionBreakdownRow[] = [];

  for (const [key, txns] of descMap) {
    const totalAmount = sumAmounts(txns.map((t) => t.amount));
    const avgAmount = txns.length > 0 ? totalAmount / txns.length : 0;

    const hasIncome = txns.some((t) => t.type === 'income');
    const hasExpense = txns.some((t) => t.type === 'expense');
    const type: 'income' | 'expense' | 'mixed' =
      hasIncome && hasExpense ? 'mixed' : hasIncome ? 'income' : 'expense';

    const recurring = txns.length >= recurringThreshold;
    const highValue = txns.some((t) => toAmount(t.amount) > highValueThreshold);

    // "New" = appears multiple times in current but 0 times in comparison
    const isNew =
      comparison !== null && txns.length >= 2 && !compDescriptions.has(key);

    rows.push({
      description: txns[0].description || 'Other', // preserve original casing from first occurrence
      count: txns.length,
      totalAmount,
      avgAmount,
      type,
      recurring,
      highValue,
      status: isNew ? 'new' : 'normal',
      transactions: txns.sort((a, b) => b.date.localeCompare(a.date)),
    });
  }

  // Sort: recurring first, then by total amount descending
  rows.sort((a, b) => {
    if (a.recurring !== b.recurring) return a.recurring ? -1 : 1;
    if (a.highValue !== b.highValue) return a.highValue ? -1 : 1;
    return b.totalAmount - a.totalAmount;
  });

  return rows;
}

// --- Party breakdown ---

export interface PartyBreakdownRow {
  party: string;
  count: number;
  income: number;
  expenditure: number;
  net: number;
}

export function buildPartyBreakdown(
  currentTxns: TransactionRow[],
): PartyBreakdownRow[] {
  const current = excludeTransfers(countable(currentTxns));

  const map = new Map<string, { income: number; expenditure: number; count: number }>();
  for (const t of current) {
    const party = t.party || 'Other';
    const existing = map.get(party) || { income: 0, expenditure: 0, count: 0 };
    const amt = toAmount(t.amount);
    if (t.type === 'income') existing.income += amt;
    else existing.expenditure += amt;
    existing.count++;
    map.set(party, existing);
  }

  const rows: PartyBreakdownRow[] = [];
  for (const [party, data] of map) {
    rows.push({
      party,
      count: data.count,
      income: data.income,
      expenditure: data.expenditure,
      net: data.income - data.expenditure,
    });
  }

  rows.sort((a, b) => (a.income + a.expenditure) > (b.income + b.expenditure) ? -1 : 1);
  return rows;
}
