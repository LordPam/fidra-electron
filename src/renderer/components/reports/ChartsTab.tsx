import { BalanceTrendChart } from '@/components/BalanceTrendChart';
import { IncomeVsExpenseChart } from '@/components/IncomeVsExpenseChart';
import { ExpensesByCategoryChart } from '@/components/ExpensesByCategoryChart';
import type { DailyBalance, MonthlyData, CategoryData } from '@/lib/chart-utils';

interface ChartsTabProps {
  balanceTrendData: DailyBalance[];
  incomeVsExpenseData: MonthlyData[];
  expensesByCategoryData: CategoryData[];
  incomesByCategoryData: CategoryData[];
}

export function ChartsTab({
  balanceTrendData,
  incomeVsExpenseData,
  expensesByCategoryData,
  incomesByCategoryData,
}: ChartsTabProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="rounded-lg border border-border-subtle p-4">
        <h3 className="text-sm font-display font-semibold mb-3">Balance Trend</h3>
        <div className="h-[300px]">
          <BalanceTrendChart data={balanceTrendData} />
        </div>
      </div>
      <div className="rounded-lg border border-border-subtle p-4">
        <h3 className="text-sm font-display font-semibold mb-3">Income vs Expenses by Month</h3>
        <div className="h-[300px]">
          <IncomeVsExpenseChart data={incomeVsExpenseData} />
        </div>
      </div>
      <div className="rounded-lg border border-border-subtle p-4">
        <h3 className="text-sm font-display font-semibold mb-3">Expenses by Category</h3>
        <div className="h-[300px]">
          <ExpensesByCategoryChart data={expensesByCategoryData} title="Expenses" />
        </div>
      </div>
      <div className="rounded-lg border border-border-subtle p-4">
        <h3 className="text-sm font-display font-semibold mb-3">Income by Category</h3>
        <div className="h-[300px]">
          <ExpensesByCategoryChart data={incomesByCategoryData} title="Income" />
        </div>
      </div>
    </div>
  );
}
