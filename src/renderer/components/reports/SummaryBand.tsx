import { CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import type { HealthStatus } from '@/services/report-insights';

interface FinancialHealthProps {
  currentBalance: number;
  availableBalance: number;
  periodNet: number;
  health: HealthStatus;
}

const statusConfig = {
  healthy: {
    label: 'Healthy',
    Icon: CheckCircle2,
    color: 'text-fidra-positive',
    accent: 'border-t-fidra-positive',
  },
  caution: {
    label: 'Caution',
    Icon: AlertTriangle,
    color: 'text-fidra-warning',
    accent: 'border-t-fidra-warning',
  },
  warning: {
    label: 'Warning',
    Icon: AlertCircle,
    color: 'text-fidra-negative',
    accent: 'border-t-fidra-negative',
  },
} as const;

export function SummaryBand({ currentBalance, availableBalance, periodNet, health }: FinancialHealthProps) {
  const cfg = statusConfig[health.level];

  return (
    <div className={`rounded-lg bg-gradient-to-br from-card to-surface-inset border border-border-subtle border-t-[3px] ${cfg.accent} p-5`}>
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-display font-medium text-muted-foreground">
          Financial Health
        </h3>
        <div className="flex items-center gap-1.5">
          <cfg.Icon className={`h-4 w-4 ${cfg.color}`} />
          <span className={`text-sm font-display font-semibold ${cfg.color}`}>
            {cfg.label}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-8 mb-5">
        <div>
          <p className="text-xs font-display font-medium uppercase tracking-[0.05em] text-muted-foreground mb-1">
            Balance
          </p>
          <p className="text-2xl font-display font-bold tabular-nums tracking-tight">
            {formatCurrency(currentBalance)}
          </p>
        </div>
        <div>
          <p className="text-xs font-display font-medium uppercase tracking-[0.05em] text-muted-foreground mb-1">
            Available
          </p>
          <p className="text-2xl font-display font-bold tabular-nums tracking-tight">
            {formatCurrency(availableBalance)}
          </p>
        </div>
        <div>
          <p className="text-xs font-display font-medium uppercase tracking-[0.05em] text-muted-foreground mb-1">
            Period Net
          </p>
          <p className={`text-2xl font-display font-bold tabular-nums tracking-tight ${periodNet >= 0 ? 'text-fidra-positive' : 'text-fidra-negative'}`}>
            {periodNet >= 0 ? '+' : ''}{formatCurrency(periodNet)}
          </p>
        </div>
      </div>

      {health.notes.length > 0 && (
        <div className="space-y-1 pt-3 border-t border-border-subtle/50">
          {health.notes.map((note, i) => (
            <p key={i} className="text-xs text-muted-foreground">{note}</p>
          ))}
        </div>
      )}
    </div>
  );
}
