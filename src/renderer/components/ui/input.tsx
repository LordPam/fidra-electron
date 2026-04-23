import * as React from 'react';

import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-surface-inset px-3 py-1 text-sm font-body shadow-sm transition-fidra file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-fidra-slate/50 focus-visible:outline-none focus-visible:border-fidra-teal focus-visible:ring-[3px] focus-visible:ring-fidra-teal/30 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
