import type { CloudServerConfig } from './ipc-types';

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
  reportOrgName: string;
}

export interface GlobalSettings {
  recentFiles: RecentFileEntry[];
  lastFile: string | null;
  lastOpenedAt: string | null;
  alwaysShowFileChooser: boolean;
  firstRunComplete: boolean;
  cloudServers: CloudServerConfig[];
  activeServerId: string | null;
  uiPreferences: UiPreferences;
  /** Per-machine display name for Local Sync (informational). Device ID is per-database in sync_meta. */
  localSyncDeviceName?: string;
  /** Saved CSV import profiles (cross-database, per-machine). */
  csvImportProfiles?: import('./csv-import-types').CsvImportProfile[];
}
