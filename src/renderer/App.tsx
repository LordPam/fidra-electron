import { useEffect, useState, useCallback } from 'react';
import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import DashboardView from '@/views/DashboardView';
import TransactionsView from '@/views/TransactionsView';
import PlannedView from '@/views/PlannedView';
import ActivitiesView from '@/views/ActivitiesView';
import ReportsView from '@/views/ReportsView';
import InvoicesView from '@/views/InvoicesView';
import SettingsView from '@/views/SettingsView';
import { AuthGateDialog } from '@/dialogs/AuthGateDialog';
import { SetupWizard } from '@/dialogs/SetupWizard';
import { FileChooserDialog } from '@/dialogs/FileChooserDialog';
import { useLocalSyncStore } from '@/stores/local-sync-store';
import { useAuthStore } from '@/stores/auth-store';
import { useTransactionStore } from '@/stores/transaction-store';
import { useSheetStore } from '@/stores/sheet-store';
import { usePlannedStore } from '@/stores/planned-store';
import { useCategoryStore } from '@/stores/category-store';
import { useUiStore } from '@/stores/ui-store';
import { useInvoiceStore } from '@/stores/invoice-store';
import { LocalSyncConflictDialog } from '@/dialogs/LocalSyncConflictDialog';
import { WhileAwayDialog } from '@/dialogs/WhileAwayDialog';
import { SyncToast } from '@/components/SyncToast';
import { UpdateToast } from '@/components/UpdateToast';
import { useAttachmentSignal } from '@/stores/attachment-signal';
import type { ImportPersonSummary } from '../shared/ipc-types';

const ROUTES = ['/', '/transactions', '/planned', '/activities', '/invoices', '/reports', '/settings'];

function GlobalKeyboardNav() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || e.shiftKey || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;

      e.preventDefault();
      const currentIdx = ROUTES.indexOf(location.pathname);
      if (currentIdx === -1) return;
      const nextIdx = e.key === 'ArrowDown'
        ? Math.min(currentIdx + 1, ROUTES.length - 1)
        : Math.max(currentIdx - 1, 0);
      if (nextIdx !== currentIdx) {
        navigate(ROUTES[nextIdx]);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, location.pathname]);

  return null;
}

function ThemeWatcher() {
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;

    if (theme === 'light') {
      root.classList.remove('dark');
      return;
    }
    if (theme === 'dark') {
      root.classList.add('dark');
      return;
    }

    // 'system' — follow OS preference
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (e: MediaQueryList | MediaQueryListEvent) => {
      root.classList.toggle('dark', e.matches);
    };
    apply(mq);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  return null;
}

function AuthWiring() {
  const initialize = useAuthStore((s) => s.initialize);
  const initEventListeners = useAuthStore((s) => s.initEventListeners);

  useEffect(() => { initialize(); }, [initialize]);
  useEffect(() => { return initEventListeners(); }, [initEventListeners]);

  return null;
}

/**
 * Sets up Local Sync store event listeners early — before the auth gate.
 * Without this, status events emitted by the orchestrator during sign-in
 * (after startLocalSyncAfterAuth) are lost because LocalSyncIndicator
 * hasn't mounted yet. By registering listeners early, the store picks up
 * the orchestrator's status immediately and the indicator shows on first render.
 */
function LocalSyncEarlyWiring() {
  const initEventListeners = useLocalSyncStore((s) => s.initEventListeners);
  const loadStatus = useLocalSyncStore((s) => s.loadStatus);
  const loadConfig = useLocalSyncStore((s) => s.loadConfig);

  useEffect(() => {
    loadStatus();
    loadConfig();
    return initEventListeners();
  }, [initEventListeners, loadStatus, loadConfig]);

  return null;
}

/**
 * Auth gate hook. For Local Sync databases with auth enabled, blocks the
 * app until authenticated. Reads hydration state from auth-store (set by
 * initialize()) instead of calling IPC directly. Returns `pending: true`
 * until isHydrated is true.
 */
function useAuthGate() {
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authMode = useAuthStore((s) => s.authMode);
  const [personnelEmpty, setPersonnelEmpty] = useState<boolean | null>(null);
  const [authRequired, setAuthRequired] = useState(false);

  // After hydration: if localSync mode and not authenticated, gate is needed
  useEffect(() => {
    if (!isHydrated) return;
    if (isAuthenticated || authMode !== 'localSync') {
      setAuthRequired(false);
      return;
    }
    setAuthRequired(true);
    // Check if any auth personnel exist yet (first-setup vs sign-in)
    window.api.localAuthGetStatus().then((status) => {
      setPersonnelEmpty(!status.authEnabled);
    }).catch(() => setPersonnelEmpty(true));
  }, [isHydrated, isAuthenticated, authMode]);

  // Close gate when authenticated
  useEffect(() => {
    if (isAuthenticated) setAuthRequired(false);
  }, [isAuthenticated]);

  const showGate = !isAuthenticated && authRequired && personnelEmpty !== null;
  return { showGate, pending: !isHydrated, personnelEmpty: personnelEmpty ?? true };
}

function LocalSyncWiring() {
  const setOnDataChanged = useLocalSyncStore((s) => s.setOnDataChanged);
  const txRefresh = useTransactionStore((s) => s.silentRefresh);
  const sheetRefresh = useSheetStore((s) => s.silentRefresh);
  const plannedRefresh = usePlannedStore((s) => s.silentRefresh);
  const categoryRefresh = useCategoryStore((s) => s.silentRefresh);
  const invoiceLoadAll = useInvoiceStore((s) => s.loadAll);

  const handleDataChanged = useCallback((tables: string[]) => {
    for (const table of tables) {
      if (table === 'transactions') txRefresh();
      if (table === 'sheets') sheetRefresh();
      if (table === 'planned_templates') plannedRefresh();
      if (table === 'categories') categoryRefresh();
      if (table === 'invoices') invoiceLoadAll();
      if (table === 'settings') {
        useUiStore.getState().loadFYStartMonth();
        useUiStore.getState().loadOrgName();
      }
      if (table === 'attachments') {
        // Bump revision so open AttachmentPanel / EditTransactionDialog refetch
        useAttachmentSignal.getState().bump();
        // Also refresh transactions to update attachment count badges
        txRefresh();
      }
      // activity_notes, personnel, audit_log are loaded on-demand
      // by their respective views — no persistent store to refresh
    }
  }, [txRefresh, sheetRefresh, plannedRefresh, categoryRefresh, invoiceLoadAll]);

  useEffect(() => {
    setOnDataChanged(handleDataChanged);
  }, [setOnDataChanged, handleDataChanged]);

  return null;
}

function WhileAwayWiring() {
  const [whileAwaySummaries, setWhileAwaySummaries] = useState<ImportPersonSummary[] | null>(null);

  useEffect(() => {
    // Listen for startup summary events (may fire before this listener mounts)
    const unsub = window.api.onLocalSyncImportSummary((notification) => {
      if (notification.isStartupCatchup && notification.summaries.length > 0) {
        setWhileAwaySummaries(notification.summaries);
      }
    });

    // Also fetch any stored startup summary (handles the race condition where
    // the orchestrator fired the event before this component mounted)
    window.api.localSyncGetStartupSummary().then((stored) => {
      if (stored && stored.summaries.length > 0) {
        setWhileAwaySummaries(stored.summaries);
      }
    }).catch(() => { /* non-fatal */ });

    return unsub;
  }, []);

  return (
    <WhileAwayDialog
      open={whileAwaySummaries !== null}
      onDismiss={() => setWhileAwaySummaries(null)}
      summaries={whileAwaySummaries ?? []}
    />
  );
}

function LocalSyncConflictOverlay() {
  const conflicts = useLocalSyncStore((s) => s.conflicts);
  const resolveConflict = useLocalSyncStore((s) => s.resolveConflict);
  const current = conflicts[0];
  if (!current) return null;
  return (
    <LocalSyncConflictDialog
      open={true}
      conflict={current}
      remaining={conflicts.length - 1}
      onResolve={resolveConflict}
    />
  );
}

function AnimatedMain() {
  const location = useLocation();
  const currentSheet = useSheetStore((s) => s.currentSheet);
  return (
    <main className="flex-1 overflow-hidden">
      <div key={`${location.pathname}::${currentSheet}`} className="view-enter h-full">
        <Routes>
          <Route path="/" element={<ErrorBoundary><DashboardView /></ErrorBoundary>} />
          <Route path="/transactions" element={<ErrorBoundary><TransactionsView /></ErrorBoundary>} />
          <Route path="/planned" element={<ErrorBoundary><PlannedView /></ErrorBoundary>} />
          <Route path="/activities" element={<ErrorBoundary><ActivitiesView /></ErrorBoundary>} />
          <Route path="/invoices" element={<ErrorBoundary><InvoicesView /></ErrorBoundary>} />
          <Route path="/reports" element={<ErrorBoundary><ReportsView /></ErrorBoundary>} />
          <Route path="/settings" element={<ErrorBoundary><SettingsView /></ErrorBoundary>} />
        </Routes>
      </div>
    </main>
  );
}

export function App() {
  const [startupOverlay, setStartupOverlay] = useState<'wizard' | 'chooser' | null | 'loading'>('loading');
  const { showGate, pending: authPending, personnelEmpty } = useAuthGate();

  const showFileChooser = useCallback(() => {
    setStartupOverlay('chooser');
  }, []);

  useEffect(() => {
    Promise.all([
      useUiStore.getState().loadUiPreferences(),
      window.api.getStartupMode(),
    ]).then(([, { mode }]) => {
      setStartupOverlay(mode === 'restore' ? null : mode);
    });
  }, []);

  // Listen for sign-out events from anywhere in the app
  useEffect(() => {
    const handler = () => showFileChooser();
    window.addEventListener('fidra:showFileChooser', handler);
    return () => window.removeEventListener('fidra:showFileChooser', handler);
  }, [showFileChooser]);

  if (startupOverlay === 'loading' || authPending) {
    return (
      <>
        <AuthWiring />
        <ThemeWatcher />
        <UpdateToast />
        <div className="flex h-screen items-center justify-center bg-surface" />
      </>
    );
  }

  if (startupOverlay === 'wizard') {
    return (
      <>
        <AuthWiring />
        <ThemeWatcher />
        <UpdateToast />
        <SetupWizard onComplete={() => {
          window.location.hash = '#/';
          setStartupOverlay(null);
        }} />
      </>
    );
  }

  if (startupOverlay === 'chooser') {
    return (
      <>
        <AuthWiring />
        <ThemeWatcher />
        <UpdateToast />
        <FileChooserDialog onDismiss={() => {
          window.location.hash = '#/';
          setStartupOverlay(null);
        }} />
      </>
    );
  }

  // Auth gate blocks the ENTIRE app — no data visible until authenticated.
  // This check runs before any routes render, preventing even a flash of cached data
  if (showGate) {
    return (
      <>
        <AuthWiring />
        <LocalSyncEarlyWiring />
        <UpdateToast />
        <AuthGateDialog open={true} personnelEmpty={personnelEmpty} onDisconnected={showFileChooser} />
      </>
    );
  }

  return (
    <HashRouter>
      <AuthWiring />
      <ThemeWatcher />
      <GlobalKeyboardNav />
      <LocalSyncWiring />
      <LocalSyncConflictOverlay />
      <SyncToast />
      <UpdateToast />
      <WhileAwayWiring />
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <AnimatedMain />
      </div>
    </HashRouter>
  );
}
