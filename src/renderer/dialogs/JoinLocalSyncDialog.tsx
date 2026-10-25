import type { FidraInvitation } from '../../shared/invitation-types';
import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Eye, EyeOff, Loader2, AlertCircle, AlertTriangle, FolderSync } from 'lucide-react';

type JoinMode = 'invite' | 'passphrase';

interface JoinLocalSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

export function JoinLocalSyncDialog({ open, onOpenChange, onComplete }: JoinLocalSyncDialogProps) {
  const [invitation, setInvitation] = useState<FidraInvitation | null>(null);
  const [mode, setMode] = useState<JoinMode>('invite');
  const [folder, setFolder] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [newDbPath, setNewDbPath] = useState('');
  const joinAbort = useRef<AbortController | null>(null);
  useEffect(() => () => joinAbort.current?.abort(), []);
  const [waiting, setWaiting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Folder validation state
  const [folderWarning, setFolderWarning] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);

  const handleBrowseFolder = async () => {
    const result = await window.api.showOpenDialog({
      title: 'Select Shared Sync Folder',
      properties: ['openDirectory'],
    });
    if (!result.canceled && result.filePaths[0]) {
      const selectedFolder = result.filePaths[0];
      setFolder(selectedFolder);
      setFolderWarning(null);
      setFolderError(null);

      // Validate the selected folder
      try {
        const validation = await window.api.localSyncValidateFolder(selectedFolder);
        if (!validation.valid) {
          setFolderError(validation.message);
          setFolder('');
        } else if (validation.warning) {
          setFolderWarning(validation.message);
        }
      } catch {
        // Validation failed — allow folder but don't block
      }
    }
  };

  const handleBrowseSaveLocation = async () => {
    const result = await window.api.showSaveDialog({
      title: 'Save New Database As',
      defaultPath: 'finances.fdra',
      filters: [{ name: 'Fidra Database', extensions: ['fdra'] }],
    });
    if (!result.canceled && result.filePath) {
      setNewDbPath(result.filePath);
    }
  };

  const handleJoin = async () => {
    setError(null);
    setLoading(true);
    joinAbort.current?.abort();
    const controller = new AbortController();
    joinAbort.current = controller;
    try {
      let result;
      if (mode === 'invite') {
        if (!folder.trim() || !email.trim() || !inviteCode.trim() || !password.trim()) {
          setError('Choose your shared folder and complete the sign-in details.');
          return;
        }
        if (password.length < 6) {
          setError('Password must be at least 6 characters.');
          return;
        }
        if (!invitation?.existingAccount && password !== confirmPassword) {
          setError('Passwords do not match.');
          return;
        }
        result = await window.api.localSyncJoinViaInvite({
          syncFolder: folder.trim(),
          email: email.trim(),
          inviteCode: inviteCode.trim().toUpperCase(),
          password: password,
          newDbPath: newDbPath.trim() || undefined,
        });
      } else {
        if (!folder.trim() || !passphrase.trim()) {
          setError('Choose your shared folder and complete the sign-in details.');
          return;
        }
        result = await window.api.localSyncJoinGroup({
          syncFolder: folder.trim(),
          passphrase: passphrase.trim(),
          newDbPath: newDbPath.trim() || undefined,
        });
      }

      for (let attempt = 0; result.retryable && attempt < 24 && !controller.signal.aborted; attempt++) {
        setWaiting(true); setError('Waiting for OneDrive to download the invitation and team data… You can cancel and return later.');
        await new Promise((resolve) => setTimeout(resolve, 5000));
        if (controller.signal.aborted) return;
        result = mode === 'invite'
          ? await window.api.localSyncJoinViaInvite({ syncFolder: folder.trim(), email: email.trim(), inviteCode: inviteCode.trim().toUpperCase(), password, newDbPath: newDbPath.trim() || undefined })
          : await window.api.localSyncJoinGroup({ syncFolder: folder.trim(), passphrase, newDbPath: newDbPath.trim() || undefined });
      }
      if (controller.signal.aborted) return;
      setWaiting(false);
      if (result.success && result.newDbPath) {
        onOpenChange(false);
        const switchResult = await window.api.switchToFile(result.newDbPath);
        if (switchResult.success && !switchResult.reloading) {
          onComplete?.();
        }
      } else {
        setError(result.error ?? 'Failed to join Local Sync group.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error.');
    } finally {
      if (joinAbort.current === controller) { setLoading(false); setWaiting(false); }
    }
  };

  const handleClose = (nextOpen: boolean) => {
    if (!loading || waiting) {
      joinAbort.current?.abort();
      onOpenChange(nextOpen);
      if (!nextOpen) {
        setFolder('');
        setPassphrase('');
        setEmail('');
        setInviteCode('');
        setPassword('');
        setConfirmPassword('');
        setNewDbPath('');
        setError(null);
        setFolderWarning(null);
        setFolderError(null);
        setMode('invite');
        setInvitation(null);
      }
    }
  };

  const canJoin = mode === 'invite'
    ? folder.trim() && email.trim() && inviteCode.trim() && password.trim() && (invitation?.existingAccount || confirmPassword.trim())
    : folder.trim() && passphrase.trim();

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderSync className="h-5 w-5" />
            Join a team
          </DialogTitle>
          <DialogDescription>
            Join a team already sharing data via a shared folder. Fidra will prepare a local copy of your team’s accounts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {mode === 'invite' && <div className="space-y-2">
            <Button variant="outline" disabled={loading} onClick={async () => {
              try {
                const result = await window.api.openInvitation();
                if (!result) return;
                setInvitation(result.invitation); setEmail(result.invitation.email); setInviteCode(result.invitation.code);
                if (result.syncFolder) setFolder(result.syncFolder);
                setError(null);
              } catch (error) { setError(String(error)); }
            }}>Open invitation</Button>
            {invitation && <p className="text-sm">{invitation.existingAccount ? 'Sign in to' : 'Join'} <strong>{invitation.team}</strong> as {invitation.name} ({invitation.email}).</p>}
          </div>}
          {/* Mode toggle */}
          {!invitation && <div className="flex rounded-md border p-0.5">
            <button
              type="button"
              className={`flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === 'invite'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setMode('invite')}
              disabled={loading}
            >
              Invite Code
            </button>
            <button
              type="button"
              className={`flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === 'passphrase'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setMode('passphrase')}
              disabled={loading}
            >
              Passphrase
            </button>
          </div>}

          {/* Sync folder */}
          <div className="space-y-1.5">
            <label htmlFor="join-sync-folder" className="text-sm font-medium">Sync Folder</label>
            <div className="flex gap-2">
              <Input
                id="join-sync-folder"
                value={folder}
                readOnly
                placeholder="Select the shared sync folder..."
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={handleBrowseFolder} disabled={loading}>
                Browse
              </Button>
            </div>
            {folderError && (
              <div className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{folderError}</span>
              </div>
            )}
            {folderWarning && (
              <div className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{folderWarning}</span>
              </div>
            )}
          </div>

          {/* Invite mode: email + invite code + new password */}
          {mode === 'invite' && (
            <>
              {!invitation && <div className="space-y-1.5">
                <label htmlFor="join-email" className="text-sm font-medium">Email</label>
                <Input
                  id="join-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Your email address"
                  disabled={loading}
                />
              </div>}
              {!invitation && <div className="space-y-1.5">
                <label htmlFor="join-invite-code" className="text-sm font-medium">Invite Code</label>
                <Input
                  id="join-invite-code"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="e.g. K7NP3HWR"
                  className="font-mono tracking-widest uppercase"
                  maxLength={64}
                  disabled={loading}
                />
                <p className="text-xs text-muted-foreground">
                  The access code your admin shared with you. Opening an invitation fills this in automatically.
                </p>
              </div>}
              <div className="space-y-1.5">
                <label htmlFor="join-password" className="text-sm font-medium">{invitation?.existingAccount ? 'Your existing password' : 'Choose a password'}</label>
                <div className="relative">
                  <Input
                    id="join-password"
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    className="pr-10"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPass(!showPass)}
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {!invitation?.existingAccount && <div className="space-y-1.5">
                <label htmlFor="join-confirm-password" className="text-sm font-medium">Confirm Password</label>
                <Input
                  id="join-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  disabled={loading}
                />
              </div>}
            </>
          )}

          {/* Passphrase mode */}
          {mode === 'passphrase' && (
            <div className="space-y-1.5">
              <label htmlFor="join-passphrase" className="text-sm font-medium">Passphrase</label>
              <div className="relative">
                <Input
                  id="join-passphrase"
                  type={showPass ? 'text' : 'password'}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Team encryption passphrase"
                  className="pr-10"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPass(!showPass)}
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Use the same passphrase as your team members.
              </p>
            </div>
          )}

          {/* Save location */}
          <details className="space-y-1.5"><summary className="cursor-pointer text-sm">Choose a different local location (optional)</summary>
          <div className="space-y-1.5">
            <label htmlFor="join-save-location" className="text-sm font-medium">Save Location</label>
            <div className="flex gap-2">
              <Input
                id="join-save-location"
                value={newDbPath}
                readOnly
                placeholder="Fidra chooses a safe local location"
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={handleBrowseSaveLocation} disabled={loading}>
                Browse
              </Button>
            </div>
          </div>

          </details>
          {error && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={loading && !waiting}>
            Cancel
          </Button>
          <Button
            onClick={handleJoin}
            disabled={loading || !canJoin}
          >
            {loading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Join
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
