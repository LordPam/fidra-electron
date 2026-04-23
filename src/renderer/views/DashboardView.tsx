import { useEffect, useMemo, useCallback, useState } from 'react';
import type { TransactionRow } from '../../shared/ipc-types';
import { useNavigate } from 'react-router-dom';
import { useTransactionStore } from '@/stores/transaction-store';
import { useSheetStore } from '@/stores/sheet-store';
import { usePlannedStore } from '@/stores/planned-store';
import { useUndoStore } from '@/stores/undo-store';
import { useUiStore } from '@/stores/ui-store';
import { useAuthStore } from '@/stores/auth-store';
import { computeTotal, computePendingTotal } from '@/services/balance';
import { expandTemplate, getOverdueDate } from '@/services/forecast';
import { createBulkEditCommand } from '@/services/undo';
import { formatCurrency, formatDate } from '@/lib/format';
import { computeDailyBalances, groupByMonth, toISODate, getFYStart, getFYEnd } from '@/lib/chart-utils';
import type { PlannedTemplateRow } from '../../shared/ipc-types';
import { useViewData } from '@/hooks/useViewData';
import { useSheetFiltered } from '@/hooks/useSheetFiltered';

import { BalanceTrendChart } from '@/components/BalanceTrendChart';
import { IncomeVsExpenseChart } from '@/components/IncomeVsExpenseChart';
import { UndoRedoButtons } from '@/components/UndoRedoButtons';
import { Button } from '@/components/ui/button';
import { Check, X, AlertCircle, ArrowRight, Calendar, ArrowLeftRight, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUndoRedoShortcuts } from '@/hooks/useUndoRedoShortcuts';

type Period = 'month' | '90days' | 'fy';

function getPeriodRange(period: Period, fyStartMonth: number): {start: string; end: string; label: string} {
  const now = new Date();
  const today = toISODate(now);

  if (period === 'month') {
    const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    return {
      start,
      end: today,
      label: now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    };
  }

  if (period === '90days') {
    const s = new Date(now);
    s.setDate(s.getDate() - 90);
    return { start: toISODate(s), end: today, label: 'Last 90 days' };
  }

  // FY
  const fyStart = getFYStart(fyStartMonth);
  const fyEnd = getFYEnd(fyStartMonth);
  return {
    start: fyStart,
    end: fyEnd,
    label: (() => {
      const sy = fyStart.slice(0, 4);
      const ey = fyEnd.slice(0, 4);
      return sy === ey ? `FY ${sy}` : `FY ${sy}/${ey.slice(2)}`;
    })(),
  };
}

export default function DashboardView() {
  const { transactions, loading, loadAll } = useTransactionStore();
  const { currentSheet, loadAll: loadSheets } = useSheetStore();
  const { templates, loadAll: loadPlanned } = usePlannedStore();
  const { execute } = useUndoStore();
  useUndoRedoShortcuts();
  const { dashboardPeriod: period, setDashboardPeriod: setPeriod, fyStartMonth } = useUiStore();
  const currentPersonnel = useAuthStore((s) => s.currentPersonnel);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Local profile name for admin mode / offline greeting
  const [profileName, setProfileName] = useState<string | null>(null);
  useEffect(() => {
    window.api.getProfile().then((p) => {
      if (p.name) setProfileName(p.name);
    });
  }, []);
  const navigate = useNavigate();
  const [profileMissing, setProfileMissing] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      setProfileMissing(false);
      return;
    }
    window.api.getCurrentUser().then((user) => {
      setProfileMissing(!user);
    });
  }, [isAuthenticated]);

  useViewData([loadSheets, loadPlanned], loadAll, currentSheet);

  // Sheet-filtered transactions
  const getSheet = useCallback((t: TransactionRow) => t.sheet, []);
  const sheetFiltered = useSheetFiltered(transactions, currentSheet, getSheet);

  // Period range
  const periodRange = useMemo(() => getPeriodRange(period, fyStartMonth), [period, fyStartMonth]);

  // Period-filtered transactions (for stats)
  const periodFiltered = useMemo(() => {
    return sheetFiltered.filter(
      (t) => t.date >= periodRange.start && t.date <= periodRange.end && t.status !== 'planned',
    );
  }, [sheetFiltered, periodRange]);

  // Balance
  const balance = useMemo(() => computeTotal(sheetFiltered), [sheetFiltered]);
  const pending = useMemo(() => computePendingTotal(sheetFiltered), [sheetFiltered]);

  // Period stats
  const periodStats = useMemo(() => {
    let income = 0;
    let expenses = 0;
    let incomeCount = 0;
    let expenseCount = 0;
    for (const t of periodFiltered) {
      const amount = parseFloat(t.amount) || 0;
      if (t.type === 'income') {
        income += amount;
        incomeCount++;
      } else {
        expenses += amount;
        expenseCount++;
      }
    }
    return { net: income - expenses, income, expenses, incomeCount, expenseCount };
  }, [periodFiltered]);

  // FY label for balance subtitle
  const fyLabel = useMemo(() => {
    const sy = getFYStart(fyStartMonth).slice(0, 4);
    const ey = getFYEnd(fyStartMonth).slice(0, 4);
    return sy === ey ? `FY ${sy}` : `FY ${sy}/${ey.slice(2)}`;
  }, [fyStartMonth]);

  // Balance trend data (driven by period)
  const balanceTrendData = useMemo(() => {
    const now = new Date();
    const endDate = toISODate(now);
    if (period === 'month') {
      const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      return computeDailyBalances(sheetFiltered, start, endDate);
    }
    if (period === '90days') {
      const s = new Date(now);
      s.setDate(s.getDate() - 90);
      return computeDailyBalances(sheetFiltered, toISODate(s), endDate);
    }
    return computeDailyBalances(sheetFiltered, getFYStart(fyStartMonth), endDate);
  }, [sheetFiltered, period, fyStartMonth]);

  // Sparkline data for balance hero (last 30 days, compact)
  const sparklineData = useMemo(() => {
    const now = new Date();
    const s = new Date(now);
    s.setDate(s.getDate() - 30);
    return computeDailyBalances(sheetFiltered, toISODate(s), toISODate(now));
  }, [sheetFiltered]);

  // Income vs Expense data (last 6 months)
  const incomeVsExpenseData = useMemo(() => {
    const data = groupByMonth(sheetFiltered);
    return data.slice(-6);
  }, [sheetFiltered]);

  // Recent transactions (last 5 non-pending/rejected)
  const recentTransactions = useMemo(() => {
    return sheetFiltered
      .filter((t) => t.status !== 'pending' && t.status !== 'rejected' && t.status !== 'planned')
      .sort((a, b) => {
        const dc = b.date.localeCompare(a.date);
        if (dc !== 0) return dc;
        return b.created_at.localeCompare(a.created_at);
      })
      .slice(0, 5);
  }, [sheetFiltered]);

  // Upcoming planned (next 30 days, max 5)
  const upcomingPlanned = useMemo(() => {
    const now = new Date();
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + 30);
    const horizonStr = toISODate(horizon);

    const filteredTemplates =
      currentSheet === 'All Sheets'
        ? templates
        : templates.filter((t) => t.target_sheet === currentSheet);

    const instances = filteredTemplates.flatMap((t) => expandTemplate(t, horizonStr, false));
    instances.sort((a, b) => a.instanceDate.localeCompare(b.instanceDate));
    return instances.slice(0, 5);
  }, [templates, currentSheet]);

  // Pending transactions
  const pendingTransactions = useMemo(() => {
    return sheetFiltered
      .filter((t) => t.status === 'pending')
      .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));
  }, [sheetFiltered]);

  const totalPendingCount = pendingTransactions.length;

  // Overdue planned templates
  const overdueTemplates = useMemo(() => {
    const filtered = currentSheet === 'All Sheets'
      ? templates
      : templates.filter((t) => t.target_sheet === currentSheet);
    return filtered
      .map((t) => ({ template: t, overdueDate: getOverdueDate(t) }))
      .filter((item): item is { template: PlannedTemplateRow; overdueDate: string } => item.overdueDate !== null)
      .sort((a, b) => a.overdueDate.localeCompare(b.overdueDate));
  }, [templates, currentSheet]);

  // Needs attention: profile missing + pending txns + overdue planned, capped at 5 total
  const needsAttentionCount = (profileMissing ? 1 : 0) + totalPendingCount + overdueTemplates.length;
  const maxDisplay = 5;
  const profileSlot = profileMissing ? 1 : 0;
  const pendingSlots = Math.max(0, maxDisplay - profileSlot);
  const displayedPending = pendingTransactions.slice(0, pendingSlots);
  const overdueSlots = Math.max(0, maxDisplay - profileSlot - displayedPending.length);
  const displayedOverdue = overdueTemplates.slice(0, overdueSlots);

  // Approve/Reject handlers
  const handleSetStatus = useCallback(
    async (transaction: TransactionRow, status: 'approved' | 'rejected') => {
      const now = new Date().toISOString();
      const updated: TransactionRow = {
        ...transaction,
        status,
        modified_at: now,
        version: transaction.version + 1,
      };
      if (status === 'approved') {
        const txSettings = await window.api.getTransactionSettings();
        if (txSettings.dateOnApprove) {
          updated.date = now.slice(0, 10);
        }
      }
      await execute(createBulkEditCommand([transaction], [updated]));
    },
    [execute],
  );

  const formatSignedAmount = (t: TransactionRow | { type: string; amount: string }) => {
    const sign = t.type === 'income' ? '+' : '-';
    return `${sign}${formatCurrency(t.amount)}`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-3 border-b border-border-subtle bg-surface-raised shrink-0">
        <h1 className="text-xl font-display font-semibold">
          {currentPersonnel
            ? `Welcome back, ${currentPersonnel.name.split(' ')[0]}`
            : profileName
              ? `Welcome back, ${profileName.split(' ')[0]}`
              : 'Dashboard'}
        </h1>

        <div className="flex-1" />

        {/* Period switcher */}
        <div className="flex items-center rounded-md border border-border-subtle bg-surface-inset p-0.5 gap-0.5">
          {(['month', '90days', 'fy'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                'px-2.5 py-1 text-xs font-display font-medium rounded transition-fidra',
                period === p
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p === 'month' ? 'This month' : p === '90days' ? '90 days' : 'FY'}
            </button>
          ))}
        </div>
        <UndoRedoButtons showDescriptions={false} withSeparators={false} />
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6 space-y-5">
        {/* Top row: Balance hero + Income + Expenses */}
        <div className="grid grid-cols-12 gap-4">
          {/* Balance Hero Card */}
          <div className="col-span-6 rounded-lg border border-border-subtle bg-gradient-to-br from-card to-surface-inset p-5 border-t-[3px] border-t-fidra-teal relative overflow-hidden">
            <p className="text-xs font-display font-medium uppercase tracking-[0.05em] text-muted-foreground mb-1">
              Current Balance
            </p>
            <p className={cn(
              'text-4xl font-display font-bold tabular-nums tracking-tight',
              balance < 0 && 'text-fidra-negative',
            )}>
              {formatCurrency(balance)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {fyLabel}
              {pending > 0 && (
                <span className="ml-2 text-fidra-warning">
                  {formatCurrency(pending)} pending
                </span>
              )}
            </p>
            {/* Mini sparkline */}
            <div className="h-[40px] mt-2 -mx-1">
              <BalanceTrendChart data={sparklineData} compact />
            </div>
          </div>

          {/* Income card */}
          <div className="col-span-3 rounded-lg bg-card border border-border-subtle p-4 border-t-[3px] border-t-fidra-teal flex flex-col justify-center">
            <div className="flex items-center justify-between">
              <p className="text-xs font-display font-medium uppercase tracking-[0.05em] text-muted-foreground">
                Income
              </p>
              <span className="text-xs text-muted-foreground">
                {periodStats.incomeCount} txn{periodStats.incomeCount !== 1 ? 's' : ''}
              </span>
            </div>
            <p className="text-2xl font-display font-bold tabular-nums mt-1">
              {formatCurrency(periodStats.income)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{periodRange.label}</p>
          </div>

          {/* Expenses card */}
          <div className="col-span-3 rounded-lg bg-card border border-border-subtle p-4 border-t-[3px] border-t-fidra-negative flex flex-col justify-center">
            <div className="flex items-center justify-between">
              <p className="text-xs font-display font-medium uppercase tracking-[0.05em] text-muted-foreground">
                Expenses
              </p>
              <span className="text-xs text-muted-foreground">
                {periodStats.expenseCount} txn{periodStats.expenseCount !== 1 ? 's' : ''}
              </span>
            </div>
            <p className="text-2xl font-display font-bold tabular-nums mt-1">
              {formatCurrency(periodStats.expenses)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{periodRange.label}</p>
          </div>
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-2 gap-4" style={{ minHeight: 280 }}>
          {/* Balance Trend */}
          <div className="rounded-lg bg-card border border-border-subtle p-4">
            <h3 className="text-sm font-display font-medium text-muted-foreground mb-2">
              Balance Trend
              <span className="ml-1.5 text-xs font-normal">({periodRange.label})</span>
            </h3>
            <div className="h-[220px]">
              <BalanceTrendChart data={balanceTrendData} />
            </div>
          </div>

          {/* Income vs Expenses */}
          <div className="rounded-lg bg-card border border-border-subtle p-4">
            <h3 className="text-sm font-display font-medium text-muted-foreground mb-2">
              Income vs Expenses
              <span className="ml-1.5 text-xs font-normal">(last 6 months)</span>
            </h3>
            <div className="h-[220px]">
              <IncomeVsExpenseChart data={incomeVsExpenseData} />
            </div>
          </div>
        </div>

        {/* Bottom row: Needs Attention + Recent + Upcoming */}
        <div className="grid grid-cols-3 gap-4">
          {/* Needs Attention */}
          <div className="rounded-lg bg-card border border-border-subtle p-4 flex flex-col">
            <div className="flex items-center gap-1.5 mb-3">
              {needsAttentionCount > 0 && (
                <AlertCircle className="h-3.5 w-3.5 text-fidra-warning" />
              )}
              <h3 className="text-sm font-display font-medium text-muted-foreground">
                Needs Attention
              </h3>
            </div>
            <div className="flex-1 space-y-1 overflow-auto">
              {needsAttentionCount === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  All clear
                </p>
              ) : (
                <>
                  {profileMissing && (
                    <div
                      className="flex items-center gap-2 py-2 px-2 rounded hover:bg-muted/50 cursor-pointer"
                      onClick={() => navigate('/settings')}
                    >
                      <User className="h-3 w-3 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">Set up your profile</p>
                        <span className="text-xs text-muted-foreground">Add your name and initials</span>
                      </div>
                      <ArrowRight className="h-3 w-3 text-fidra-teal shrink-0" />
                    </div>
                  )}
                  {displayedPending.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center gap-2 py-2 px-2 rounded hover:bg-muted/50 group"
                    >
                      <ArrowLeftRight className="h-3 w-3 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{t.description}</p>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">{formatDate(t.date)}</span>
                          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-fidra-warning/15 text-fidra-warning font-medium">
                            Pending
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 opacity-0 group-hover:opacity-100 text-fidra-positive hover:text-fidra-positive"
                          onClick={() => handleSetStatus(t, 'approved')}
                          title="Approve"
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 opacity-0 group-hover:opacity-100 text-fidra-negative hover:text-fidra-negative"
                          onClick={() => handleSetStatus(t, 'rejected')}
                          title="Reject"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                      <span className="text-xs font-mono tabular-nums whitespace-nowrap text-muted-foreground w-16 text-right shrink-0">
                        {formatCurrency(t.amount)}
                      </span>
                    </div>
                  ))}
                  {displayedOverdue.map(({ template, overdueDate }) => (
                    <div
                      key={template.id}
                      className="flex items-center gap-2 py-2 px-2 rounded hover:bg-muted/50 cursor-pointer"
                      onClick={() => navigate('/planned', { state: { selectTemplateId: template.id } })}
                    >
                      <Calendar className="h-3 w-3 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{template.description}</p>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">{formatDate(overdueDate)}</span>
                          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-fidra-warning/15 text-fidra-warning font-medium">
                            Overdue
                          </span>
                        </div>
                      </div>
                      <span className="text-xs font-mono tabular-nums whitespace-nowrap text-muted-foreground w-16 text-right shrink-0">
                        {formatCurrency(template.amount)}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
            {needsAttentionCount > maxDisplay && (
              <button
                onClick={() => navigate(overdueTemplates.length > totalPendingCount ? '/planned' : '/transactions')}
                className="flex items-center gap-1 text-xs text-fidra-teal hover:underline mt-1.5 self-end"
              >
                {needsAttentionCount - displayedPending.length - displayedOverdue.length} more
                <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Recent Transactions */}
          <div className="rounded-lg bg-card border border-border-subtle p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-display font-medium text-muted-foreground">
                Recent Transactions
              </h3>
              <button
                onClick={() => navigate('/transactions')}
                className="flex items-center gap-1 text-xs text-fidra-teal hover:underline"
              >
                View all
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            <div className="space-y-0.5">
              {recentTransactions.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  No recent transactions
                </p>
              ) : (
                recentTransactions.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 py-2 px-2 rounded hover:bg-muted/50">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{t.description}</p>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">{formatDate(t.date)}</span>
                        {t.category && (
                          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-fidra-teal/10 text-fidra-teal font-medium">
                            {t.category}
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={cn(
                        'text-sm font-mono tabular-nums whitespace-nowrap',
                        t.type === 'income' ? 'text-fidra-teal' : 'text-foreground',
                      )}
                    >
                      {formatSignedAmount(t)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Upcoming Planned */}
          <div className="rounded-lg bg-card border border-border-subtle p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-display font-medium text-muted-foreground">
                Upcoming Planned
              </h3>
              <button
                onClick={() => navigate('/planned')}
                className="flex items-center gap-1 text-xs text-fidra-teal hover:underline"
              >
                View all
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            <div className="space-y-0.5">
              {upcomingPlanned.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  No upcoming transactions
                </p>
              ) : (
                upcomingPlanned.map((inst) => (
                  <div key={`${inst.transaction.id}-${inst.instanceDate}`} className="flex items-center gap-3 py-2 px-2 rounded hover:bg-muted/50">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{inst.transaction.description}</p>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          {formatDate(inst.instanceDate)}
                        </span>
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-fidra-teal/10 text-fidra-teal">
                          planned
                        </span>
                      </div>
                    </div>
                    <span
                      className={cn(
                        'text-sm font-mono tabular-nums whitespace-nowrap',
                        inst.transaction.type === 'income'
                          ? 'text-fidra-teal'
                          : 'text-foreground',
                      )}
                    >
                      {formatSignedAmount(inst.transaction)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
