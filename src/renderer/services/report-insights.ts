import { formatCurrency } from '@/lib/format';
import type {
  SummaryWithDeltas,
  CategoryBreakdownRow,
  ActivityBreakdownRow,
  DescriptionBreakdownRow,
} from './report-analysis';

// --- What Changed (comparison-dependent) ---

export interface WhatChangedItem {
  label: string;
  delta: number; // signed amount
  direction: 'up' | 'down';
}

export function generateWhatChanged(
  summary: SummaryWithDeltas,
  incomeBreakdown: CategoryBreakdownRow[],
  expenseBreakdown: CategoryBreakdownRow[],
): WhatChangedItem[] {
  if (!summary.deltas) return [];

  const items: WhatChangedItem[] = [];

  // Income and expense totals
  const incomeDelta = summary.deltas.totalIncome.absolute;
  if (incomeDelta !== 0) {
    items.push({
      label: 'Income',
      delta: incomeDelta,
      direction: incomeDelta > 0 ? 'up' : 'down',
    });
  }

  const expenseDelta = summary.deltas.totalExpenditure.absolute;
  if (expenseDelta !== 0) {
    items.push({
      label: 'Expenses',
      delta: expenseDelta,
      direction: expenseDelta > 0 ? 'up' : 'down',
    });
  }

  // Top category movers (flagged = >25% change)
  const movers = [...incomeBreakdown, ...expenseBreakdown]
    .filter((r) => r.delta !== null && r.status === 'flagged' && Math.abs(r.delta!.absolute) > 0)
    .sort((a, b) => Math.abs(b.delta!.absolute) - Math.abs(a.delta!.absolute))
    .slice(0, 4);

  for (const m of movers) {
    items.push({
      label: m.category,
      delta: m.delta!.absolute,
      direction: m.delta!.absolute > 0 ? 'up' : 'down',
    });
  }

  return items;
}

// --- Key Facts (always available, no comparison needed) ---

export interface KeyFact {
  label: string;
  value: string;
  detail?: string;
}

export function generateKeyFacts(
  summary: SummaryWithDeltas,
  activityBreakdown: ActivityBreakdownRow[],
  expenseBreakdown: CategoryBreakdownRow[],
  incomeBreakdown: CategoryBreakdownRow[],
  descriptionBreakdown: DescriptionBreakdownRow[],
  uncategorizedCount: number,
): KeyFact[] {
  const facts: KeyFact[] = [];
  const { current } = summary;

  if (current.transactionCount === 0) return facts;

  // Largest activity by volume
  if (activityBreakdown.length > 0) {
    const top = [...activityBreakdown].sort(
      (a, b) => (b.income + b.expenditure) - (a.income + a.expenditure),
    )[0];
    facts.push({
      label: 'Largest activity',
      value: top.activity,
      detail: `${top.net >= 0 ? '+' : ''}${formatCurrency(top.net)} net`,
    });
  }

  // Largest expense category
  const topExpense = expenseBreakdown.find((r) => r.count > 0);
  if (topExpense) {
    facts.push({
      label: 'Largest expense category',
      value: `${topExpense.category} (${formatCurrency(topExpense.total)})`,
    });
  }

  // Largest income source
  const topIncome = incomeBreakdown.find((r) => r.count > 0);
  if (topIncome) {
    facts.push({
      label: 'Largest income source',
      value: `${topIncome.category} (${formatCurrency(topIncome.total)})`,
    });
  }

  // Most common description
  const topDesc = descriptionBreakdown.find((r) => r.count >= 2);
  if (topDesc) {
    facts.push({
      label: 'Most common description',
      value: `${topDesc.description} (${topDesc.count}x)`,
    });
  }

  // Uncategorized warning
  if (uncategorizedCount > 0) {
    facts.push({
      label: 'Uncategorized',
      value: `${uncategorizedCount} transaction${uncategorizedCount === 1 ? '' : 's'}`,
    });
  }

  return facts;
}

// --- Financial Health status ---

export interface HealthStatus {
  level: 'healthy' | 'caution' | 'warning';
  notes: string[];
}

export function computeHealthStatus(
  currentBalance: number,
  periodNet: number,
  pendingExpenses: number,
  upcomingPlanned: { amount: number; daysUntil: number } | null,
): HealthStatus {
  const notes: string[] = [];

  // Cashflow
  if (periodNet >= 0) {
    notes.push('Positive cashflow this period.');
  } else {
    notes.push(`Negative cashflow: spending exceeds income by ${formatCurrency(Math.abs(periodNet))}.`);
  }

  // Pending
  if (pendingExpenses > 0) {
    notes.push(`${formatCurrency(pendingExpenses)} in pending expenses awaiting approval.`);
  }

  // Upcoming planned
  if (upcomingPlanned) {
    notes.push(
      `${formatCurrency(upcomingPlanned.amount)} planned expense due in ${upcomingPlanned.daysUntil} day${upcomingPlanned.daysUntil === 1 ? '' : 's'}.`,
    );
  }

  // Determine level
  let level: HealthStatus['level'] = 'healthy';
  if (currentBalance < 0) {
    level = 'warning';
  } else if (periodNet < 0) {
    level = 'caution';
  }

  return { level, notes };
}
