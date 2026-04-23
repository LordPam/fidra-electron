import { formatCurrency } from '@/lib/format';

interface ChartTooltipEntry {
  name: string;
  value: number;
  label: string;
}

interface ChartTooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{ name: string; value: number }>;
  labelMap?: Record<string, string>;
  valueFormatter?: (value: number) => string;
}

export function ChartTooltip({
  active,
  label,
  payload,
  labelMap = {},
  valueFormatter = (v) => formatCurrency(v),
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  const entries: ChartTooltipEntry[] = payload.map((p) => ({
    name: p.name,
    value: p.value,
    label: labelMap[p.name] ?? p.name,
  }));

  return (
    <div className="rounded-md border border-border-subtle bg-popover px-3 py-2 text-xs shadow-md">
      {label && (
        <p className="font-display font-medium text-foreground mb-1.5">{label}</p>
      )}
      <div className="space-y-1">
        {entries.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{entry.label}</span>
            <span className="font-mono tabular-nums font-medium text-foreground">
              {valueFormatter(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
