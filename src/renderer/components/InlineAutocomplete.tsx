import { useState, useRef, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface InlineAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  className?: string;
}

/**
 * Lightweight inline autocomplete — no dropdown, just ghost text accepted with Tab.
 * Designed for dense table cells (CSV import preview).
 */
export function InlineAutocomplete({
  value,
  onChange,
  suggestions,
  placeholder,
  className,
}: InlineAutocompleteProps) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Best prefix match for ghost text
  const hint = useMemo(() => {
    if (!value) return '';
    const lower = value.toLowerCase();
    return suggestions.find((s) => s.toLowerCase().startsWith(lower)) ?? '';
  }, [value, suggestions]);

  const ghostText = hint ? hint.slice(value.length) : '';

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Tab' && ghostText && focused) {
        e.preventDefault();
        onChange(hint);
      }
    },
    [ghostText, focused, hint, onChange],
  );

  return (
    <div className="relative">
      {/* Ghost hint layer */}
      {ghostText && focused && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center overflow-hidden"
        >
          <span className="px-1 text-xs whitespace-pre">
            <span className="invisible">{value}</span>
            <span className="text-muted-foreground/40">{ghostText}</span>
          </span>
        </div>
      )}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        className={cn(
          'w-full bg-transparent border border-transparent rounded px-1 py-0.5 text-xs',
          'hover:border-border focus:border-primary focus:outline-none',
          'relative',
          className,
        )}
      />
    </div>
  );
}
