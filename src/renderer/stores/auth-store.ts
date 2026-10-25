import { create } from 'zustand';
import type { AuthMode, PersonnelRecord, PersonnelRole } from '../../shared/auth-types';

interface AuthState {
  currentPersonnel: PersonnelRecord | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  loading: boolean;
  error: string | null;
  isHydrated: boolean;
  authMode: AuthMode | null;
  /** True when sign-in succeeded but the sync folder setting was lost (e.g. after disconnect). */
  needsSyncFolder: boolean;

  // Personnel management
  personnel: PersonnelRecord[];

  // Actions
  initialize: () => Promise<void>;
  loadPersonnel: () => Promise<void>;
  removePersonnel: (id: string) => Promise<{ success: boolean; error?: string }>;
  updatePersonnelRole: (id: string, role: PersonnelRole) => Promise<{ success: boolean; error?: string }>;
  clearError: () => void;
  initEventListeners: () => () => void;

  // Local Sync auth actions
  localSignIn: (email: string, password: string) => Promise<boolean>;
  localCreateFirstAdmin: (name: string, email: string, password: string, syncPassphrase: string) => Promise<{ success: boolean; error?: string }>;
  localInviteMember: (name: string, email: string, role: PersonnelRole) => Promise<{ success: boolean; invitation?: import('../../shared/invitation-types').FidraInvitation; inviteCode?: string; error?: string }>;
  localChangePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  localReconnect: (syncFolder: string) => Promise<{ success: boolean; error?: string }>;
  localSignOut: () => Promise<void>;
}

let personnelLoadInFlight = false;
let hydrationDone = false;

export const useAuthStore = create<AuthState>((set, get) => ({
  currentPersonnel: null,
  isAuthenticated: false,
  isAdmin: false,
  loading: false,
  error: null,
  isHydrated: false,
  authMode: null,
  needsSyncFolder: false,
  personnel: [],

  initialize: async () => {
    if (hydrationDone) return;
    hydrationDone = true;

    // Check Local Sync auth status — the only auth backend
    const localAuthStatus = await window.api.localAuthGetStatus();
    if (localAuthStatus.authEnabled) {
      if (localAuthStatus.isAuthenticated && localAuthStatus.personnel) {
        set({
          isAuthenticated: true,
          isAdmin: localAuthStatus.isAdmin,
          authMode: 'localSync' as AuthMode,
          isHydrated: true,
        });
        await get().loadPersonnel();
        return;
      }
      // Auth enabled but not authenticated — gate will show
      set({ authMode: 'localSync' as AuthMode, isHydrated: true });
      return;
    }

    set({ isHydrated: true });
  },

  loadPersonnel: async () => {
    if (personnelLoadInFlight) return;
    personnelLoadInFlight = true;
    try {
      const records = (await window.api.getPersonnel()) as PersonnelRecord[];
      if (get().authMode === 'localSync') {
        // Match personnel via localAuth status
        const localStatus = await window.api.localAuthGetStatus();
        const current = localStatus.personnel
          ? records.find((p) => p.id === localStatus.personnel!.id) ?? null
          : null;
        set({
          personnel: records,
          currentPersonnel: current,
          isAdmin: current?.role === 'admin',
        });
      } else {
        set({ personnel: records });
      }
    } catch {
      // Personnel table might not exist yet
    } finally {
      personnelLoadInFlight = false;
    }
  },

  removePersonnel: async (id: string) => {
    const result = await window.api.removePersonnel(id);
    if (result.success) {
      set((s) => ({ personnel: s.personnel.filter((p) => p.id !== id) }));
    }
    return result;
  },

  updatePersonnelRole: async (id: string, role: PersonnelRole) => {
    const result = await window.api.updatePersonnelRole(id, role);
    if (result.success) {
      set((s) => {
        const updatedPersonnel = s.personnel.map((p) => (p.id === id ? { ...p, role } : p));
        const isSelf = s.currentPersonnel?.id === id;
        const updatedCurrent = isSelf ? { ...s.currentPersonnel!, role } : s.currentPersonnel;
        return {
          personnel: updatedPersonnel,
          currentPersonnel: updatedCurrent,
          isAdmin: updatedCurrent ? updatedCurrent.role === 'admin' : s.isAdmin,
        };
      });
    }
    return result;
  },

  clearError: () => set({ error: null }),

  localSignIn: async (email: string, password: string) => {
    set({ loading: true, error: null });
    try {
      const result = await window.api.localAuthSignIn({ email, password });
      if (result.success) {
        if (result.needsSyncFolder) {
          // Signed in but sync folder is missing (e.g. after disconnect).
          // Keep auth gate open — it will show the folder picker step.
          set({
            loading: false,
            isAuthenticated: false,
            isAdmin: result.isAdmin ?? false,
            authMode: 'localSync' as AuthMode,
            needsSyncFolder: true,
          });
        } else {
          set({
            loading: false,
            isAuthenticated: true,
            isAdmin: result.isAdmin ?? false,
            authMode: 'localSync' as AuthMode,
            needsSyncFolder: false,
          });
          await get().loadPersonnel();
          // Belt-and-suspenders: reload sync status so LocalSyncIndicator picks up running orchestrator
          try {
            const { useLocalSyncStore } = await import('./local-sync-store');
            const { loadStatus, loadConfig } = useLocalSyncStore.getState();
            await Promise.all([loadStatus(), loadConfig()]);
          } catch { /* non-fatal */ }
        }
        return true;
      }
      set({ loading: false, error: result.error ?? 'Sign-in failed' });
      return false;
    } catch (e) {
      set({ loading: false, error: String(e) });
      return false;
    }
  },

  localCreateFirstAdmin: async (name: string, email: string, password: string, syncPassphrase: string) => {
    set({ loading: true, error: null });
    try {
      const result = await window.api.localAuthCreateFirstAdmin({ name, email, password, syncPassphrase });
      if (result.success) {
        set({
          loading: false,
          isAuthenticated: true,
          isAdmin: true,
          authMode: 'localSync' as AuthMode,
        });
        await get().loadPersonnel();
        return { success: true };
      }
      set({ loading: false });
      return result;
    } catch (e) {
      set({ loading: false });
      return { success: false, error: String(e) };
    }
  },

  localInviteMember: async (name: string, email: string, role: PersonnelRole) => {
    try {
      const result = await window.api.localAuthInviteMember({ name, email, role });
      if (result.success) {
        await get().loadPersonnel();
      }
      return result;
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  localChangePassword: async (oldPassword: string, newPassword: string) => {
    try {
      return await window.api.localAuthChangePassword({ oldPassword, newPassword });
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  localReconnect: async (syncFolder: string) => {
    set({ loading: true, error: null });
    try {
      const result = await window.api.localSyncReconnect({ syncFolder });
      if (result.success) {
        set({
          loading: false,
          isAuthenticated: true,
          needsSyncFolder: false,
        });
        await get().loadPersonnel();
        try {
          const { useLocalSyncStore } = await import('./local-sync-store');
          const { loadStatus, loadConfig } = useLocalSyncStore.getState();
          await Promise.all([loadStatus(), loadConfig()]);
        } catch { /* non-fatal */ }
      } else {
        set({ loading: false, error: result.error ?? 'Reconnect failed' });
      }
      return result;
    } catch (e) {
      set({ loading: false, error: String(e) });
      return { success: false, error: String(e) };
    }
  },

  localSignOut: async () => {
    await window.api.localAuthSignOut();
    set({
      isAuthenticated: false,
      isAdmin: false,
      currentPersonnel: null,
      personnel: [],
      needsSyncFolder: false,
      // Keep authMode so the auth gate shows on next render
      authMode: 'localSync' as AuthMode,
    });
  },

  initEventListeners: () => {
    // Local Sync: admin deleted this user's personnel record via sync
    const unsub = window.api.onLocalSyncForceSignOut?.(() => {
      set({
        isAuthenticated: false,
        isAdmin: false,
        currentPersonnel: null,
        personnel: [],
        needsSyncFolder: false,
        authMode: 'localSync' as AuthMode,
        error: 'Your account has been removed by an administrator.',
      });
    });

    return () => {
      unsub?.();
    };
  },
}));
