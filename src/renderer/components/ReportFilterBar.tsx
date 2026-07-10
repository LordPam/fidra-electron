import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type ComparisonMode = 'none' | 'previous' | 'fy';

type Preset = 'month' | 'lastMonth' | 'quarter' | 'ytd' | 'fy' | 'all';

interface ReportFilterBarProps {
  startDate: string;
  endDate: string;
  activityFilter: string;
  activities: string[];
  transactionCount: number;
  comparisonMode: ComparisonMode;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onActivityFilterChange: (activity: string) => void;
  onComparisonModeChange: (mode: ComparisonMode) => void;
  onPresetThisMonth: () => void;
  onPresetLastMonth: () => void;
  onPresetQuarter: () => void;
  onPresetYTD: () => void;
  onPresetFinancialYear: () => void;
  onPresetAll: () => void;
}

const presets: { key: Preset; label: string }[] = [
  { key: 'month', label: 'Month' },
  { key: 'lastMonth', label: 'Last Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'ytd', label: 'YTD' },
  { key: 'fy', label: 'FY' },
  { key: 'all', label: 'All' },
];

export function ReportFilterBar({
  startDate,
  endDate,
  activityFilter,
  activities,
  transactionCount,
  comparisonMode,
  onStartDateChange,
  onEndDateChange,
  onActivityFilterChange,
  onComparisonModeChange,
  onPresetThisMonth,
  onPresetLastMonth,
  onPresetQuarter,
  onPresetYTD,
  onPresetFinancialYear,
  onPresetAll,
}: ReportFilterBarProps) {
  const presetHandlers: Record<Preset, () => void> = {
    month: onPresetThisMonth,
    lastMonth: onPresetLastMonth,
    quarter: onPresetQuarter,
    ytd: onPresetYTD,
    fy: onPresetFinancialYear,
    all: onPresetAll,
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Period presets */}
      <div className="flex items-center rounded-md border border-border-subtle bg-surface-inset p-0.5 gap-0.5">
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            className={cn(
              'px-2.5 py-1 text-xs font-display font-medium rounded transition-colors',
              'text-muted-foreground hover:text-foreground',
            )}
            onClick={presetHandlers[p.key]}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Date range */}
      <input
        type="date"
        className="h-7 px-2 text-xs bg-surface-inset border border-border-subtle rounded-md focus:outline-none focus:ring-1 focus:ring-fidra-teal"
        value={startDate}
        onChange={(e) => onStartDateChange(e.target.value)}
      />
      <span className="text-xs text-muted-foreground">&ndash;</span>
      <input
        type="date"
        className="h-7 px-2 text-xs bg-surface-inset border border-border-subtle rounded-md focus:outline-none focus:ring-1 focus:ring-fidra-teal"
        value={endDate}
        onChange={(e) => onEndDateChange(e.target.value)}
      />

      {/* Activity filter */}
      {activities.length > 0 && (
        <Select value={activityFilter} onValueChange={onActivityFilterChange}>
          <SelectTrigger className="w-[130px] h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Activities</SelectItem>
            {activities.map((a) => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Comparison */}
      <Select value={comparisonMode} onValueChange={(v) => onComparisonModeChange(v as ComparisonMode)}>
        <SelectTrigger className="w-[150px] h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No Comparison</SelectItem>
          <SelectItem value="previous">vs Previous Period</SelectItem>
          <SelectItem value="fy">vs Last FY</SelectItem>
        </SelectContent>
      </Select>

      <div className="flex-1" />

      <span className="text-xs text-muted-foreground tabular-nums">
        {transactionCount} transactions
      </span>
    </div>
  );
}
