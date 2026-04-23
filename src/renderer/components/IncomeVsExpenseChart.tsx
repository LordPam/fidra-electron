import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import type { MonthlyData } from '@/lib/chart-utils';
import { ChartTooltip } from '@/components/ChartTooltip';

interface IncomeVsExpenseChartProps {
  data: MonthlyData[];
}

const LABEL_MAP = { income: 'Income', expense: 'Expenses' };

export function IncomeVsExpenseChart({ data }: IncomeVsExpenseChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No data for selected period
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 11 }}
          className="text-muted-foreground"
        />
        <YAxis
          tick={{ fontSize: 11 }}
          tickFormatter={(v: number) => Math.abs(v) >= 1000 ? `£${(v / 1000).toFixed(1)}k` : `£${Math.round(v)}`}
          className="text-muted-foreground"
          width={60}
        />
        <Tooltip
          cursor={false}
          content={<ChartTooltip labelMap={LABEL_MAP} />}
        />
        <Legend
          formatter={(value: string) => LABEL_MAP[value as keyof typeof LABEL_MAP] ?? value}
          wrapperStyle={{ fontSize: '12px' }}
        />
        <Bar dataKey="income" fill="#89B0AE" radius={[3, 3, 0, 0]} />
        <Bar dataKey="expense" fill="#C07A72" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
