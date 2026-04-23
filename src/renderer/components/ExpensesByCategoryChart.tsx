import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts';
import type { CategoryData } from '@/lib/chart-utils';
import { ChartTooltip } from '@/components/ChartTooltip';

interface ExpensesByCategoryChartProps {
  data: CategoryData[];
  title?: string;
  colors?: string[];
}

const DEFAULT_COLORS = ['#89B0AE', '#455561', '#6B8F71', '#C07A72', '#313E50', '#7A9E9F'];

export function ExpensesByCategoryChart({ data, title, colors }: ExpensesByCategoryChartProps) {
  const COLORS = colors ?? DEFAULT_COLORS;
  const tooltipTitle = title ?? 'Amount';

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No data for selected period
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 16, bottom: 4, left: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" className="opacity-20" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 11 }}
          tickFormatter={(v: number) => Math.abs(v) >= 1000 ? `£${(v / 1000).toFixed(1)}k` : `£${Math.round(v)}`}
          className="text-muted-foreground"
        />
        <YAxis
          type="category"
          dataKey="category"
          tick={false}
          axisLine={false}
          tickLine={false}
          width={4}
        />
        <Tooltip
          cursor={false}
          content={<ChartTooltip labelMap={{ total: tooltipTitle }} />}
        />
        <Bar dataKey="total" radius={[0, 3, 3, 0]}>
          {data.map((_entry, index) => (
            <Cell key={index} fill={COLORS[index % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
