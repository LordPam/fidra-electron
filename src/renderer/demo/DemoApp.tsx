import { useEffect, useRef } from 'react';
import { HashRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import DashboardView from '@/views/DashboardView';
import TransactionsView from '@/views/TransactionsView';
import PlannedView from '@/views/PlannedView';
import ActivitiesView from '@/views/ActivitiesView';
import ReportsView from '@/views/ReportsView';
import InvoicesView from '@/views/InvoicesView';
import { useSheetStore } from '@/stores/sheet-store';
import { usePlannedStore } from '@/stores/planned-store';
import { useUiStore } from '@/stores/ui-store';

const DEMO_ROUTE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/transactions': 'Transactions',
  '/planned': 'Planned',
  '/activities': 'Activities',
  '/reports': 'Reports',
  '/invoices': 'Invoices',
  '/settings': 'Settings',
};

function DemoTheme() {
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  return null;
}

function DemoPlaceholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border-subtle bg-surface-raised px-6 py-3 shrink-0">
        <h1 className="text-xl font-display font-semibold">{title}</h1>
      </header>
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl rounded-xl border border-border-subtle bg-card p-6 shadow-sm">
          <p className="text-sm leading-7 text-muted-foreground">{body}</p>
        </div>
      </main>
    </div>
  );
}

function DemoInvoicesRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const seededSelectionRef = useRef(false);

  useEffect(() => {
    void useSheetStore.getState().loadAll();
    void usePlannedStore.getState().loadAll();
  }, []);

  useEffect(() => {
    const state = location.state as { selectInvoiceId?: string } | null;
    if (seededSelectionRef.current) return;
    if (state?.selectInvoiceId) {
      seededSelectionRef.current = true;
      return;
    }
    seededSelectionRef.current = true;
    navigate('/invoices', { replace: true, state: { selectInvoiceId: 'inv-001' } });
  }, [location.state, navigate]);

  return <ErrorBoundary><InvoicesView /></ErrorBoundary>;
}

function DemoMain() {
  const location = useLocation();

  useEffect(() => {
    if (window.parent === window) return;
    window.parent.postMessage(
      {
        type: 'fidra-demo-route',
        path: location.pathname,
        title: DEMO_ROUTE_TITLES[location.pathname] ?? 'Demo',
      },
      '*',
    );
  }, [location.pathname]);

  return (
    <main className="flex-1 overflow-hidden">
      <div key={location.pathname} className="view-enter h-full">
        <Routes>
          <Route path="/" element={<ErrorBoundary><DashboardView /></ErrorBoundary>} />
          <Route path="/transactions" element={<ErrorBoundary><TransactionsView /></ErrorBoundary>} />
          <Route path="/planned" element={<ErrorBoundary><PlannedView /></ErrorBoundary>} />
          <Route path="/activities" element={<ErrorBoundary><ActivitiesView /></ErrorBoundary>} />
          <Route path="/reports" element={<ErrorBoundary><ReportsView /></ErrorBoundary>} />
          <Route path="/invoices" element={<DemoInvoicesRoute />} />
          <Route
            path="/settings"
            element={
              <DemoPlaceholder
                title="Settings"
                body="This browser proof of concept is intentionally scoped to the core interactive ledger views. Operational settings, backups, auth, and sync configuration stay in the desktop app."
              />
            }
          />
        </Routes>
      </div>
    </main>
  );
}

export function DemoApp() {
  useEffect(() => {
    useUiStore.setState((state) => ({
      ...state,
      theme: 'light',
      showAddForm: false,
      showPlanned: true,
      searchQuery: '',
      filteredBalanceMode: false,
      horizonDays: 90,
      dashboardPeriod: '90days',
      reportOrgName: 'SubAqua Club',
    }));

    void useSheetStore.getState().loadAll();
    void usePlannedStore.getState().loadAll();
  }, []);

  return (
    <HashRouter>
      <DemoTheme />
      <div className="flex h-screen overflow-hidden bg-surface">
        <Sidebar />
        <DemoMain />
      </div>
    </HashRouter>
  );
}
