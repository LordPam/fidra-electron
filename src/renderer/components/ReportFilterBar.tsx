import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ReportFilterBarProps {
  startDate: string;
  endDate: string;
  activityFilter: string;
  activities: string[];
  transactionCount: number;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onActivityFilterChange: (activity: string) => void;
  onPresetThisMonth: () => void;
  onPresetLastMonth: () => void;
  onPresetYTD: () => void;
  onPresetFinancialYear: () => void;
  onPresetAll: () => void;
}

export function ReportFilterBar({
  startDate,
  endDate,
  activityFilter,
  activities,
  transactionCount,
  onStartDateChange,
  onEndDateChange,
  onActivityFilterChange,
  onPresetThisMonth,
  onPresetLastMonth,
  onPresetYTD,
  onPresetFinancialYear,
  onPresetAll,
}: ReportFilterBarProps) {
  return (
    <div className="rounded-lg border border-border-subtle p-3 flex flex-wrap items-center gap-3">
      <label className="text-xs text-muted-foreground">From</label>
      <input
        type="date"
        className="h-8 px-2 text-sm bg-muted/30 border border-border-subtle rounded-md focus:outline-none focus:ring-1 focus:ring-fidra-teal"
        value={startDate}
        onChange={(e) => onStartDateChange(e.target.value)}
      />
      <label className="text-xs text-muted-foreground">To</label>
      <input
        type="date"
        className="h-8 px-2 text-sm bg-muted/30 border border-border-subtle rounded-md focus:outline-none focus:ring-1 focus:ring-fidra-teal"
        value={endDate}
        onChange={(e) => onEndDateChange(e.target.value)}
      />

      <label className="text-xs text-muted-foreground ml-2">Activity</label>
      <Select value={activityFilter} onValueChange={onActivityFilterChange}>
        <SelectTrigger className="w-[140px] h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All</SelectItem>
          {activities.map((a) => (
            <SelectItem key={a} value={a}>
              {a}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex-1" />

      <span className="text-xs text-muted-foreground">Quick:</span>
      <Button variant="link" size="sm" className="h-6 px-1 text-xs" onClick={onPresetThisMonth}>
        This Month
      </Button>
      <Button variant="link" size="sm" className="h-6 px-1 text-xs" onClick={onPresetLastMonth}>
        Last Month
      </Button>
      <Button variant="link" size="sm" className="h-6 px-1 text-xs" onClick={onPresetYTD}>
        YTD
      </Button>
      <Button variant="link" size="sm" className="h-6 px-1 text-xs" onClick={onPresetFinancialYear}>
        Financial Year
      </Button>
      <Button variant="link" size="sm" className="h-6 px-1 text-xs" onClick={onPresetAll}>
        All
      </Button>

      <span className="text-xs text-muted-foreground tabular-nums">
        {transactionCount} transactions
      </span>
    </div>
  );
}
