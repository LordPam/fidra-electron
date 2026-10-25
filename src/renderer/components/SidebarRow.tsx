import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Shared shape for every row in the sidebar. Expanded rows show their label
 * inline; collapsed rows are icon-only and fall back to a hover tooltip.
 */
export function SidebarRow({
  collapsed,
  label,
  children,
}: {
  collapsed: boolean;
  label: string;
  children: ReactNode;
}) {
  if (!collapsed) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" className="font-display text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Classes shared by nav links and button-style sidebar rows. */
export function sidebarRowClasses(collapsed: boolean, extra?: string): string {
  return cn(
    'sidebar-row group relative grid h-10 shrink-0 items-center text-fidra-slate transition-fidra',
    collapsed ? 'w-14 grid-cols-[56px]' : 'w-full grid-cols-[56px_minmax(0,1fr)]',
    extra
  );
}

export function SidebarLabel({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  if (collapsed) return null;
  return (
    <span className="sidebar-row-label mr-2 flex h-9 min-w-0 items-center rounded-lg px-3">
      <span className="truncate font-display text-sm font-medium">{children}</span>
    </span>
  );
}

export function SidebarIcon({ children }: { children: ReactNode }) {
  return (
    <span className="sidebar-row-icon relative flex h-9 w-9 items-center justify-center justify-self-center rounded-lg">
      {children}
    </span>
  );
}
