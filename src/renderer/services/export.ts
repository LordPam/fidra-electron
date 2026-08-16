import type { TransactionRow } from '../../shared/ipc-types';
import { computeRunningBalances } from './balance';
import { formatCurrency, formatDate } from '../lib/format';
import { toAmount, toAmountString } from '../../shared/money';

function sortByDate(transactions: TransactionRow[]): TransactionRow[] {
  return [...transactions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at),
  );
}

export function exportCSV(transactions: TransactionRow[], includeBalance = false): string {
  const sorted = sortByDate(transactions);
  const balances = includeBalance ? computeRunningBalances(sorted) : new Map();

  const headers = [
    'Date',
    'Description',
    'Amount',
    'Type',
    'Status',
    'Category',
    'Party',
    'Reference',
    'Activity',
    'Notes',
    ...(includeBalance ? ['Balance'] : []),
  ];

  const rows = sorted.map((t) => {
    const fields = [
      t.date,
      `"${(t.description || '').replace(/"/g, '""')}"`,
      // A plain decimal, not formatCurrency. "£1,000.00" carries a thousands
      // separator into an unquoted field, which splits the row — every amount of
      // £1,000 or more gained a column and shifted everything after it. A bare
      // number is also what a spreadsheet needs to read the column as numeric.
      toAmountString(t.amount) ?? t.amount,
      t.type,
      t.status,
      t.category || '',
      t.party || '',
      t.reference || '',
      t.activity || '',
      `"${(t.notes || '').replace(/"/g, '""')}"`,
    ];
    if (includeBalance) {
      fields.push(toAmountString(balances.get(t.id) ?? 0) ?? '0.00');
    }
    return fields.join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

export function exportMarkdown(transactions: TransactionRow[], includeBalance = false): string {
  const sorted = sortByDate(transactions);
  const balances = includeBalance ? computeRunningBalances(sorted) : new Map();

  // Group by month
  const monthGroups = new Map<string, TransactionRow[]>();
  for (const t of sorted) {
    const key = t.date.slice(0, 7);
    let group = monthGroups.get(key);
    if (!group) {
      group = [];
      monthGroups.set(key, group);
    }
    group.push(t);
  }

  const lines: string[] = [];
  lines.push('# Transaction Report\n');
  lines.push(`**Generated**: ${new Date().toISOString().slice(0, 10)}\n`);
  lines.push(`**Total Transactions**: ${sorted.length}\n`);
  lines.push('---\n');

  const sortedMonths = [...monthGroups.keys()].sort().reverse();

  for (const monthKey of sortedMonths) {
    const monthTxns = monthGroups.get(monthKey)!;
    const [y, m] = monthKey.split('-').map(Number);
    const monthDate = new Date(y, m - 1, 1);
    const monthName = monthDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

    lines.push(`\n## ${monthName}\n`);

    let income = 0;
    let expenses = 0;
    for (const t of monthTxns) {
      const amt = toAmount(t.amount);
      if (t.type === 'income') income += amt;
      else expenses += amt;
    }
    const net = income - expenses;

    lines.push(`**Income**: ${formatCurrency(income)}  `);
    lines.push(`**Expenses**: ${formatCurrency(expenses)}  `);
    lines.push(`**Net**: ${formatCurrency(net)}\n`);

    if (includeBalance) {
      lines.push('| Date | Description | Amount | Type | Status | Category | Party | Balance |');
      lines.push('|------|-------------|--------|------|--------|----------|-------|---------|');
    } else {
      lines.push('| Date | Description | Amount | Type | Status | Category | Party |');
      lines.push('|------|-------------|--------|------|--------|----------|-------|');
    }

    for (const t of monthTxns) {
      const row = [
        t.date,
        t.description,
        formatCurrency(t.amount),
        t.type,
        t.status,
        t.category || '-',
        t.party || '-',
      ];
      if (includeBalance) {
        row.push(formatCurrency(balances.get(t.id) ?? 0));
      }
      lines.push(`| ${row.join(' | ')} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function exportTSV(transactions: TransactionRow[], includeBalance = false): string {
  const sorted = sortByDate(transactions);
  const balances = includeBalance ? computeRunningBalances(sorted) : new Map();

  const headers = [
    'Date',
    'Description',
    'Amount',
    'Type',
    'Status',
    'Category',
    'Party',
    'Reference',
    'Activity',
    'Notes',
    ...(includeBalance ? ['Balance'] : []),
  ];

  const rows = sorted.map((t) => {
    const fields = [
      t.date,
      t.description,
      toAmountString(t.amount) ?? t.amount,
      t.type,
      t.status,
      t.category || '',
      t.party || '',
      t.reference || '',
      t.activity || '',
      t.notes || '',
    ];
    if (includeBalance) {
      fields.push((balances.get(t.id) ?? 0).toFixed(2));
    }
    return fields.join('\t');
  });

  return [headers.join('\t'), ...rows].join('\n');
}

export async function saveExport(
  content: string,
  defaultName: string,
  filters: { name: string; extensions: string[] }[],
): Promise<boolean> {
  const result = await window.api.showSaveDialog({
    title: 'Export',
    defaultPath: defaultName,
    filters,
  });

  if (result.canceled || !result.filePath) return false;

  await window.api.writeFile(result.filePath, content);
  return true;
}
