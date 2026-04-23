import { useMemo, useState, useCallback } from 'react';
import { useTransactionStore } from '@/stores/transaction-store';
import { useSheetStore } from '@/stores/sheet-store';
import { usePlannedStore } from '@/stores/planned-store';
import { computeTotal } from '@/services/balance';
import { expandTemplate } from '@/services/forecast';
import {
  computeDailyBalances,
  groupByMonth,
  groupByCategory,
  toISODate,
  getFYStart,
  getFYEnd,
} from '@/lib/chart-utils';
import { useUiStore } from '@/stores/ui-store';
import { useViewData } from '@/hooks/useViewData';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ReportFilterBar } from '@/components/ReportFilterBar';
import { OverviewTab } from '@/components/reports/OverviewTab';
import { BreakdownsTab } from '@/components/reports/BreakdownsTab';
import { ChartsTab } from '@/components/reports/ChartsTab';
import { ExportTab } from '@/components/reports/ExportTab';

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
  const [activeTab, setActiveTab] = useState('overview');

  useViewData([loadSheets, loadPlanned], loadAll, currentSheet);

  // Available activities
  const activities = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) {
      if (t.activity?.trim()) set.add(t.activity.trim());
    }
    return [...set].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [transactions]);

  // Filtered transactions
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

  // Stats
  const stats = useMemo(() => {
    let income = 0;
    let expenses = 0;
    for (const t of filteredTransactions) {
      const amt = parseFloat(t.amount) || 0;
      if (t.type === 'income') income += amt;
      else expenses += amt;
    }
    const net = income - expenses;
    const balance = computeTotal(filteredTransactions);
    return { count: filteredTransactions.length, income, expenses, net, balance };
  }, [filteredTransactions]);

  // Chart data
  const balanceTrendData = useMemo(
    () => computeDailyBalances(transactions, startDate, endDate),
    [transactions, startDate, endDate],
  );

  const incomeVsExpenseData = useMemo(
    () => groupByMonth(filteredTransactions),
    [filteredTransactions],
  );

  const expensesByCategoryData = useMemo(
    () => groupByCategory(filteredTransactions, 'expense'),
    [filteredTransactions],
  );

  const incomesByCategoryData = useMemo(
    () => groupByCategory(filteredTransactions, 'income'),
    [filteredTransactions],
  );

  // Planned data for report builder
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

  // Quick presets
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
      </header>

      <main className="flex-1 overflow-auto p-6 space-y-4">
        <ReportFilterBar
          startDate={startDate}
          endDate={endDate}
          activityFilter={activityFilter}
          activities={activities}
          transactionCount={filteredTransactions.length}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onActivityFilterChange={setActivityFilter}
          onPresetThisMonth={presetThisMonth}
          onPresetLastMonth={presetLastMonth}
          onPresetYTD={presetYTD}
          onPresetFinancialYear={presetFinancialYear}
          onPresetAll={presetAll}
        />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="breakdowns">Breakdowns</TabsTrigger>
            <TabsTrigger value="charts">Charts</TabsTrigger>
            <TabsTrigger value="export">Export</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab
              stats={stats}
              balanceTrendData={balanceTrendData}
              incomeVsExpenseData={incomeVsExpenseData}
            />
          </TabsContent>

          <TabsContent value="breakdowns">
            <BreakdownsTab transactions={filteredTransactions} />
          </TabsContent>

          <TabsContent value="charts">
            <ChartsTab
              balanceTrendData={balanceTrendData}
              incomeVsExpenseData={incomeVsExpenseData}
              expensesByCategoryData={expensesByCategoryData}
              incomesByCategoryData={incomesByCategoryData}
            />
          </TabsContent>

          <TabsContent value="export">
            <ExportTab
              filteredTransactions={filteredTransactions}
              allTransactions={transactions}
              startDate={startDate}
              endDate={endDate}
              sheetName={sheetName}
              plannedData={plannedDataForReport}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
