import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Cell,
} from 'recharts';
import { ChartTooltip } from '@/components/ChartTooltip';

interface NetPositionData {
  activity: string;
  net: number;
}

interface NetPositionChartProps {
  data: NetPositionData[];
}

export function NetPositionChart({ data }: NetPositionChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No activity data available
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
        <CartesianGrid strokeDasharray="3 3" className="opacity-20" vertical={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 11 }}
          tickFormatter={(v: number) =>
            Math.abs(v) >= 1000 ? `£${(v / 1000).toFixed(1)}k` : `£${Math.round(v)}`
          }
          className="text-muted-foreground"
        />
        <YAxis
          type="category"
          dataKey="activity"
          tick={false}
          axisLine={false}
          tickLine={false}
          width={4}
        />
        <ReferenceLine x={0} stroke="hsl(var(--border))" />
        <Tooltip
          cursor={false}
          content={<ChartTooltip labelMap={{ net: 'Net' }} />}
        />
        <Bar dataKey="net" radius={3}>
          {data.map((entry, index) => (
            <Cell
              key={index}
              fill={entry.net >= 0 ? '#89B0AE' : '#C07A72'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
