import { useState, useRef, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface ComboboxInputProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  className?: string;
}

export function ComboboxInput({
  value,
  onChange,
  suggestions,
  placeholder,
  className,
}: ComboboxInputProps) {
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Dropdown: match anywhere in string
  const filtered = useMemo(
    () =>
      value
        ? suggestions.filter((s) => s.toLowerCase().includes(value.toLowerCase()))
        : suggestions,
    [value, suggestions],
  );

  // Inline hint: best prefix match
  const hint = useMemo(() => {
    if (!value) return '';
    const match = suggestions.find((s) => s.toLowerCase().startsWith(value.toLowerCase()));
    return match ?? '';
  }, [value, suggestions]);

  // The completion text to show ghosted after the user's input
  const ghostText = hint ? hint.slice(value.length) : '';

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const acceptCompletion = () => {
    if (highlightIndex >= 0 && filtered[highlightIndex]) {
      // Accept the highlighted dropdown item
      onChange(filtered[highlightIndex]);
    } else if (hint) {
      // Accept the inline hint
      onChange(hint);
    }
    setOpen(false);
    setHighlightIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      // Only intercept Tab if there's something to complete
      const hasCompletion = (highlightIndex >= 0 && filtered[highlightIndex]) || hint;
      if (hasCompletion && open) {
        e.preventDefault();
        acceptCompletion();
      }
      // Otherwise let Tab do its normal focus-move
      return;
    }

    if (!open || filtered.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault();
      onChange(filtered[highlightIndex]);
      setOpen(false);
      setHighlightIndex(-1);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      {/* Ghost hint layer */}
      {ghostText && open && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center overflow-hidden"
        >
          <span className="px-3 text-sm whitespace-pre">
            <span className="invisible">{value}</span>
            <span className="text-muted-foreground/40">{ghostText}</span>
          </span>
        </div>
      )}
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlightIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn('bg-transparent relative', className)}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md">
          {filtered.slice(0, 3).map((item, idx) => (
            <button
              key={item}
              type="button"
              className={cn(
                'w-full px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                idx === highlightIndex && 'bg-accent text-accent-foreground',
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(item);
                setOpen(false);
              }}
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
