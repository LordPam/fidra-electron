import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useCloudStore } from '@/stores/cloud-store';
import logoLight from '@/assets/logo-light.svg';
import logoDark from '@/assets/logo-dark.svg';

interface AuthGateDialogProps {
  open: boolean;
  personnelEmpty: boolean;
  authMode?: 'admin' | 'member' | 'localSync' | null;
  onDisconnected?: () => void;
}

type Tab = 'signin' | 'signup' | 'create';

export function AuthGateDialog({ open, personnelEmpty, authMode, onDisconnected }: AuthGateDialogProps) {
  const {
    signIn, signUp, startOAuth, adminFirstSetup,
    localSignIn, localCreateFirstAdmin,
    loading, error, clearError,
  } = useAuthStore();
  const disconnect = useCloudStore((s) => s.disconnect);

  const isLocalSyncMode = authMode === 'localSync';
  const isMemberMode = authMode === 'member';
  // Admin mode can create personnel + auth accounts; member mode can only sign up (auth account only)
  const canAdminCreate = !isMemberMode && !isLocalSyncMode;
  const isFirstSetup = isLocalSyncMode ? personnelEmpty : (canAdminCreate && personnelEmpty);

  const [tab, setTab] = useState<Tab>(isFirstSetup ? 'create' : 'signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [syncPassphrase, setSyncPassphrase] = useState('');
  const [localError, setLocalError] = useState('');
  const [emailConfirmationSent, setEmailConfirmationSent] = useState(false);
  const [accountCreated, setAccountCreated] = useState(false);

  const displayError = localError || error;
  // Once an admin account is created, never show the first-setup form again
  const showFirstSetup = isFirstSetup && !accountCreated;

  const resetFields = () => {
    setName('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setSyncPassphrase('');
    setLocalError('');
    clearError();
  };

  const handleSignIn = async () => {
    if (!email.trim() || !password) return;
    setLocalError('');
    if (isLocalSyncMode) {
      await localSignIn(email.trim(), password);
    } else {
      await signIn(email.trim(), password);
    }
    // Gate will close when isAuthenticated becomes true
  };

  const handleSignUp = async () => {
    if (!email.trim()) {
      setLocalError('Email is required.');
      return;
    }
    if (!password) {
      setLocalError('Password is required.');
      return;
    }
    if (password !== confirmPassword) {
      setLocalError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters.');
      return;
    }
    setLocalError('');

    const result = await signUp(email.trim(), password) as { success: boolean; error?: string; needsEmailConfirmation?: boolean };
    if (!result.success) {
      setLocalError(result.error ?? 'Sign-up failed');
      return;
    }

    if (result.needsEmailConfirmation) {
      setEmailConfirmationSent(true);
      return;
    }

    // Email confirmation not required — sign in immediately
    const signedIn = await signIn(email.trim(), password);
    if (!signedIn) {
      // Show the actual sign-in error (e.g. "Not authorized") instead of hiding it
    }
  };

  const handleAdminCreate = async () => {
    if (!name.trim() || !email.trim()) {
      setLocalError('Name and email are required.');
      return;
    }
    if (!password) {
      setLocalError('Password is required.');
      return;
    }
    if (password !== confirmPassword) {
      setLocalError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters.');
      return;
    }

    if (isLocalSyncMode) {
      // Local Sync first-admin: passphrase is required
      if (!syncPassphrase.trim()) {
        setLocalError('Sync passphrase is required.');
        return;
      }
      setLocalError('');
      const result = await localCreateFirstAdmin(name.trim(), email.trim(), password, syncPassphrase.trim());
      if (!result.success) {
        setLocalError(result.error ?? 'Account creation failed');
        return;
      }
      setAccountCreated(true);
      // localCreateFirstAdmin already sets isAuthenticated — gate will close
      return;
    }

    setLocalError('');
    const result = await adminFirstSetup(name.trim(), email.trim(), password);
    if (!result.success) {
      setLocalError(result.error ?? 'Account creation failed');
      return;
    }

    setAccountCreated(true);
    // Try to sign in — if it fails, show the actual error
    const signedIn = await signIn(email.trim(), password);
    if (!signedIn) {
      // Check if the error looks like email confirmation
      const signInError = useAuthStore.getState().error;
      if (signInError?.toLowerCase().includes('email not confirmed')) {
        setEmailConfirmationSent(true);
        clearError();
      }
      // Otherwise, the error is already displayed via displayError
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (tab === 'signin') handleSignIn();
      else if (tab === 'signup') handleSignUp();
      else handleAdminCreate();
    }
  };

  const handleDisconnect = async () => {
    if (isLocalSyncMode) {
      await window.api.localSyncDisconnect();
      onDisconnected?.();
    } else {
      await disconnect();
      onDisconnected?.();
    }
  };

  if (!open) return null;

  // Determine header and subtitle
  let header: string;
  let subtitle: string;
  if (showFirstSetup && tab !== 'signin') {
    if (isLocalSyncMode) {
      header = 'Create Admin Account';
      subtitle = 'Set up authentication for this sync group. You\'ll need the sync passphrase to complete setup.';
    } else {
      header = 'Create First Admin Account';
      subtitle = 'No accounts exist on this server yet. Create the first admin account to get started.';
    }
  } else if (tab === 'signup') {
    header = 'Set Up Your Password';
    subtitle = 'Been invited? Create your login credentials using the email address your admin registered.';
  } else if (tab === 'create') {
    header = 'Create Account';
    subtitle = 'Create a new account on this server.';
  } else {
    header = 'Sign In';
    subtitle = isLocalSyncMode
      ? 'Sign in to access this synced database.'
      : 'Sign in to access this server.';
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface">
      {/* Logo */}
      <div className="absolute top-8 left-1/2 -translate-x-1/2">
        <img src={logoLight} alt="Fidra" className="h-10 w-10 object-contain dark:hidden" />
        <img src={logoDark} alt="Fidra" className="hidden h-10 w-10 object-contain dark:block" />
      </div>

      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border-subtle bg-surface-raised p-6 shadow-lg">
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold">{header}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>

        {/* Email confirmation message */}
        {emailConfirmationSent && (
          <div className="rounded-md bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 p-3 space-y-2">
            <p className="text-sm font-medium text-blue-900 dark:text-blue-100">Check your email</p>
            <p className="text-xs text-blue-700 dark:text-blue-300">
              Account created successfully. Please check your email and click the confirmation link, then sign in below.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setEmailConfirmationSent(false); setTab('signin'); }}
            >
              Sign In
            </Button>
          </div>
        )}

        {/* Tab switcher — admin mode with existing personnel (not for Local Sync) */}
        {canAdminCreate && !showFirstSetup && !emailConfirmationSent && (
          <div className="flex gap-2">
            <Button
              variant={tab === 'signin' ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => { setTab('signin'); resetFields(); }}
            >
              Sign In
            </Button>
            <Button
              variant={tab === 'create' ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => { setTab('create'); resetFields(); }}
            >
              Create Account
            </Button>
          </div>
        )}

        {displayError && !emailConfirmationSent && (
          <p className="text-sm text-destructive">{displayError}</p>
        )}

        {emailConfirmationSent ? null : (showFirstSetup && tab !== 'signin') || tab === 'create' ? (
          /* Admin create account form */
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="gate-name" className="text-sm">Name</Label>
              <Input
                id="gate-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Your Name"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gate-email" className="text-sm">Email</Label>
              <Input
                id="gate-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="admin@example.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gate-password" className="text-sm">Password</Label>
              <Input
                id="gate-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Minimum 6 characters"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gate-confirm" className="text-sm">Confirm Password</Label>
              <Input
                id="gate-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Confirm password"
              />
            </div>

            {/* Passphrase field for Local Sync first-admin setup */}
            {isLocalSyncMode && showFirstSetup && (
              <div className="space-y-1.5">
                <Label htmlFor="gate-passphrase" className="text-sm">Sync Passphrase</Label>
                <Input
                  id="gate-passphrase"
                  type="password"
                  value={syncPassphrase}
                  onChange={(e) => setSyncPassphrase(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="The shared sync passphrase"
                />
                <p className="text-xs text-muted-foreground">
                  The encryption passphrase used by your sync group.
                </p>
              </div>
            )}

            <Button
              className="w-full"
              onClick={handleAdminCreate}
              disabled={loading}
            >
              {loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {showFirstSetup ? 'Create Admin Account' : 'Create Account'}
            </Button>

            {/* Local Sync: always offer sign-in as alternative to create */}
            {isLocalSyncMode && (
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => { setTab('signin'); resetFields(); }}
              >
                Already have an account? Sign in
              </button>
            )}
          </div>
        ) : tab === 'signup' && !isLocalSyncMode ? (
          /* Member sign-up form (set password for invited user) — Cloud only */
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="gate-signup-email" className="text-sm">Email</Label>
              <Input
                id="gate-signup-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="The email your admin registered"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gate-signup-password" className="text-sm">Password</Label>
              <Input
                id="gate-signup-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Minimum 6 characters"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gate-signup-confirm" className="text-sm">Confirm Password</Label>
              <Input
                id="gate-signup-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Confirm password"
              />
            </div>

            <Button
              className="w-full"
              onClick={handleSignUp}
              disabled={loading}
            >
              {loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Set Password &amp; Sign In
            </Button>

            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => { setTab('signin'); resetFields(); }}
            >
              Already have a password? Sign in
            </button>
          </div>
        ) : (
          /* Sign in form */
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="gate-signin-email" className="text-sm">Email</Label>
              <Input
                id="gate-signin-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="you@example.com"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gate-signin-password" className="text-sm">Password</Label>
              <Input
                id="gate-signin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Password"
              />
            </div>

            <Button
              className="w-full"
              onClick={handleSignIn}
              disabled={loading || !email.trim() || !password}
            >
              {loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Sign In
            </Button>

            {/* Sign-up link — only for Cloud member mode */}
            {!isLocalSyncMode && !showFirstSetup && (
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => { setTab('signup'); resetFields(); }}
              >
                First time? Set up your password
              </button>
            )}

            {/* Back to setup link — Local Sync when first setup is pending */}
            {isLocalSyncMode && showFirstSetup && (
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => { setTab('create'); resetFields(); }}
              >
                Need to create an account? Set up
              </button>
            )}
          </div>
        )}

        <Separator />

        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={handleDisconnect}
        >
          Disconnect
        </Button>
      </div>
    </div>
  );
}
