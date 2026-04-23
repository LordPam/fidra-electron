import { useMemo, useState } from 'react';
import { formatCurrency } from '@/lib/format';
import type { TransactionRow } from '../../../shared/ipc-types';

interface BreakdownsTabProps {
  transactions: TransactionRow[];
}

interface CategoryRow {
  category: string;
  count: number;
  total: number;
  pct: number;
  subItems: { description: string; count: number; amount: number }[];
}

interface ActivityRow {
  activity: string;
  income: number;
  expense: number;
  net: number;
  count: number;
}

const COUNTABLE_INCOME = new Set(['--', 'approved']);
const COUNTABLE_EXPENSE = new Set(['approved']);

function buildBreakdown(txns: TransactionRow[], grandTotal: number): CategoryRow[] {
  const byCat = new Map<string, TransactionRow[]>();
  for (const t of txns) {
    const cat = t.category || 'Other';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push(t);
  }
  const result: CategoryRow[] = [];
  for (const [category, items] of byCat) {
    const total = items.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
    const pct = grandTotal > 0 ? (total / grandTotal) * 100 : 0;
    const byDesc = new Map<string, { count: number; amount: number }>();
    for (const t of items) {
      const desc = t.description || 'Other';
      const existing = byDesc.get(desc) || { count: 0, amount: 0 };
      existing.count++;
      existing.amount += parseFloat(t.amount) || 0;
      byDesc.set(desc, existing);
    }
    const subItems = [...byDesc.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([d, v]) => ({ description: d, count: v.count, amount: v.amount }));
    result.push({ category, count: items.length, total, pct, subItems });
  }
  return result.sort((a, b) => b.total - a.total);
}

function buildActivityBreakdown(txns: TransactionRow[]): ActivityRow[] {
  const byActivity = new Map<string, { income: number; expense: number; count: number }>();
  for (const t of txns) {
    const activity = t.activity || 'General';
    const existing = byActivity.get(activity) || { income: 0, expense: 0, count: 0 };
    const amt = parseFloat(t.amount) || 0;
    if (t.type === 'income') existing.income += amt;
    else existing.expense += amt;
    existing.count++;
    byActivity.set(activity, existing);
  }
  return [...byActivity.entries()]
    .map(([activity, v]) => ({
      activity,
      income: v.income,
      expense: v.expense,
      net: v.income - v.expense,
      count: v.count,
    }))
    .sort((a, b) => b.net - a.net);
}

function CategoryTable({
  title,
  rows,
  grandTotal,
  totalCount,
  barColor,
  showParens,
}: {
  title: string;
  rows: CategoryRow[];
  grandTotal: number;
  totalCount: number;
  barColor: string;
  showParens: boolean;
}) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const fmt = (n: number) => showParens ? `(${formatCurrency(n)})` : formatCurrency(n);

  return (
    <div className="rounded-lg border border-border-subtle">
      <div className="px-4 py-3 border-b border-border-subtle">
        <h3 className="text-sm font-display font-semibold">{title}</h3>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-xs text-muted-foreground uppercase tracking-wider">
            <th className="text-left px-4 py-2 font-medium">Category</th>
            <th className="text-right px-4 py-2 font-medium">Count</th>
            <th className="text-right px-4 py-2 font-medium">Amount</th>
            <th className="text-right px-4 py-2 font-medium w-[140px]">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isExpanded = expandedCategories.has(r.category);
            const hasSubItems = r.subItems.length > 1;
            return (
              <tr key={r.category} className="group">
                <td className="px-4 py-2 border-b border-border-subtle/50">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      className={`text-left font-medium ${hasSubItems ? 'hover:text-fidra-teal cursor-pointer' : ''}`}
                      onClick={() => hasSubItems && toggleCategory(r.category)}
                    >
                      {hasSubItems && (
                        <span className="inline-block w-4 text-muted-foreground text-xs">
                          {isExpanded ? '\u25BC' : '\u25B6'}
                        </span>
                      )}
                      {r.category}
                    </button>
                    {isExpanded &&
                      r.subItems.map((sub) => (
                        <div
                          key={sub.description}
                          className="flex items-center justify-between pl-6 py-0.5 text-xs text-muted-foreground"
                        >
                          <span>
                            {sub.description}{' '}
                            <span className="text-muted-foreground/60">({sub.count})</span>
                          </span>
                          <span className="tabular-nums">{fmt(sub.amount)}</span>
                        </div>
                      ))}
                  </div>
                </td>
                <td className="text-right px-4 py-2 tabular-nums border-b border-border-subtle/50">
                  {r.count}
                </td>
                <td className="text-right px-4 py-2 tabular-nums border-b border-border-subtle/50">
                  {fmt(r.total)}
                </td>
                <td className="text-right px-4 py-2 border-b border-border-subtle/50">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-2 rounded-full bg-muted/50 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(3, Math.round(r.pct))}%`,
                          backgroundColor: barColor,
                        }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
                      {Math.round(r.pct)}%
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
          <tr className="font-semibold border-t-2 border-border-subtle">
            <td className="px-4 py-2">Total</td>
            <td className="text-right px-4 py-2 tabular-nums">{totalCount}</td>
            <td className="text-right px-4 py-2 tabular-nums">{fmt(grandTotal)}</td>
            <td className="text-right px-4 py-2 text-xs text-muted-foreground">100%</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function BreakdownsTab({ transactions }: BreakdownsTabProps) {
  const countable = useMemo(() => {
    return transactions.filter((t) => {
      if (t.type === 'income') return COUNTABLE_INCOME.has(t.status);
      if (t.type === 'expense') return COUNTABLE_EXPENSE.has(t.status);
      return false;
    });
  }, [transactions]);

  const income = useMemo(() => countable.filter((t) => t.type === 'income'), [countable]);
  const expenses = useMemo(() => countable.filter((t) => t.type === 'expense'), [countable]);

  const totalIncome = useMemo(
    () => income.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0),
    [income],
  );
  const totalExpenses = useMemo(
    () => expenses.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0),
    [expenses],
  );

  const incomeBreakdown = useMemo(() => buildBreakdown(income, totalIncome), [income, totalIncome]);
  const expenseBreakdown = useMemo(
    () => buildBreakdown(expenses, totalExpenses),
    [expenses, totalExpenses],
  );
  const activityBreakdown = useMemo(() => buildActivityBreakdown(countable), [countable]);

  const activityTotals = useMemo(() => {
    return activityBreakdown.reduce(
      (acc, r) => ({
        count: acc.count + r.count,
        income: acc.income + r.income,
        expense: acc.expense + r.expense,
        net: acc.net + r.net,
      }),
      { count: 0, income: 0, expense: 0, net: 0 },
    );
  }, [activityBreakdown]);

  if (countable.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        No transactions for selected period
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <CategoryTable
          title="Income by Category"
          rows={incomeBreakdown}
          grandTotal={totalIncome}
          totalCount={income.length}
          barColor="#89B0AE"
          showParens={false}
        />
        <CategoryTable
          title="Expenditure by Category"
          rows={expenseBreakdown}
          grandTotal={totalExpenses}
          totalCount={expenses.length}
          barColor="#C07A72"
          showParens={true}
        />
      </div>

      {activityBreakdown.length > 0 && (
        <div className="rounded-lg border border-border-subtle">
          <div className="px-4 py-3 border-b border-border-subtle">
            <h3 className="text-sm font-display font-semibold">Income & Expenditure by Activity</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-xs text-muted-foreground uppercase tracking-wider">
                <th className="text-left px-4 py-2 font-medium">Activity</th>
                <th className="text-right px-4 py-2 font-medium">Count</th>
                <th className="text-right px-4 py-2 font-medium">Income</th>
                <th className="text-right px-4 py-2 font-medium">Expenditure</th>
                <th className="text-right px-4 py-2 font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {activityBreakdown.map((r) => (
                <tr key={r.activity} className="border-b border-border-subtle/50">
                  <td className="px-4 py-2 font-medium">{r.activity}</td>
                  <td className="text-right px-4 py-2 tabular-nums">{r.count}</td>
                  <td className="text-right px-4 py-2 tabular-nums">{formatCurrency(r.income)}</td>
                  <td className="text-right px-4 py-2 tabular-nums">
                    ({formatCurrency(r.expense)})
                  </td>
                  <td
                    className={`text-right px-4 py-2 tabular-nums font-medium ${r.net >= 0 ? 'text-fidra-positive' : 'text-fidra-negative'}`}
                  >
                    {r.net >= 0 ? '' : '-'}
                    {formatCurrency(Math.abs(r.net))}
                  </td>
                </tr>
              ))}
              <tr className="font-semibold border-t-2 border-border-subtle">
                <td className="px-4 py-2">Total</td>
                <td className="text-right px-4 py-2 tabular-nums">{activityTotals.count}</td>
                <td className="text-right px-4 py-2 tabular-nums">
                  {formatCurrency(activityTotals.income)}
                </td>
                <td className="text-right px-4 py-2 tabular-nums">
                  ({formatCurrency(activityTotals.expense)})
                </td>
                <td
                  className={`text-right px-4 py-2 tabular-nums ${activityTotals.net >= 0 ? 'text-fidra-positive' : 'text-fidra-negative'}`}
                >
                  {activityTotals.net >= 0 ? '' : '-'}
                  {formatCurrency(Math.abs(activityTotals.net))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
