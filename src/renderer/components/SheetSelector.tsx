import { useSheetStore } from '@/stores/sheet-store';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface SheetSelectorProps {
  className?: string;
}

export function SheetSelector({ className }: SheetSelectorProps) {
  const { sheets, currentSheet, setCurrent } = useSheetStore();

  return (
    <Select value={currentSheet} onValueChange={setCurrent}>
      <SelectTrigger className={cn('h-8 text-sm', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="All Sheets">All Sheets</SelectItem>
        {sheets.map((s) => (
          <SelectItem key={s.id} value={s.name}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
