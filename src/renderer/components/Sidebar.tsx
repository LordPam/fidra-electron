import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Calendar,
  FolderOpen,
  Receipt,
  FileText,
  Settings,
  ChevronsUpDown,
  Database,
  LogOut,
  Repeat,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import logoLight from '@/assets/logo-light.svg';
import logoDark from '@/assets/logo-dark.svg';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useSheetStore } from '@/stores/sheet-store';
import { useWindowStore } from '@/stores/window-store';
import { useAuthStore } from '@/stores/auth-store';
import { ConnectionIndicator } from '@/components/ConnectionIndicator';
import { LocalSyncIndicator } from '@/components/LocalSyncIndicator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/transactions', icon: ArrowLeftRight, label: 'Transactions' },
  { to: '/planned', icon: Calendar, label: 'Planned' },
  { to: '/activities', icon: FolderOpen, label: 'Activities' },
  { to: '/invoices', icon: Receipt, label: 'Invoices' },
  { to: '/reports', icon: FileText, label: 'Reports' },
] as const;

export function Sidebar() {
  const { sheets, currentSheet, setCurrent } = useSheetStore();
  const { dbName, loadDbInfo } = useWindowStore();
  const session = useAuthStore((s) => s.session);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authMode = useAuthStore((s) => s.authMode);
  const signOut = useAuthStore((s) => s.signOut);
  const localSignOut = useAuthStore((s) => s.localSignOut);
  const location = useLocation();

  useEffect(() => {
    loadDbInfo();
  }, [loadDbInfo]);

  const sheetLabel =
    currentSheet === 'All Sheets'
      ? 'All'
      : currentSheet.length > 3
        ? currentSheet.slice(0, 3)
        : currentSheet;

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="flex h-full w-14 flex-col items-center border-r border-border-subtle bg-surface-raised pt-4 pb-4 overflow-visible">
        {/* Logo */}
        <div className="mb-4 flex h-8 w-8 shrink-0 items-center justify-center">
          <img src={logoLight} alt="Fidra" className="h-8 w-8 object-contain dark:hidden" />
          <img src={logoDark} alt="Fidra" className="hidden h-8 w-8 object-contain dark:block" />
        </div>

        {/* Sheet selector */}
        <Select value={currentSheet} onValueChange={setCurrent}>
          <Tooltip>
            <TooltipTrigger asChild>
              <SelectTrigger className="mb-2 h-7 w-10 px-0 text-[10px] font-display font-medium text-fidra-slate justify-center gap-0 border-border-subtle bg-surface-inset [&>svg]:hidden">
                <span className="truncate">{sheetLabel}</span>
                <ChevronsUpDown className="!h-2.5 !w-2.5 shrink-0 opacity-50 ml-0.5" />
              </SelectTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" className="font-display text-xs">
              Sheet: {currentSheet}
            </TooltipContent>
          </Tooltip>
          <SelectContent side="right" align="start">
            <SelectItem value="All Sheets">All Sheets</SelectItem>
            {sheets.map((s) => (
              <SelectItem key={s.id} value={s.name}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <nav className="flex flex-1 flex-col items-center gap-1">
          {navItems.map(({ to, icon: Icon, label }) => {
            const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
            return (
              <Tooltip key={to}>
                <TooltipTrigger asChild>
                  <NavLink
                    to={to}
                    className={cn(
                      'relative flex h-10 w-10 items-center justify-center rounded-md text-fidra-teal transition-fidra hover:bg-fidra-teal/10 hover:text-foreground',
                      active && 'sidebar-nav-active'
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </NavLink>
                </TooltipTrigger>
                <TooltipContent side="right" className="font-display text-xs">
                  {label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {/* Switch File */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-md text-fidra-slate transition-fidra hover:bg-fidra-teal/10 hover:text-foreground"
              onClick={() => window.dispatchEvent(new CustomEvent('fidra:showFileChooser'))}
            >
              <Repeat className="h-5 w-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-display text-xs">
            Switch File
          </TooltipContent>
        </Tooltip>

        <Separator className="my-2 w-6 bg-border-subtle" />

        {/* Database filename */}
        {dbName && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="mb-1 flex h-7 w-10 items-center justify-center">
                <Database className="h-3.5 w-3.5 text-fidra-slate/60" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" className="font-display text-xs">
              {dbName}
            </TooltipContent>
          </Tooltip>
        )}

        <ConnectionIndicator />
        <LocalSyncIndicator />

        <Tooltip>
          <TooltipTrigger asChild>
            <NavLink
              to="/settings"
              className={cn(
                'relative flex h-10 w-10 items-center justify-center rounded-md text-fidra-slate transition-fidra hover:bg-fidra-teal/10 hover:text-foreground',
                location.pathname === '/settings' && 'sidebar-nav-active'
              )}
            >
              <Settings className="h-5 w-5" />
            </NavLink>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-display text-xs">
            Settings
          </TooltipContent>
        </Tooltip>

        {/* Sign Out — Supabase session or Local Sync auth */}
        {(session || (isAuthenticated && authMode === 'localSync')) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-md text-fidra-slate transition-fidra hover:bg-fidra-teal/10 hover:text-foreground"
                onClick={async () => {
                  if (authMode === 'localSync') {
                    await localSignOut();
                  } else {
                    await signOut();
                    window.dispatchEvent(new CustomEvent('fidra:showFileChooser'));
                  }
                }}
              >
                <LogOut className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="font-display text-xs">
              Sign Out
            </TooltipContent>
          </Tooltip>
        )}
      </aside>
    </TooltipProvider>
  );
}
