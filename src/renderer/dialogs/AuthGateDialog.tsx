import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Loader2, FolderOpen } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import logoLight from '@/assets/logo-light.svg';
import logoDark from '@/assets/logo-dark.svg';

interface AuthGateDialogProps {
  open: boolean;
  personnelEmpty: boolean;
  onDisconnected?: () => void;
}

type Tab = 'signin' | 'create';

export function AuthGateDialog({ open, personnelEmpty, onDisconnected }: AuthGateDialogProps) {
  const {
    localSignIn, localCreateFirstAdmin, localReconnect,
    loading, error, clearError,
    needsSyncFolder,
  } = useAuthStore();

  const isFirstSetup = personnelEmpty;

  const [tab, setTab] = useState<Tab>(isFirstSetup ? 'create' : 'signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [syncPassphrase, setSyncPassphrase] = useState('');
  const [localError, setLocalError] = useState('');
  const [accountCreated, setAccountCreated] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState('');

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
    await localSignIn(email.trim(), password);
    // Gate will close when isAuthenticated becomes true
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
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (tab === 'signin') handleSignIn();
      else handleAdminCreate();
    }
  };

  const handleSelectFolder = async () => {
    const result = await window.api.showOpenDialog({
      title: 'Select Sync Folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    setSelectedFolder(result.filePaths[0]);
  };

  const handleReconnect = async () => {
    if (!selectedFolder) return;
    setLocalError('');
    const result = await localReconnect(selectedFolder);
    if (!result.success) {
      setLocalError(result.error ?? 'Reconnect failed');
    }
    // Gate will close when isAuthenticated becomes true
  };

  if (!open) return null;

  // ─── Reconnect: folder picker step (after sign-in with missing sync folder) ───
  if (needsSyncFolder) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface">
        <div className="absolute top-8 left-1/2 -translate-x-1/2">
          <img src={logoLight} alt="Fidra" className="h-10 w-10 object-contain dark:hidden" />
          <img src={logoDark} alt="Fidra" className="hidden h-10 w-10 object-contain dark:block" />
        </div>

        <div className="w-full max-w-sm space-y-4 rounded-lg border border-border-subtle bg-surface-raised p-6 shadow-lg">
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold">Reconnect Sync Folder</h2>
            <p className="text-sm text-muted-foreground">
              Your account was found, but the sync folder needs to be reconnected. Select the shared folder used by your sync group.
            </p>
          </div>

          {displayError && (
            <p className="text-sm text-destructive">{displayError}</p>
          )}

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-sm">Sync Folder</Label>
              <div className="flex gap-2">
                <Input
                  value={selectedFolder}
                  readOnly
                  placeholder="No folder selected"
                  className="flex-1 text-xs"
                />
                <Button variant="outline" size="sm" onClick={handleSelectFolder}>
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <Button
              className="w-full"
              onClick={handleReconnect}
              disabled={loading || !selectedFolder}
            >
              {loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Reconnect
            </Button>
          </div>

          <Separator />

          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            onClick={onDisconnected}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // ─── Normal auth gate ─────────────────────────────────────────────

  // Determine header and subtitle
  let header: string;
  let subtitle: string;
  if (showFirstSetup && tab !== 'signin') {
    header = 'Create Admin Account';
    subtitle = 'Set up authentication for this sync group. You\'ll need the sync passphrase to complete setup.';
  } else {
    header = 'Sign In';
    subtitle = 'Sign in to access this synced database.';
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

        {displayError && (
          <p className="text-sm text-destructive">{displayError}</p>
        )}

        {(showFirstSetup && tab !== 'signin') ? (
          /* First-admin create account form */
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

            <Button
              className="w-full"
              onClick={handleAdminCreate}
              disabled={loading}
            >
              {loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Create Admin Account
            </Button>

            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => { setTab('signin'); resetFields(); }}
            >
              Already have an account? Sign in
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

            {/* Back to setup link — when first setup is pending */}
            {showFirstSetup && (
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
          onClick={() => onDisconnected?.()}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
