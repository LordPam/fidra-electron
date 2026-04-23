import { create } from 'zustand';
import { useAuthStore } from './auth-store';
import type {
  LocalSyncConfig,
  LocalSyncState,
  LocalSyncStatus,
  LocalSyncConflict,
} from '../../shared/ipc-types';

interface LocalSyncStoreState {
  // Status fields (from LocalSyncStatus)
  enabled: boolean;
  state: LocalSyncState;
  lastExportAt: string | null;
  lastImportAt: string | null;
  pendingConflicts: number;
  lastError: string | null;
  syncFolder: string | null;

  // Device config
  config: LocalSyncConfig | null;

  // Conflict queue for overlay
  conflicts: LocalSyncConflict[];

  // Loading state for setup
  configuring: boolean;

  // Data-changed callback (set by App wiring)
  onDataChanged: ((tables: string[]) => void) | null;

  // Actions
  loadStatus: () => Promise<void>;
  loadConfig: () => Promise<void>;
  configure: (syncFolder: string, passphrase: string) => Promise<{ success: boolean; error?: string }>;
  disconnect: () => Promise<void>;
  exportNow: () => Promise<void>;
  importNow: () => Promise<void>;
  loadConflicts: () => Promise<void>;
  resolveConflict: (id: string, resolution: 'keep-local' | 'accept-remote' | 'manual') => Promise<void>;
  setOnDataChanged: (cb: (tables: string[]) => void) => void;
  initEventListeners: () => () => void;
}

export const useLocalSyncStore = create<LocalSyncStoreState>((set, get) => ({
  enabled: false,
  state: 'stopped',
  lastExportAt: null,
  lastImportAt: null,
  pendingConflicts: 0,
  lastError: null,
  syncFolder: null,
  config: null,
  conflicts: [],
  configuring: false,
  onDataChanged: null,

  loadStatus: async () => {
    try {
      const status: LocalSyncStatus = await window.api.localSyncGetStatus();
      set({
        enabled: status.enabled,
        state: status.state,
        lastExportAt: status.lastExportAt,
        lastImportAt: status.lastImportAt,
        pendingConflicts: status.pendingConflicts,
        lastError: status.lastError,
        syncFolder: status.syncFolder,
      });
      // If there are pending conflicts, load them so the overlay can show them
      if (status.pendingConflicts > 0) {
        get().loadConflicts();
      }
    } catch {
      // Not configured or main process not ready
    }
  },

  loadConfig: async () => {
    try {
      const config = await window.api.localSyncGetConfig();
      set({ config });
    } catch {
      // Not configured
    }
  },

  configure: async (syncFolder, passphrase) => {
    set({ configuring: true });
    try {
      const result = await window.api.localSyncConfigure({ syncFolder, passphrase });
      if (result.success) {
        await get().loadStatus();
        await get().loadConfig();
      }
      set({ configuring: false });
      return result;
    } catch (e) {
      set({ configuring: false });
      return { success: false, error: String(e) };
    }
  },

  disconnect: async () => {
    await window.api.localSyncDisconnect();
    set({
      enabled: false,
      state: 'stopped',
      lastExportAt: null,
      lastImportAt: null,
      pendingConflicts: 0,
      lastError: null,
      syncFolder: null,
      config: null,
      conflicts: [],
    });
    // Reset auth state so personnel panel hides and auth gate doesn't show
    useAuthStore.setState({
      authMode: null,
      isAuthenticated: false,
      isAdmin: false,
      currentPersonnel: null,
      personnel: [],
    });
  },

  exportNow: async () => {
    try {
      await window.api.localSyncExportNow();
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
    }
  },

  importNow: async () => {
    try {
      await window.api.localSyncImportNow();
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
    }
  },

  loadConflicts: async () => {
    try {
      const conflicts = await window.api.localSyncGetConflicts();
      set({ conflicts });
    } catch {
      // Ignore
    }
  },

  resolveConflict: async (id, resolution) => {
    try {
      const result = await window.api.localSyncResolveConflict(id, resolution);
      if (result && result.success) {
        // Remove from overlay queue (all resolutions dismiss the current dialog)
        set((s) => ({
          conflicts: s.conflicts.filter((c) => c.id !== id),
          // "manual" (Review Later) doesn't actually resolve — conflict count stays
          pendingConflicts: resolution === 'manual'
            ? s.pendingConflicts
            : Math.max(0, s.pendingConflicts - 1),
        }));
      } else {
        // Resolution failed — reload conflicts from source of truth
        await get().loadConflicts();
      }
    } catch {
      // IPC failure — reload conflicts so overlay stays in sync
      await get().loadConflicts();
    }
  },

  setOnDataChanged: (cb) => set({ onDataChanged: cb }),

  initEventListeners: () => {
    const unsub1 = window.api.onLocalSyncStatusChanged((status) => {
      set({
        enabled: status.enabled,
        state: status.state,
        lastExportAt: status.lastExportAt,
        lastImportAt: status.lastImportAt,
        pendingConflicts: status.pendingConflicts,
        lastError: status.lastError,
        syncFolder: status.syncFolder,
      });
    });

    const unsub2 = window.api.onLocalSyncDataChanged((data) => {
      get().onDataChanged?.(data.tables);
    });

    const unsub3 = window.api.onLocalSyncConflictsDetected(() => {
      get().loadConflicts();
    });

    const unsub4 = window.api.onLocalSyncError((data) => {
      set({ lastError: data.message });
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
    };
  },
}));
