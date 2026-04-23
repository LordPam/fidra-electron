import { cn } from '@/lib/utils';

interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  variant?: 'default' | 'positive' | 'negative' | 'warning';
}

const variantStyles: Record<string, string> = {
  default: 'border-t-fidra-teal',
  positive: 'border-t-fidra-positive',
  negative: 'border-t-fidra-negative',
  warning: 'border-t-fidra-warning',
};

export function MetricCard({ title, value, subtitle, variant = 'default' }: MetricCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg bg-card border border-border-subtle p-4 border-t-[3px] min-w-0',
        variantStyles[variant],
      )}
    >
      <p className="text-xs font-display font-medium uppercase tracking-[0.05em] text-muted-foreground mb-1 truncate">
        {title}
      </p>
      <p className="text-xl font-display font-bold tabular-nums truncate">{value}</p>
      {subtitle && (
        <p className="text-xs text-muted-foreground mt-1 truncate">{subtitle}</p>
      )}
    </div>
  );
}
