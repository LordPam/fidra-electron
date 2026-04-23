import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AuthSession, AuthUser } from '../../../shared/auth-types';

export class SupabaseAuth {
  private readonly client: SupabaseClient;

  constructor(projectUrl: string, anonKey: string) {
    this.client = createClient(projectUrl, anonKey, {
      auth: {
        autoRefreshToken: false, // We manage refresh ourselves
        persistSession: false, // We persist via SessionStore
        detectSessionInUrl: false, // Desktop app, not browser
      },
    });
  }

  async signUp(email: string, password: string): Promise<{ session: AuthSession | null; userId: string | null; error: string | null }> {
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) return { session: null, userId: null, error: error.message };
    // When email confirmation is enabled, session is null but user.id is available
    const userId = data.user?.id ?? null;
    if (!data.session) return { session: null, userId, error: null };
    return { session: toAuthSession(data.session), userId, error: null };
  }

  async signIn(email: string, password: string): Promise<{ session: AuthSession | null; error: string | null }> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) return { session: null, error: error.message };
    if (!data.session) return { session: null, error: 'Sign-in returned no session' };
    return { session: toAuthSession(data.session), error: null };
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  async refreshSession(refreshToken: string): Promise<{ session: AuthSession | null; error: string | null }> {
    const { data, error } = await this.client.auth.refreshSession({ refresh_token: refreshToken });
    if (error) return { session: null, error: error.message };
    if (!data.session) return { session: null, error: 'Refresh returned no session' };
    return { session: toAuthSession(data.session), error: null };
  }

  async getOAuthUrl(provider: 'google' | 'azure', redirectUrl: string): Promise<{ url: string | null; error: string | null }> {
    const supabaseProvider = provider === 'azure' ? 'azure' : 'google';
    const { data, error } = await this.client.auth.signInWithOAuth({
      provider: supabaseProvider,
      options: { redirectTo: redirectUrl, skipBrowserRedirect: true },
    });
    if (error) return { url: null, error: error.message };
    return { url: data.url, error: null };
  }

  async exchangeCodeForSession(code: string): Promise<{ session: AuthSession | null; error: string | null }> {
    const { data, error } = await this.client.auth.exchangeCodeForSession(code);
    if (error) return { session: null, error: error.message };
    if (!data.session) return { session: null, error: 'Code exchange returned no session' };
    return { session: toAuthSession(data.session), error: null };
  }
}

function toAuthSession(session: { access_token: string; refresh_token: string; expires_at?: number; user: { id: string; email?: string } }): AuthSession {
  return {
    user: {
      id: session.user.id,
      email: session.user.email ?? '',
      personnelId: '', // Will be populated after personnel lookup
    },
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
  };
}
