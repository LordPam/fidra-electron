import { useMemo, useState, useCallback } from 'react';
import { useTransactionStore } from '@/stores/transaction-store';
import { useSheetStore } from '@/stores/sheet-store';
import { usePlannedStore } from '@/stores/planned-store';
import { expandTemplate } from '@/services/forecast';
import { computeTotal, computePendingTotal } from '@/services/balance';
import {
  computeDailyBalances,
  groupByMonth,
  toISODate,
  getFYStart,
  getFYEnd,
} from '@/lib/chart-utils';
import { useUiStore } from '@/stores/ui-store';
import { useViewData } from '@/hooks/useViewData';

import { ReportFilterBar } from '@/components/ReportFilterBar';
import type { ComparisonMode } from '@/components/ReportFilterBar';
import { SummaryBand } from '@/components/reports/SummaryBand';
import { InsightsPanel } from '@/components/reports/InsightsPanel';
import { CategoryBreakdown } from '@/components/reports/CategoryBreakdown';
import { ActivityBreakdown } from '@/components/reports/ActivityBreakdown';
import { DescriptionBreakdown } from '@/components/reports/DescriptionBreakdown';
import { PartyBreakdown } from '@/components/reports/PartyBreakdown';
import { ReportExportDropdown } from '@/components/reports/ReportExportDropdown';
import { CustomReportDialog } from '@/dialogs/CustomReportDialog';
import { BalanceTrendChart } from '@/components/BalanceTrendChart';
import { IncomeVsExpenseChart } from '@/components/IncomeVsExpenseChart';
import {
  getComparisonPeriod,
  getFYComparisonPeriod,
  computeSummaryWithDeltas,
  buildCategoryBreakdownWithDeltas,
  buildActivityBreakdownWithDeltas,
  buildDescriptionBreakdown,
  buildPartyBreakdown,
} from '@/services/report-analysis';
import {
  generateWhatChanged,
  generateKeyFacts,
  computeHealthStatus,
} from '@/services/report-insights';

export default function ReportsView() {
  const { transactions, loadAll } = useTransactionStore();
  const { currentSheet, loadAll: loadSheets } = useSheetStore();
  const { templates, loadAll: loadPlanned } = usePlannedStore();
  const fyStartMonth = useUiStore((s) => s.fyStartMonth);

  // Local filter state
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [endDate, setEndDate] = useState(() => toISODate(new Date()));
  const [activityFilter, setActivityFilter] = useState<string>('__all__');
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('none');
  const [customReportOpen, setCustomReportOpen] = useState(false);

  useViewData([loadSheets, loadPlanned], loadAll, currentSheet);

  // Available activities
  const activities = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) {
      if (t.activity?.trim()) set.add(t.activity.trim());
    }
    return [...set].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [transactions]);

  // Filtered transactions (current period)
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (t.status === 'planned') return false;
      if (t.date < startDate || t.date > endDate) return false;
      if (activityFilter !== '__all__') {
        if (!t.activity || t.activity.trim() !== activityFilter) return false;
      }
      return true;
    });
  }, [transactions, startDate, endDate, activityFilter]);

  // Comparison period
  const comparisonPeriod = useMemo(() => {
    if (comparisonMode === 'none') return null;
    if (comparisonMode === 'fy') {
      return getFYComparisonPeriod(startDate, endDate, fyStartMonth);
    }
    return getComparisonPeriod(startDate, endDate);
  }, [startDate, endDate, comparisonMode, fyStartMonth]);

  const comparisonTransactions = useMemo(() => {
    if (!comparisonPeriod) return null;
    return transactions.filter((t) => {
      if (t.status === 'planned') return false;
      if (t.date < comparisonPeriod.start || t.date > comparisonPeriod.end) return false;
      if (activityFilter !== '__all__') {
        if (!t.activity || t.activity.trim() !== activityFilter) return false;
      }
      return true;
    });
  }, [transactions, comparisonPeriod, activityFilter]);

  // Summary
  const summaryData = useMemo(
    () => computeSummaryWithDeltas(filteredTransactions, comparisonTransactions),
    [filteredTransactions, comparisonTransactions],
  );

  // Financial Health
  const currentBalance = useMemo(() => computeTotal(transactions), [transactions]);
  const pendingExpenses = useMemo(() => computePendingTotal(transactions), [transactions]);
  const availableBalance = currentBalance - pendingExpenses;

  const upcomingPlanned = useMemo(() => {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 30);
    const horizonStr = toISODate(horizon);
    const todayStr = toISODate(new Date());
    const filteredTemplates =
      currentSheet === 'All Sheets'
        ? templates
        : templates.filter((t) => t.target_sheet === currentSheet);

    let nearest: { amount: number; daysUntil: number } | null = null;
    for (const tmpl of filteredTemplates) {
      if (tmpl.type !== 'expense') continue;
      for (const inst of expandTemplate(tmpl, horizonStr, false)) {
        if (inst.instanceDate >= todayStr) {
          const days = Math.ceil(
            (new Date(inst.instanceDate + 'T00:00:00').getTime() - new Date(todayStr + 'T00:00:00').getTime()) / 86400000,
          );
          const amt = parseFloat(inst.transaction.amount) || 0;
          if (!nearest || days < nearest.daysUntil) nearest = { amount: amt, daysUntil: days };
        }
      }
    }
    return nearest;
  }, [templates, currentSheet]);

  const healthStatus = useMemo(
    () => computeHealthStatus(currentBalance, summaryData.current.net, pendingExpenses, upcomingPlanned),
    [currentBalance, summaryData.current.net, pendingExpenses, upcomingPlanned],
  );

  // Charts
  const balanceTrendData = useMemo(
    () => computeDailyBalances(transactions, startDate, endDate),
    [transactions, startDate, endDate],
  );
  const incomeVsExpenseData = useMemo(
    () => groupByMonth(filteredTransactions, { excludeTransfers: true }),
    [filteredTransactions],
  );

  // Breakdowns
  const incomeBreakdown = useMemo(
    () => buildCategoryBreakdownWithDeltas(filteredTransactions, comparisonTransactions, 'INCOME'),
    [filteredTransactions, comparisonTransactions],
  );
  const expenseBreakdown = useMemo(
    () => buildCategoryBreakdownWithDeltas(filteredTransactions, comparisonTransactions, 'EXPENSE'),
    [filteredTransactions, comparisonTransactions],
  );
  const activityBreakdown = useMemo(
    () => buildActivityBreakdownWithDeltas(filteredTransactions, comparisonTransactions),
    [filteredTransactions, comparisonTransactions],
  );
  const descriptionBreakdown = useMemo(
    () => buildDescriptionBreakdown(filteredTransactions, comparisonTransactions),
    [filteredTransactions, comparisonTransactions],
  );
  const partyBreakdown = useMemo(
    () => buildPartyBreakdown(filteredTransactions),
    [filteredTransactions],
  );

  // Insights
  const whatChanged = useMemo(
    () => generateWhatChanged(summaryData, incomeBreakdown, expenseBreakdown),
    [summaryData, incomeBreakdown, expenseBreakdown],
  );
  const uncategorizedCount = useMemo(
    () => filteredTransactions.filter((t) => !t.category || t.category === 'Other').length,
    [filteredTransactions],
  );
  const keyFacts = useMemo(
    () => generateKeyFacts(summaryData, activityBreakdown, expenseBreakdown, incomeBreakdown, descriptionBreakdown, uncategorizedCount),
    [summaryData, activityBreakdown, expenseBreakdown, incomeBreakdown, descriptionBreakdown, uncategorizedCount],
  );

  // Planned data for export
  const plannedDataForReport = useMemo(() => {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 90);
    const horizonStr = toISODate(horizon);
    const filteredTemplates =
      currentSheet === 'All Sheets'
        ? templates
        : templates.filter((t) => t.target_sheet === currentSheet);
    return filteredTemplates
      .flatMap((t) => expandTemplate(t, horizonStr, false))
      .sort((a, b) => a.instanceDate.localeCompare(b.instanceDate))
      .map((inst) => ({
        description: inst.transaction.description,
        date: inst.instanceDate,
        amount: inst.transaction.amount,
        type: inst.transaction.type,
      }));
  }, [templates, currentSheet]);

  // Presets
  const presetThisMonth = useCallback(() => {
    const now = new Date();
    setStartDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
    setEndDate(toISODate(now));
  }, []);
  const presetLastMonth = useCallback(() => {
    const now = new Date();
    const firstOfThis = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastOfPrev = new Date(firstOfThis.getTime() - 86400000);
    const firstOfPrev = new Date(lastOfPrev.getFullYear(), lastOfPrev.getMonth(), 1);
    setStartDate(toISODate(firstOfPrev));
    setEndDate(toISODate(lastOfPrev));
  }, []);
  const presetQuarter = useCallback(() => {
    const now = new Date();
    const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    setStartDate(toISODate(qStart));
    setEndDate(toISODate(now));
  }, []);
  const presetYTD = useCallback(() => {
    setStartDate(getFYStart(fyStartMonth));
    setEndDate(toISODate(new Date()));
  }, [fyStartMonth]);
  const presetFinancialYear = useCallback(() => {
    setStartDate(getFYStart(fyStartMonth));
    setEndDate(getFYEnd(fyStartMonth));
  }, [fyStartMonth]);
  const presetAll = useCallback(() => {
    if (transactions.length === 0) return;
    const dates = transactions.map((t) => t.date).sort();
    setStartDate(dates[0]);
    setEndDate(dates[dates.length - 1]);
  }, [transactions]);

  const sheetName = currentSheet === 'All Sheets' ? undefined : currentSheet;

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-3 px-6 py-3 border-b border-border-subtle bg-surface-raised shrink-0">
        <h1 className="text-xl font-display font-semibold">Reports</h1>
        {sheetName && (
          <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">
            {sheetName}
          </span>
        )}
        <div className="flex-1" />
        <ReportExportDropdown
          filteredTransactions={filteredTransactions}
          allTransactions={transactions}
          startDate={startDate}
          endDate={endDate}
          sheetName={sheetName}
          plannedData={plannedDataForReport}
          onCustomReport={() => setCustomReportOpen(true)}
        />
      </header>

      <main className="flex-1 overflow-auto p-6 space-y-5">
        {/* Filter bar */}
        <ReportFilterBar
          startDate={startDate}
          endDate={endDate}
          activityFilter={activityFilter}
          activities={activities}
          transactionCount={filteredTransactions.length}
          comparisonMode={comparisonMode}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onActivityFilterChange={setActivityFilter}
          onComparisonModeChange={setComparisonMode}
          onPresetThisMonth={presetThisMonth}
          onPresetLastMonth={presetLastMonth}
          onPresetQuarter={presetQuarter}
          onPresetYTD={presetYTD}
          onPresetFinancialYear={presetFinancialYear}
          onPresetAll={presetAll}
        />

        {/* 1. Financial Health — the headline */}
        <SummaryBand
          currentBalance={currentBalance}
          availableBalance={availableBalance}
          periodNet={summaryData.current.net}
          health={healthStatus}
        />

        {/* 2. What Changed + Key Facts */}
        <InsightsPanel whatChanged={whatChanged} keyFacts={keyFacts} />

        {/* 3. Activity Performance */}
        <ActivityBreakdown
          rows={activityBreakdown}
          collapsible={false}
          title="Activity Performance"
        />

        {/* 4. Trends */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg bg-card border border-border-subtle p-4">
            <h3 className="text-sm font-display font-medium text-muted-foreground mb-2">
              Balance Trend
            </h3>
            <div className="h-[260px]">
              <BalanceTrendChart data={balanceTrendData} />
            </div>
          </div>
          <div className="rounded-lg bg-card border border-border-subtle p-4">
            <h3 className="text-sm font-display font-medium text-muted-foreground mb-2">
              Income vs Expenses
            </h3>
            <div className="h-[260px]">
              <IncomeVsExpenseChart data={incomeVsExpenseData} />
            </div>
          </div>
        </div>

        {/* 5. Breakdown Explorer */}
        <div className="rounded-lg bg-card border border-border-subtle p-4">
          <h3 className="text-sm font-display font-medium text-muted-foreground mb-4">
            Breakdown Explorer
          </h3>
          <div className="space-y-1">
            <CategoryBreakdown incomeRows={incomeBreakdown} expenseRows={expenseBreakdown} />
            <DescriptionBreakdown rows={descriptionBreakdown} />
            <PartyBreakdown rows={partyBreakdown} />
          </div>
        </div>
      </main>

      <CustomReportDialog
        open={customReportOpen}
        onOpenChange={setCustomReportOpen}
        allTransactions={transactions}
        sheetName={sheetName}
        plannedData={plannedDataForReport}
      />
    </div>
  );
}
