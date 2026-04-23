import type { TransactionRow } from '../../shared/ipc-types';
import { computeRunningBalances } from './balance';
import { formatCurrency } from '../lib/format';

interface ReportConfig {
  title: string;
  startDate: string;
  endDate: string;
  includeSummary?: boolean;
  includeMonthlyBreakdown?: boolean;
  includeCategoryBreakdown?: boolean;
  includeTransactionTable?: boolean;
}

function sortByDate(txns: TransactionRow[]): TransactionRow[] {
  return [...txns].sort(
    (a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at),
  );
}

export function generateReportMarkdown(
  transactions: TransactionRow[],
  config: ReportConfig,
): string {
  const {
    title,
    startDate,
    endDate,
    includeSummary = true,
    includeMonthlyBreakdown = true,
    includeCategoryBreakdown = true,
    includeTransactionTable = true,
  } = config;

  const sorted = sortByDate(transactions);
  const lines: string[] = [];

  // Header
  lines.push(`# ${title}\n`);
  lines.push(`**Period**: ${startDate} to ${endDate}  `);
  lines.push(`**Generated**: ${new Date().toISOString().slice(0, 10)}  `);
  lines.push(`**Transactions**: ${sorted.length}\n`);
  lines.push('---\n');

  // Summary
  if (includeSummary) {
    const validTxns = sorted.filter((t) => t.status !== 'rejected' && t.status !== 'planned');
    let totalIncome = 0;
    let totalExpenses = 0;
    let incomeCount = 0;
    let expenseCount = 0;

    for (const t of validTxns) {
      const amt = parseFloat(t.amount) || 0;
      if (t.type === 'income') {
        totalIncome += amt;
        incomeCount++;
      } else {
        totalExpenses += amt;
        expenseCount++;
      }
    }
    const net = totalIncome - totalExpenses;
    const pendingTotal = sorted
      .filter((t) => t.status === 'pending')
      .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
    const pendingCount = sorted.filter((t) => t.status === 'pending').length;

    lines.push('## Summary\n');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(
      `| Total Income | ${formatCurrency(totalIncome)} (${incomeCount} transactions) |`,
    );
    lines.push(
      `| Total Expenses | ${formatCurrency(totalExpenses)} (${expenseCount} transactions) |`,
    );
    lines.push(`| **Net** | **${formatCurrency(net)}** |`);
    lines.push(
      `| Pending Expenses | ${formatCurrency(pendingTotal)} (${pendingCount} pending) |`,
    );
    lines.push('');
  }

  // Monthly breakdown
  if (includeMonthlyBreakdown) {
    lines.push('## Monthly Breakdown\n');

    const validTxns = sorted.filter((t) => t.status !== 'rejected' && t.status !== 'planned');
    const monthlyData = new Map<string, { income: number; expense: number }>();

    for (const t of validTxns) {
      const monthKey = t.date.slice(0, 7);
      let entry = monthlyData.get(monthKey);
      if (!entry) {
        entry = { income: 0, expense: 0 };
        monthlyData.set(monthKey, entry);
      }
      const amt = parseFloat(t.amount) || 0;
      if (t.type === 'income') entry.income += amt;
      else entry.expense += amt;
    }

    if (monthlyData.size === 0) {
      lines.push('*No data available*\n');
    } else {
      lines.push('| Month | Income | Expenses | Net |');
      lines.push('|-------|--------|----------|-----|');

      const sortedMonths = [...monthlyData.keys()].sort().reverse();
      for (const monthKey of sortedMonths) {
        const data = monthlyData.get(monthKey)!;
        const [y, m] = monthKey.split('-').map(Number);
        const monthName = new Date(y, m - 1, 1).toLocaleDateString('en-GB', {
          month: 'long',
          year: 'numeric',
        });
        const net = data.income - data.expense;
        lines.push(
          `| ${monthName} | ${formatCurrency(data.income)} | ${formatCurrency(data.expense)} | ${formatCurrency(net)} |`,
        );
      }
      lines.push('');
    }
  }

  // Category breakdown
  if (includeCategoryBreakdown) {
    lines.push('## Expenses by Category\n');

    const expenses = sorted.filter(
      (t) =>
        t.type === 'expense' &&
        t.status !== 'planned' &&
        t.status !== 'rejected',
    );

    if (expenses.length === 0) {
      lines.push('*No expense data available*\n');
    } else {
      const categoryTotals = new Map<string, number>();
      for (const t of expenses) {
        const cat = t.category || 'Uncategorized';
        categoryTotals.set(cat, (categoryTotals.get(cat) || 0) + (parseFloat(t.amount) || 0));
      }

      const totalExpenses = [...categoryTotals.values()].reduce((a, b) => a + b, 0);
      const sortedCategories = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]);

      lines.push('| Category | Amount | % of Total |');
      lines.push('|----------|--------|------------|');

      for (const [cat, amount] of sortedCategories) {
        const pct = totalExpenses > 0 ? ((amount / totalExpenses) * 100).toFixed(1) : '0.0';
        lines.push(`| ${cat} | ${formatCurrency(amount)} | ${pct}% |`);
      }
      lines.push(
        `| **Total** | **${formatCurrency(totalExpenses)}** | **100%** |`,
      );
      lines.push('');
    }
  }

  // Transaction table
  if (includeTransactionTable) {
    lines.push('## Transactions\n');

    if (sorted.length === 0) {
      lines.push('*No transactions*\n');
    } else {
      const balances = computeRunningBalances(sorted);

      lines.push(
        '| Date | Description | Amount | Party | Category | Activity | Balance |',
      );
      lines.push(
        '|------|-------------|--------|-------|----------|----------|---------|',
      );

      for (const t of sorted) {
        const amtStr =
          t.type === 'income'
            ? `+${formatCurrency(t.amount)}`
            : `-${formatCurrency(t.amount)}`;
        const bal = balances.get(t.id) ?? 0;
        lines.push(
          `| ${t.date} | ${t.description} | ${amtStr} | ${t.party || '-'} | ${t.category || '-'} | ${t.activity || '-'} | ${formatCurrency(bal)} |`,
        );
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
