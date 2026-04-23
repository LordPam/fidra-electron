import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';
import type { DailyBalance } from '@/lib/chart-utils';
import { ChartTooltip } from '@/components/ChartTooltip';

interface BalanceTrendChartProps {
  data: DailyBalance[];
  compact?: boolean;
}

export function BalanceTrendChart({ data, compact }: BalanceTrendChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No data for selected period
      </div>
    );
  }

  // Sample labels for readability (show ~8 ticks max)
  const tickInterval = Math.max(1, Math.floor(data.length / 8));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: compact ? 0 : 8 }}>
        <defs>
          <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#89B0AE" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#89B0AE" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {!compact && <CartesianGrid strokeDasharray="3 3" className="opacity-20" />}
        <XAxis
          dataKey="date"
          tick={compact ? false : { fontSize: 11 }}
          interval={tickInterval}
          className="text-muted-foreground"
          hide={compact}
        />
        <YAxis
          tick={compact ? false : { fontSize: 11 }}
          tickFormatter={(v: number) => Math.abs(v) >= 1000 ? `£${(v / 1000).toFixed(1)}k` : `£${Math.round(v)}`}
          className="text-muted-foreground"
          width={compact ? 0 : 60}
          hide={compact}
        />
        <Tooltip
          content={<ChartTooltip labelMap={{ balance: 'Balance' }} />}
        />
        {!compact && <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="3 3" />}
        <Area
          type="monotone"
          dataKey="balance"
          stroke="#89B0AE"
          strokeWidth={2}
          fill="url(#balanceGradient)"
          dot={false}
          activeDot={{ r: 4, fill: '#89B0AE', stroke: '#fff', strokeWidth: 2 }}
        />
        {/* "You are here" dot on the last data point */}
        {data.length > 0 && (
          <ReferenceLine
            x={data[data.length - 1].date}
            stroke="transparent"
            label=""
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
