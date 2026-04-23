import { create } from 'zustand';
import type { ThemeMode } from '../../shared/global-settings-types';

type DashboardPeriod = 'month' | '90days' | 'fy';

export type ZoomKey = 'tableZoom' | 'plannedTableZoom' | 'activitiesTableZoom';

interface UiState {
  searchQuery: string;
  filteredBalanceMode: boolean;
  error: string | null;
  tableZoom: number;
  plannedTableZoom: number;
  activitiesTableZoom: number;
  showAddForm: boolean;
  addFormWidth: number;
  showPlanned: boolean;
  horizonDays: number;
  dashboardPeriod: DashboardPeriod;
  theme: ThemeMode;
  reportOrgName: string;
  fyStartMonth: number;

  setSearchQuery: (q: string) => void;
  toggleFilteredBalance: () => void;
  showError: (msg: string) => void;
  clearError: () => void;
  adjustZoom: (key: ZoomKey, action: 'in' | 'out' | 'reset') => void;
  setShowAddForm: (show: boolean) => void;
  toggleAddForm: () => void;
  setAddFormWidth: (width: number) => void;
  toggleShowPlanned: () => void;
  setHorizonDays: (days: number) => void;
  setDashboardPeriod: (period: DashboardPeriod) => void;
  setTheme: (theme: ThemeMode) => void;
  setReportOrgName: (name: string) => void;
  setFYStartMonth: (month: number) => void;
  loadFYStartMonth: () => Promise<void>;
  loadUiPreferences: () => Promise<void>;
}

const TABLE_ZOOM_MIN = 0.5;
const TABLE_ZOOM_MAX = 1.5;
const TABLE_ZOOM_STEP = 0.1;
const DEFAULT_ZOOM = 0.8;

function persistPrefs(state: UiState): void {
  window.api.saveUiPreferences({
    tableZoom: state.tableZoom,
    plannedTableZoom: state.plannedTableZoom,
    activitiesTableZoom: state.activitiesTableZoom,
    showPlanned: state.showPlanned,
    filteredBalanceMode: state.filteredBalanceMode,
    theme: state.theme,
    reportOrgName: state.reportOrgName,
  });
}

export const useUiStore = create<UiState>((set, get) => ({
  searchQuery: '',
  filteredBalanceMode: false,
  error: null,
  tableZoom: DEFAULT_ZOOM,
  plannedTableZoom: DEFAULT_ZOOM,
  activitiesTableZoom: DEFAULT_ZOOM,
  showAddForm: true,
  addFormWidth: 240,
  showPlanned: false,
  horizonDays: 90,
  dashboardPeriod: '90days',
  theme: 'system',
  reportOrgName: '',
  fyStartMonth: 1,

  setSearchQuery: (q: string) => set({ searchQuery: q }),
  toggleFilteredBalance: () => {
    set((state) => ({ filteredBalanceMode: !state.filteredBalanceMode }));
    persistPrefs(get());
  },
  showError: (msg: string) => set({ error: msg }),
  clearError: () => set({ error: null }),
  adjustZoom: (key, action) => {
    if (action === 'reset') {
      set({ [key]: DEFAULT_ZOOM });
    } else {
      const delta = action === 'in' ? TABLE_ZOOM_STEP : -TABLE_ZOOM_STEP;
      set((state) => ({
        [key]: Math.min(TABLE_ZOOM_MAX, Math.max(TABLE_ZOOM_MIN, Math.round((state[key] + delta) * 10) / 10)),
      }));
    }
    persistPrefs(get());
  },
  setShowAddForm: (show: boolean) => set({ showAddForm: show }),
  toggleAddForm: () => set((state) => ({ showAddForm: !state.showAddForm })),
  setAddFormWidth: (width: number) => set({ addFormWidth: Math.max(240, Math.min(480, width)) }),
  toggleShowPlanned: () => {
    set((state) => ({ showPlanned: !state.showPlanned }));
    persistPrefs(get());
  },
  setHorizonDays: (days: number) => set({ horizonDays: Math.max(7, Math.min(365, days)) }),
  setDashboardPeriod: (period: DashboardPeriod) => set({ dashboardPeriod: period }),
  setTheme: (theme) => {
    set({ theme });
    persistPrefs(get());
  },
  setReportOrgName: (name: string) => {
    set({ reportOrgName: name });
    persistPrefs(get());
  },
  setFYStartMonth: (month: number) => {
    set({ fyStartMonth: month });
    window.api.saveFYStartMonth(month);
  },
  loadFYStartMonth: async () => {
    try {
      const month = await window.api.getFYStartMonth();
      set({ fyStartMonth: month });
    } catch {
      // Keep default
    }
  },
  loadUiPreferences: async () => {
    try {
      const prefs = await window.api.getUiPreferences();
      set({
        tableZoom: prefs.tableZoom ?? DEFAULT_ZOOM,
        plannedTableZoom: prefs.plannedTableZoom ?? DEFAULT_ZOOM,
        activitiesTableZoom: prefs.activitiesTableZoom ?? DEFAULT_ZOOM,
        showPlanned: prefs.showPlanned ?? false,
        filteredBalanceMode: prefs.filteredBalanceMode ?? false,
        theme: prefs.theme ?? 'system',
        reportOrgName: prefs.reportOrgName ?? '',
      });
    } catch {
      // Settings file not available yet — keep defaults
    }
    // Load per-database FY start month
    try {
      const month = await window.api.getFYStartMonth();
      set({ fyStartMonth: month });
    } catch {
      // Keep default
    }
  },
}));
