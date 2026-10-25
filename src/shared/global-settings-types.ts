export interface RecentFileEntry {
  readonly path: string;
  readonly name: string;
  readonly lastOpenedAt: string;
}

export type ThemeMode = 'system' | 'light' | 'dark';

export interface UiPreferences {
  tableZoom: number;
  plannedTableZoom: number;
  activitiesTableZoom: number;
  showPlanned: boolean;
  filteredBalanceMode: boolean;
  theme: ThemeMode;
  /** Sidebar shows icons only (labels hidden, tooltips on hover) when true. */
  sidebarCollapsed: boolean;
  /** @deprecated Moved to per-database SQLite settings (report.orgName, org-scoped). Kept for backwards compat with existing settings files. */
  reportOrgName?: string;
}

export interface GlobalSettings {
  /** Ledger windows to restore after a deliberate update handoff. */
  updateReopenPaths?: string[];
  recentFiles: RecentFileEntry[];
  lastFile: string | null;
  lastOpenedAt: string | null;
  alwaysShowFileChooser: boolean;
  firstRunComplete: boolean;
  uiPreferences: UiPreferences;
  /** Per-machine display name for Local Sync (informational). Device ID is per-database in sync_meta. */
  localSyncDeviceName?: string;
  /** Saved CSV import profiles (cross-database, per-machine). */
  csvImportProfiles?: import('./csv-import-types').CsvImportProfile[];
  /** Suppress the warning shown when opening a database from a cloud-synced folder. */
  suppressCloudFolderWarning?: boolean;
}
