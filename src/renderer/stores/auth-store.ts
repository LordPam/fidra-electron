import { create } from 'zustand';
import type { AuthMode, AuthSession, PersonnelRecord, PersonnelRole } from '../../shared/auth-types';

interface AuthState {
  session: AuthSession | null;
  currentPersonnel: PersonnelRecord | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  loading: boolean;
  error: string | null;
  isHydrated: boolean;
  authMode: AuthMode | null;

  // Personnel management
  personnel: PersonnelRecord[];

  // Actions
  initialize: () => Promise<void>;
  loadSession: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  startOAuth: (provider: 'google' | 'azure') => Promise<void>;
  adminFirstSetup: (name: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  loadPersonnel: () => Promise<void>;
  invitePersonnel: (name: string, email: string, role: PersonnelRole) => Promise<PersonnelRecord>;
  removePersonnel: (id: string) => Promise<{ success: boolean; error?: string }>;
  updatePersonnelRole: (id: string, role: PersonnelRole) => Promise<{ success: boolean; error?: string }>;
  clearError: () => void;
  initEventListeners: () => () => void;

  // Local Sync auth actions
  localSignIn: (email: string, password: string) => Promise<boolean>;
  localCreateFirstAdmin: (name: string, email: string, password: string, syncPassphrase: string) => Promise<{ success: boolean; error?: string }>;
  localInviteMember: (name: string, email: string, role: PersonnelRole) => Promise<{ success: boolean; inviteCode?: string; error?: string }>;
  localChangePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  localSignOut: () => Promise<void>;

  // Cloud-store delegates to these instead of direct setState
  setAdminMode: () => void;
  hydrateFromCloudStatus: (session: AuthSession | null, authMode: AuthMode | null) => void;
}

let personnelLoadInFlight = false;
let hydrationDone = false;

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  currentPersonnel: null,
  isAuthenticated: false,
  isAdmin: false,
  loading: false,
  error: null,
  isHydrated: false,
  authMode: null,
  personnel: [],

  initialize: async () => {
    if (hydrationDone) return;
    hydrationDone = true;

    // 1. Check if this is a cloud window
    const isCloud = await window.api.isCloudWindow();

    // 2. Check Local Sync auth status (works on any window type)
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

    if (!isCloud) {
      set({ isHydrated: true });
      return;
    }

    // 3. Fetch current auth state from main process (cloud)
    const status = await window.api.getCloudStatus();
    const authMode = (status.authMode as AuthMode) ?? null;
    set({ authMode });

    if (authMode === 'admin') {
      set({ isAuthenticated: true, isAdmin: true });
      await get().loadPersonnel();
    } else if (status.authSession) {
      const session = status.authSession as AuthSession;
      set({ session, isAuthenticated: true });
      await get().loadPersonnel();
    }
    // else: member mode with no session → gate will show

    set({ isHydrated: true });
  },

  loadSession: async () => {
    const session = (await window.api.authGetSession()) as AuthSession | null;
    if (session) {
      set({
        session,
        isAuthenticated: true,
        isAdmin: false, // Will be updated when personnel is loaded
      });
    }
  },

  signIn: async (email: string, password: string) => {
    set({ loading: true, error: null });
    try {
      const result = await window.api.authSignIn(email, password);
      if (result.success) {
        // Fetch the session that was just set by the main process
        const session = (await window.api.authGetSession()) as AuthSession | null;
        set({ loading: false, isAuthenticated: true, session });
        // Load personnel with session available to correctly resolve isAdmin
        if (session) {
          await get().loadPersonnel();
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

  signUp: async (email: string, password: string) => {
    set({ loading: true, error: null });
    try {
      const result = await window.api.authSignUp(email, password);
      set({ loading: false });
      return result;
    } catch (e) {
      set({ loading: false, error: String(e) });
      return { success: false, error: String(e) };
    }
  },

  signOut: async () => {
    await window.api.authSignOut();
    // Also disconnect from cloud — without auth the user shouldn't see cloud data
    await window.api.disconnectCloud();
    set({
      session: null,
      currentPersonnel: null,
      isAuthenticated: false,
      isAdmin: false,
      personnel: [],
      // Keep isHydrated true — we already know the window state,
      // auth gate will show based on isAuthenticated=false + authMode
    });
  },

  startOAuth: async (provider: 'google' | 'azure') => {
    set({ loading: true, error: null });
    const result = await window.api.authGetOAuthUrl(provider);
    if (result.error) {
      set({ loading: false, error: result.error });
    }
    // URL opened in browser, keep loading state until callback
  },

  adminFirstSetup: async (name: string, email: string, password: string) => {
    set({ loading: true, error: null });
    try {
      const result = await window.api.authAdminFirstSetup(name, email, password);
      set({ loading: false });
      return result;
    } catch (e) {
      set({ loading: false });
      return { success: false, error: String(e) };
    }
  },

  loadPersonnel: async () => {
    if (personnelLoadInFlight) return;
    personnelLoadInFlight = true;
    try {
      let records = (await window.api.getPersonnel()) as PersonnelRecord[];
      // Retry once if empty — may be a transient network issue in member mode
      if (records.length === 0) {
        await new Promise((r) => setTimeout(r, 500));
        records = (await window.api.getPersonnel()) as PersonnelRecord[];
      }
      let session = get().session;

      // Session may not be in store yet on startup if the
      // auth:sessionRestored event fired before our listener registered.
      // Fetch eagerly from main process to close the race window.
      if (!session) {
        session = (await window.api.authGetSession()) as AuthSession | null;
        if (session) {
          set({ session, isAuthenticated: true });
        }
      }

      if (session) {
        // Authenticated via Supabase — match personnel by session
        let current = records.find((p) => p.id === session.user.personnelId) ?? null;
        // Fallback: if personnelId is empty (e.g. after token refresh lost it),
        // match by Supabase auth UID or email
        if (!current && session.user.id) {
          current = records.find((p) => p.auth_uid === session.user.id) ?? null;
        }
        if (!current && session.user.email) {
          current = records.find((p) => p.email === session.user.email) ?? null;
        }
        set({
          personnel: records,
          currentPersonnel: current,
          isAdmin: current?.role === 'admin',
        });
      } else if (get().authMode === 'localSync') {
        // Local Sync auth — match personnel via localAuth status
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
        // Admin mode without Supabase session — preserve existing isAdmin flag,
        // just load personnel list for display
        set({ personnel: records });
      }
    } catch {
      // Personnel table might not exist yet
    } finally {
      personnelLoadInFlight = false;
    }
  },

  invitePersonnel: async (name: string, email: string, role: PersonnelRole) => {
    const record = (await window.api.invitePersonnel(name, email, role)) as PersonnelRecord;
    set((s) => ({ personnel: [...s.personnel, record] }));
    return record;
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
          // Only update isAdmin from currentPersonnel when we have one (authenticated mode).
          // In admin mode (no session/no currentPersonnel), preserve the existing flag.
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
        set({
          loading: false,
          isAuthenticated: true,
          isAdmin: result.isAdmin ?? false,
          authMode: 'localSync' as AuthMode,
        });
        await get().loadPersonnel();
        // Belt-and-suspenders: reload sync status so LocalSyncIndicator picks up running orchestrator
        try {
          const { useLocalSyncStore } = await import('./local-sync-store');
          const { loadStatus, loadConfig } = useLocalSyncStore.getState();
          await Promise.all([loadStatus(), loadConfig()]);
        } catch { /* non-fatal */ }
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

  localSignOut: async () => {
    await window.api.localAuthSignOut();
    set({
      isAuthenticated: false,
      isAdmin: false,
      currentPersonnel: null,
      personnel: [],
      // Keep authMode so the auth gate shows on next render
      authMode: 'localSync' as AuthMode,
    });
  },

  setAdminMode: () => {
    if (get().isAuthenticated) return;
    set({ isAuthenticated: true, isAdmin: true });
    get().loadPersonnel();
  },

  hydrateFromCloudStatus: (session, authMode) => {
    if (get().isHydrated || get().isAuthenticated) return;
    if (authMode === 'admin') {
      set({ isAuthenticated: true, isAdmin: true });
      get().loadPersonnel();
    } else if (session) {
      set({ session, isAuthenticated: true });
      get().loadPersonnel();
    }
  },

  initEventListeners: () => {
    const unsub1 = window.api.onAuthSessionChanged?.((session: unknown) => {
      const s = session as AuthSession | null;
      const wasAuthenticated = get().isAuthenticated;
      if (s) {
        set({ session: s, isAuthenticated: true, loading: false });
        get().loadPersonnel();
      } else {
        set({
          session: null,
          currentPersonnel: null,
          isAuthenticated: false,
          isAdmin: false,
          loading: false,
          personnel: [],
        });
        if (wasAuthenticated) {
          // Forced sign-out (e.g. self-removal) — disconnect and show file chooser
          window.api.disconnectCloud().then(() => {
            window.dispatchEvent(new CustomEvent('fidra:showFileChooser'));
          });
        }
      }
    });

    const unsub2 = window.api.onAuthOAuthCallback?.((code: string) => {
      // Forward the OAuth code to main process
      window.api.authOAuthCallback(code).then((result) => {
        if (!result.success) {
          set({ error: result.error ?? 'OAuth failed', loading: false });
        }
      });
    });

    // Session restored from saved credentials (no user interaction needed)
    const unsub3 = window.api.onAuthSessionRestored?.((session: unknown) => {
      const s = session as AuthSession;
      set({
        session: s,
        isAuthenticated: true,
        loading: false,
      });
      get().loadPersonnel();
    });

    return () => {
      unsub1?.();
      unsub2?.();
      unsub3?.();
    };
  },
}));
