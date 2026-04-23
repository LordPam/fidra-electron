import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface SearchBarProps {
  query: string;
  onSearch: (query: string) => void;
  totalCount: number;
  filteredCount: number;
  filteredBalanceMode: boolean;
  onToggleFilteredBalance: () => void;
}

export function SearchBar({
  query,
  onSearch,
  totalCount,
  filteredCount,
  filteredBalanceMode,
  onToggleFilteredBalance,
}: SearchBarProps) {
  const [value, setValue] = useState(query);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Sync local value when the store query changes externally (e.g. activity view navigation)
  useEffect(() => {
    setValue(query);
  }, [query]);

  useEffect(() => {
    if (value === query) return;
    debounceRef.current = setTimeout(() => {
      onSearch(value);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [value, onSearch, query]);

  const isFiltered = filteredCount !== totalCount;

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fidra-slate/50" />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder='Search... (e.g. "coffee AND NOT pending")'
          className="pl-9 pr-8"
        />
        {value && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-fidra-slate/50 hover:text-foreground transition-colors"
            onClick={() => { setValue(''); onSearch(''); }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {isFiltered && (
        <span className="text-xs font-body text-muted-foreground whitespace-nowrap">
          {filteredCount} of {totalCount}
        </span>
      )}
      <div className="flex items-center gap-1.5">
        <Checkbox
          id="filtered-balance"
          checked={filteredBalanceMode}
          onCheckedChange={onToggleFilteredBalance}
        />
        <Label htmlFor="filtered-balance" className="text-xs font-body cursor-pointer whitespace-nowrap text-muted-foreground">
          Filtered balance
        </Label>
      </div>
    </div>
  );
}
