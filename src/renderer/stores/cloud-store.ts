import { create } from 'zustand';
import type { CloudServerConfig, CloudStatus } from '../../shared/ipc-types';
import { useAuthStore } from './auth-store';
import { useUiStore } from './ui-store';

export interface ConflictInfo {
  changeId: string;
  local: Record<string, unknown>;
  server: Record<string, unknown>;
  entityType: string;
}

interface CloudState {
  isCloudWindow: boolean;
  config: CloudServerConfig | null;
  connected: boolean;
  connecting: boolean;
  error: string | null;

  // Sync status
  connectionStatus: 'connected' | 'reconnecting' | 'offline' | 'offline-authenticated';
  isSyncing: boolean;
  pendingCount: number;

  // Conflicts (queue — resolved one at a time, FIFO)
  pendingConflicts: ConflictInfo[];

  // Store reload callback (set by App component)
  onDataChanged: ((tables: string[]) => void) | null;

  loadIsCloudWindow: () => Promise<void>;
  loadConfig: () => Promise<void>;
  saveConfig: (config: CloudServerConfig) => Promise<void>;
  deleteConfig: () => Promise<void>;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  testConnection: (connStr: string) => Promise<{ success: boolean; error?: string }>;
  refreshStatus: () => Promise<void>;
  syncNow: () => Promise<number>;
  reconnect: () => Promise<boolean>;
  resolveConflict: (changeId: string, useLocal: boolean) => Promise<void>;
  clearError: () => void;
  setOnDataChanged: (cb: (tables: string[]) => void) => void;
  initEventListeners: () => () => void;
}

export const useCloudStore = create<CloudState>((set, get) => ({
  isCloudWindow: false,
  config: null,
  connected: false,
  connecting: false,
  error: null,
  connectionStatus: 'offline',
  isSyncing: false,
  pendingCount: 0,
  pendingConflicts: [],
  onDataChanged: null,

  loadIsCloudWindow: async () => {
    const isCloud = await window.api.isCloudWindow();
    set({ isCloudWindow: isCloud });
  },

  loadConfig: async () => {
    const config = await window.api.getCloudConfig();
    const status = await window.api.getCloudStatus();
    set({
      config,
      connected: status.connected,
      connectionStatus: status.connectionStatus ?? 'offline',
      isSyncing: status.isSyncing ?? false,
      pendingCount: status.pendingCount ?? 0,
    });

    // Restore auth state from main process via auth-store actions (not direct setState)
    const effectiveAuthMode = status.authMode ?? config?.authMode ?? null;
    if (effectiveAuthMode === 'admin' || ((status.connected || status.connectionStatus === 'offline-authenticated') && status.authSession)) {
      useAuthStore.getState().hydrateFromCloudStatus(status.authSession ?? null, effectiveAuthMode);
    }
  },

  saveConfig: async (config: CloudServerConfig) => {
    await window.api.saveCloudConfig(config);
    set({ config });
  },

  deleteConfig: async () => {
    await window.api.deleteCloudConfig();
    set({
      config: null, connected: false, error: null,
      connectionStatus: 'offline', isSyncing: false, pendingCount: 0,
      pendingConflicts: [],
    });
  },

  connect: async () => {
    set({ connecting: true, error: null });
    try {
      const result = await window.api.connectCloud();
      if (result.success) {
        set({ connected: true, connecting: false, connectionStatus: 'connected' });
        // In admin mode, the user is implicitly authenticated as admin (no Supabase session)
        const config = get().config;
        if (config?.authMode === 'admin') {
          useAuthStore.getState().setAdminMode();
        }
        // Reload settings that may have been updated from cloud during connect
        useUiStore.getState().loadFYStartMonth();
        return true;
      } else {
        set({ connected: false, connecting: false, error: result.error ?? 'Connection failed' });
        return false;
      }
    } catch (e) {
      set({ connected: false, connecting: false, error: String(e) });
      return false;
    }
  },

  disconnect: async () => {
    await window.api.disconnectCloud();
    set({
      connected: false, error: null,
      connectionStatus: 'offline', isSyncing: false, pendingCount: 0,
      pendingConflicts: [],
    });
  },

  testConnection: async (connStr: string) => {
    return window.api.testCloudConnection(connStr);
  },

  refreshStatus: async () => {
    const status = await window.api.getCloudStatus();
    set({
      connected: status.connected,
      connectionStatus: status.connectionStatus ?? 'offline',
      isSyncing: status.isSyncing ?? false,
      pendingCount: status.pendingCount ?? 0,
    });
  },

  syncNow: async () => {
    return window.api.syncNow();
  },

  reconnect: async () => {
    const result = await window.api.reconnectCloud();
    return result.success;
  },

  resolveConflict: async (changeId: string, useLocal: boolean) => {
    await window.api.resolveConflict(changeId, useLocal);
    set((state) => ({
      pendingConflicts: state.pendingConflicts.filter((c) => c.changeId !== changeId),
    }));
  },

  clearError: () => set({ error: null }),

  setOnDataChanged: (cb) => set({ onDataChanged: cb }),

  initEventListeners: () => {
    const unsub1 = window.api.onSyncStatusChanged?.((data: unknown) => {
      const d = data as { isSyncing?: boolean; pendingCount?: number };
      set({
        isSyncing: d.isSyncing ?? false,
        pendingCount: d.pendingCount ?? 0,
      });
    });

    const unsub2 = window.api.onConnectionStatusChanged?.((status: string) => {
      const s = status as 'connected' | 'reconnecting' | 'offline' | 'offline-authenticated';
      set({
        connectionStatus: s,
        connected: s === 'connected',
      });
      // Admin mode: when connection comes up, ensure auth store reflects admin status
      if (s === 'connected') {
        const config = get().config;
        if (config?.authMode === 'admin') {
          useAuthStore.getState().setAdminMode();
        }
      }
    });

    const unsub3 = window.api.onConflictDetected?.((data: unknown) => {
      const d = data as {
        changeId: string;
        local: Record<string, unknown>;
        server: Record<string, unknown>;
      };
      // Determine entity type from the conflict data
      const entityType = d.local.start_date !== undefined ? 'planned_template' : 'transaction';
      const conflict: ConflictInfo = {
        changeId: d.changeId,
        local: d.local,
        server: d.server,
        entityType,
      };
      set((state) => {
        // Avoid duplicates (same changeId)
        if (state.pendingConflicts.some((c) => c.changeId === conflict.changeId)) {
          return state;
        }
        return { pendingConflicts: [...state.pendingConflicts, conflict] };
      });
    });

    const unsub4 = window.api.onDataChanged?.((tables: string[]) => {
      get().onDataChanged?.(tables);
    });

    return () => {
      unsub1?.();
      unsub2?.();
      unsub3?.();
      unsub4?.();
    };
  },
}));
