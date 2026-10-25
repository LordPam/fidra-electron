import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  ArrowLeftRight,
  Calendar,
  ChevronsUpDown,
  Database,
  FileText,
  FolderOpen,
  Layers3,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Repeat,
  Settings,
} from 'lucide-react';
import { LocalSyncIndicator } from '@/components/LocalSyncIndicator';
import {
  SidebarIcon,
  SidebarLabel,
  SidebarRow,
  sidebarRowClasses,
} from '@/components/SidebarRow';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import logoLight from '@/assets/logo-light.svg';
import logoDark from '@/assets/logo-dark.svg';
import { cn } from '@/lib/utils';
import { isMacFrameless } from '@/lib/platform';
import { useAuthStore } from '@/stores/auth-store';
import { useSheetStore } from '@/stores/sheet-store';
import { useUiStore } from '@/stores/ui-store';
import { useWindowStore } from '@/stores/window-store';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/transactions', icon: ArrowLeftRight, label: 'Transactions' },
  { to: '/planned', icon: Calendar, label: 'Planned' },
  { to: '/activities', icon: FolderOpen, label: 'Activities' },
  { to: '/invoices', icon: Receipt, label: 'Invoices' },
  { to: '/reports', icon: FileText, label: 'Reports' },
] as const;

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="grid h-7 shrink-0 grid-cols-[56px_minmax(0,1fr)] items-end pb-1">
      <span />
      <span className="px-3 text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/75">
        {children}
      </span>
    </div>
  );
}

export function Sidebar() {
  const { sheets, currentSheet, setCurrent } = useSheetStore();
  const { dbName, loadDbInfo } = useWindowStore();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const authMode = useAuthStore((state) => state.authMode);
  const localSignOut = useAuthStore((state) => state.localSignOut);
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleCollapsed = useUiStore((state) => state.toggleSidebarCollapsed);
  const location = useLocation();
  const macInset = isMacFrameless();

  useEffect(() => {
    loadDbInfo();
  }, [loadDbInfo]);

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        data-testid="sidebar"
        data-collapsed={collapsed}
        className={cn(
          'app-sidebar-shell relative flex h-full shrink-0 flex-col overflow-hidden border-r border-border-subtle bg-surface-base transition-[width] duration-200 ease-out',
          collapsed ? 'w-14' : 'w-60',
        )}
      >
        {macInset && (
          <div
            data-testid="sidebar-titlebar"
            className="app-chrome-material app-drag ml-14 h-[52px] shrink-0 bg-surface-base"
          />
        )}

        <div
          data-testid="sidebar-rail"
          className="app-chrome-material pointer-events-none absolute inset-y-0 left-0 w-14 bg-surface-base"
        />
        <div
          data-testid="sidebar-panel-corner-underlay"
          className="app-chrome-material pointer-events-none absolute left-14 h-4 w-4 bg-surface-base"
          style={{ top: macInset ? 52 : 0 }}
        />
        <div
          data-testid="sidebar-panel-surface"
          className="pointer-events-none absolute bottom-0 left-14 right-0 rounded-tl-2xl border-l border-t border-border-subtle/70 bg-surface-raised"
          style={{ top: macInset ? 52 : 0 }}
        />

        <div
          data-testid="sidebar-brand"
          className={cn(
            'app-drag relative grid h-16 shrink-0 items-center',
            collapsed ? 'grid-cols-[56px]' : 'grid-cols-[56px_minmax(0,1fr)]',
          )}
        >
          <div className="flex h-full items-center justify-center">
            <img src={logoLight} alt="Fidra" className="h-7 w-7 object-contain dark:hidden" />
            <img src={logoDark} alt="Fidra" className="hidden h-7 w-7 object-contain dark:block" />
          </div>
          {!collapsed && (
            <div className="flex min-w-0 items-center justify-between pl-3 pr-3">
              <div className="min-w-0">
                <div className="font-display text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                  Fidra
                </div>
                <div className="truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  Ledger workspace
                </div>
              </div>
              <button
                type="button"
                aria-label="Collapse sidebar"
                className="no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-fidra hover:bg-surface-inset hover:text-foreground"
                onClick={toggleCollapsed}
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col">
          <Select value={currentSheet} onValueChange={setCurrent}>
            <SidebarRow collapsed={collapsed} label={`Sheet: ${currentSheet}`}>
              <SelectTrigger
                data-testid="sidebar-sheet-selector"
                aria-label={`Current sheet: ${currentSheet}`}
                className={cn(
                  sidebarRowClasses(collapsed),
                  'mb-2 h-12 border-0 bg-transparent p-0 shadow-none hover:bg-transparent focus:ring-0 [&>svg]:hidden',
                )}
              >
                <div className="contents">
                  <SidebarIcon>
                    <Layers3 className="h-[18px] w-[18px]" />
                  </SidebarIcon>
                </div>
                {!collapsed && (
                  <div className="mr-2 flex h-12 min-w-0 items-center justify-between px-3 text-left">
                    <span className="min-w-0">
                      <span className="block text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                        Sheet
                      </span>
                      <span className="block truncate font-display text-[13px] font-medium text-foreground">
                        {currentSheet}
                      </span>
                    </span>
                    <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </div>
                )}
              </SelectTrigger>
            </SidebarRow>
            <SelectContent side={collapsed ? 'right' : 'bottom'} align="start">
              <SelectItem value="All Sheets">All Sheets</SelectItem>
              {sheets.map((sheet) => (
                <SelectItem key={sheet.id} value={sheet.name}>
                  {sheet.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {!collapsed && <SectionLabel>Workspace</SectionLabel>}

          <nav data-testid="sidebar-navigation" aria-label="Primary navigation" className="flex flex-col">
            {navItems.map(({ to, icon: Icon, label }) => {
              const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
              return (
                <SidebarRow key={to} collapsed={collapsed} label={label}>
                  <NavLink
                    to={to}
                    aria-label={label}
                    className={sidebarRowClasses(collapsed, cn(active && 'sidebar-nav-active'))}
                  >
                    <SidebarIcon>
                      <Icon className="h-[18px] w-[18px]" />
                    </SidebarIcon>
                    <SidebarLabel collapsed={collapsed}>{label}</SidebarLabel>
                  </NavLink>
                </SidebarRow>
              );
            })}
          </nav>

          <div className="flex-1" />

          {!collapsed && <SectionLabel>File &amp; account</SectionLabel>}

          {dbName && (
            <SidebarRow collapsed={collapsed} label={dbName}>
              <div className={sidebarRowClasses(collapsed, 'cursor-default')}>
                <SidebarIcon>
                  <Database className="h-[17px] w-[17px]" />
                </SidebarIcon>
                {!collapsed && (
                  <span className="mr-2 min-w-0 px-3 py-1.5">
                    <span className="block text-[9px] uppercase tracking-[0.12em] text-muted-foreground/75">
                      Current file
                    </span>
                    <span className="block truncate text-xs text-fidra-slate" title={dbName}>
                      {dbName}
                    </span>
                  </span>
                )}
              </div>
            </SidebarRow>
          )}

          <LocalSyncIndicator collapsed={collapsed} />

          <SidebarRow collapsed={collapsed} label="Switch File">
            <button
              type="button"
              className={sidebarRowClasses(collapsed)}
              onClick={() => window.dispatchEvent(new CustomEvent('fidra:showFileChooser'))}
            >
              <SidebarIcon>
                <Repeat className="h-[18px] w-[18px]" />
              </SidebarIcon>
              <SidebarLabel collapsed={collapsed}>Switch File</SidebarLabel>
            </button>
          </SidebarRow>

          <SidebarRow collapsed={collapsed} label="Settings">
            <NavLink
              to="/settings"
              aria-label="Settings"
              className={sidebarRowClasses(
                collapsed,
                cn(location.pathname === '/settings' && 'sidebar-nav-active'),
              )}
            >
              <SidebarIcon>
                <Settings className="h-[18px] w-[18px]" />
              </SidebarIcon>
              <SidebarLabel collapsed={collapsed}>Settings</SidebarLabel>
            </NavLink>
          </SidebarRow>

          {isAuthenticated && authMode === 'localSync' && (
            <SidebarRow collapsed={collapsed} label="Sign Out">
              <button
                type="button"
                className={sidebarRowClasses(collapsed)}
                onClick={() => localSignOut()}
              >
                <SidebarIcon>
                  <LogOut className="h-[18px] w-[18px]" />
                </SidebarIcon>
                <SidebarLabel collapsed={collapsed}>Sign Out</SidebarLabel>
              </button>
            </SidebarRow>
          )}

          {collapsed && (
            <SidebarRow collapsed={true} label="Expand sidebar">
              <button
                type="button"
                aria-label="Expand sidebar"
                className={sidebarRowClasses(true)}
                onClick={toggleCollapsed}
              >
                <SidebarIcon>
                  <PanelLeftOpen className="h-[18px] w-[18px]" />
                </SidebarIcon>
              </button>
            </SidebarRow>
          )}
          <div className="h-3 shrink-0" />
        </div>
      </aside>
    </TooltipProvider>
  );
}
