import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface MonthSelectorProps {
  year: number;
  month: number; // 1–12
  onChange: (year: number, month: number) => void;
}

const monthYearFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

export function MonthSelector({ year, month, onChange }: MonthSelectorProps) {
  const label = monthYearFmt.format(new Date(year, month - 1, 1));

  const prev = () => {
    if (month === 1) onChange(year - 1, 12);
    else onChange(year, month - 1);
  };

  const next = () => {
    if (month === 12) onChange(year + 1, 1);
    else onChange(year, month + 1);
  };

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={prev} aria-label="Previous month">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-sm font-display font-semibold min-w-[140px] text-center select-none">
        {label}
      </span>
      <Button variant="ghost" size="sm" onClick={next} aria-label="Next month">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
