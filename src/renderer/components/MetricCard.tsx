import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatCurrency } from '@/lib/format';

export interface MetricDelta {
  absolute: number;
  percent: number;
  flagged: boolean;
}

interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  variant?: 'default' | 'positive' | 'negative' | 'warning';
  delta?: MetricDelta | null;
  /** If true, "up" is bad (e.g. for expenditure). */
  invertDelta?: boolean;
}

const variantStyles: Record<string, string> = {
  default: 'border-t-fidra-teal',
  positive: 'border-t-fidra-positive',
  negative: 'border-t-fidra-negative',
  warning: 'border-t-fidra-warning',
};

export function MetricCard({ title, value, subtitle, variant = 'default', delta, invertDelta }: MetricCardProps) {
  const isPositiveChange = delta ? delta.absolute >= 0 : false;
  const isGood = invertDelta ? !isPositiveChange : isPositiveChange;

  return (
    <div
      className={cn(
        'rounded-lg bg-card border border-border-subtle p-4 border-t-[3px] min-w-0',
        variantStyles[variant],
        delta?.flagged && 'ring-1 ring-fidra-warning/40',
      )}
    >
      <p className="text-xs font-display font-medium uppercase tracking-[0.05em] text-muted-foreground mb-1 truncate">
        {title}
      </p>
      <p className="text-xl font-display font-bold tabular-nums truncate">{value}</p>
      {delta && (
        <div className={cn(
          'flex items-center gap-1 mt-1.5 text-xs tabular-nums',
          isGood ? 'text-fidra-positive' : 'text-fidra-negative',
        )}>
          {isPositiveChange ? (
            <TrendingUp className="h-3 w-3 shrink-0" />
          ) : (
            <TrendingDown className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">
            {delta.percent >= 0 ? '+' : ''}{Math.round(delta.percent)}%
            {' '}({delta.absolute >= 0 ? '+' : ''}{formatCurrency(Math.abs(delta.absolute))})
          </span>
        </div>
      )}
      {subtitle && !delta && (
        <p className="text-xs text-muted-foreground mt-1 truncate">{subtitle}</p>
      )}
    </div>
  );
}
