import { MetricCard } from '@/components/MetricCard';
import { BalanceTrendChart } from '@/components/BalanceTrendChart';
import { IncomeVsExpenseChart } from '@/components/IncomeVsExpenseChart';
import { formatCurrency } from '@/lib/format';
import type { DailyBalance, MonthlyData } from '@/lib/chart-utils';

interface OverviewTabProps {
  stats: {
    count: number;
    income: number;
    expenses: number;
    net: number;
    balance: number;
  };
  balanceTrendData: DailyBalance[];
  incomeVsExpenseData: MonthlyData[];
}

export function OverviewTab({ stats, balanceTrendData, incomeVsExpenseData }: OverviewTabProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-3">
        <MetricCard title="Transactions" value={String(stats.count)} />
        <MetricCard title="Total Income" value={formatCurrency(stats.income)} variant="positive" />
        <MetricCard
          title="Total Expenses"
          value={formatCurrency(stats.expenses)}
          variant="negative"
        />
        <MetricCard
          title="Net Change"
          value={`${stats.net >= 0 ? '+' : ''}${formatCurrency(stats.net)}`}
          variant={stats.net >= 0 ? 'positive' : 'negative'}
        />
        <MetricCard
          title="Period Balance"
          value={`${stats.balance >= 0 ? '+' : ''}${formatCurrency(stats.balance)}`}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-border-subtle p-4">
          <h3 className="text-sm font-display font-semibold mb-3">Balance Trend</h3>
          <div className="h-[300px]">
            <BalanceTrendChart data={balanceTrendData} />
          </div>
        </div>
        <div className="rounded-lg border border-border-subtle p-4">
          <h3 className="text-sm font-display font-semibold mb-3">Income vs Expenses</h3>
          <div className="h-[300px]">
            <IncomeVsExpenseChart data={incomeVsExpenseData} />
          </div>
        </div>
      </div>
    </div>
  );
}
