import { useState } from 'react';
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
  const [mode, setMode] = useState<JoinMode>('invite');
  const [folder, setFolder] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [newDbPath, setNewDbPath] = useState('');
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
    try {
      let result;
      if (mode === 'invite') {
        if (!folder.trim() || !email.trim() || !inviteCode.trim() || !password.trim() || !newDbPath.trim()) {
          setError('All fields are required.');
          return;
        }
        if (password.length < 6) {
          setError('Password must be at least 6 characters.');
          return;
        }
        if (password !== confirmPassword) {
          setError('Passwords do not match.');
          return;
        }
        result = await window.api.localSyncJoinViaInvite({
          syncFolder: folder.trim(),
          email: email.trim(),
          inviteCode: inviteCode.trim().toUpperCase(),
          password: password.trim(),
          newDbPath: newDbPath.trim(),
        });
      } else {
        if (!folder.trim() || !passphrase.trim() || !newDbPath.trim()) {
          setError('All fields are required.');
          return;
        }
        result = await window.api.localSyncJoinGroup({
          syncFolder: folder.trim(),
          passphrase: passphrase.trim(),
          newDbPath: newDbPath.trim(),
        });
      }

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
      setLoading(false);
    }
  };

  const handleClose = (nextOpen: boolean) => {
    if (!loading) {
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
      }
    }
  };

  const canJoin = mode === 'invite'
    ? folder.trim() && email.trim() && inviteCode.trim() && password.trim() && confirmPassword.trim() && newDbPath.trim()
    : folder.trim() && passphrase.trim() && newDbPath.trim();

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderSync className="h-5 w-5" />
            Join Local Sync Group
          </DialogTitle>
          <DialogDescription>
            Join a team already sharing data via a shared folder. Your data will be populated from the latest snapshot.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Mode toggle */}
          <div className="flex rounded-md border p-0.5">
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
          </div>

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
              <div className="space-y-1.5">
                <label htmlFor="join-email" className="text-sm font-medium">Email</label>
                <Input
                  id="join-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Your email address"
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="join-invite-code" className="text-sm font-medium">Invite Code</label>
                <Input
                  id="join-invite-code"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="e.g. K7NP3HWR"
                  className="font-mono tracking-widest uppercase"
                  maxLength={8}
                  disabled={loading}
                />
                <p className="text-xs text-muted-foreground">
                  The 8-character code your admin shared with you.
                </p>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="join-password" className="text-sm font-medium">New Password</label>
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
              <div className="space-y-1.5">
                <label htmlFor="join-confirm-password" className="text-sm font-medium">Confirm Password</label>
                <Input
                  id="join-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  disabled={loading}
                />
              </div>
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
          <div className="space-y-1.5">
            <label htmlFor="join-save-location" className="text-sm font-medium">Save Location</label>
            <div className="flex gap-2">
              <Input
                id="join-save-location"
                value={newDbPath}
                readOnly
                placeholder="Choose where to save the new database..."
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={handleBrowseSaveLocation} disabled={loading}>
                Browse
              </Button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={loading}>
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
