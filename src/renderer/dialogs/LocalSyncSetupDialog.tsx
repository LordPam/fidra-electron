import { useState, useEffect } from 'react';
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
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { FolderSync, Eye, EyeOff, Loader2, AlertCircle, AlertTriangle, Camera, UserPlus, Trash2, Key } from 'lucide-react';
import { useLocalSyncStore } from '@/stores/local-sync-store';
import { useAuthStore } from '@/stores/auth-store';
import { formatRelativeTime } from '@/lib/format';
import type { PersonnelRecord, PersonnelRole } from '../../shared/auth-types';

interface LocalSyncSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LocalSyncSetupDialog({ open, onOpenChange }: LocalSyncSetupDialogProps) {
  const enabled = useLocalSyncStore((s) => s.enabled);
  const state = useLocalSyncStore((s) => s.state);
  const syncFolder = useLocalSyncStore((s) => s.syncFolder);
  const lastExportAt = useLocalSyncStore((s) => s.lastExportAt);
  const lastImportAt = useLocalSyncStore((s) => s.lastImportAt);
  const pendingConflicts = useLocalSyncStore((s) => s.pendingConflicts);
  const lastError = useLocalSyncStore((s) => s.lastError);
  const config = useLocalSyncStore((s) => s.config);
  const configuring = useLocalSyncStore((s) => s.configuring);
  const configure = useLocalSyncStore((s) => s.configure);
  const disconnect = useLocalSyncStore((s) => s.disconnect);
  const exportNow = useLocalSyncStore((s) => s.exportNow);
  const importNow = useLocalSyncStore((s) => s.importNow);

  const isAdmin = useAuthStore((s) => s.isAdmin);
  const authMode = useAuthStore((s) => s.authMode);
  const personnel = useAuthStore((s) => s.personnel);
  const loadPersonnel = useAuthStore((s) => s.loadPersonnel);
  const localInviteMember = useAuthStore((s) => s.localInviteMember);
  const localChangePassword = useAuthStore((s) => s.localChangePassword);
  const removePersonnel = useAuthStore((s) => s.removePersonnel);
  const updatePersonnelRole = useAuthStore((s) => s.updatePersonnelRole);

  const localCreateFirstAdmin = useAuthStore((s) => s.localCreateFirstAdmin);

  const isLocalSyncAuth = authMode === 'localSync';

  // Setup flow steps: 'folder' → 'admin' → done (closes dialog)
  const [setupStep, setSetupStep] = useState<'folder' | 'admin'>('folder');
  const [folder, setFolder] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);

  // Folder validation state
  const [folderWarning, setFolderWarning] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);

  // First admin creation state
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminConfirmPassword, setAdminConfirmPassword] = useState('');
  const [creatingAdmin, setCreatingAdmin] = useState(false);

  // Invite form state
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<PersonnelRole>('member');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [lastInviteCode, setLastInviteCode] = useState<string | null>(null);

  // Disconnect confirmation state
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // Change password state
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [changePasswordSuccess, setChangePasswordSuccess] = useState(false);

  // Load personnel when dialog opens and auth is active
  useEffect(() => {
    if (open) {
      setConfirmDisconnect(false);
      if (isLocalSyncAuth) loadPersonnel();
    }
  }, [open, isLocalSyncAuth, loadPersonnel]);

  const handleBrowse = async () => {
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

  const handleEnable = async () => {
    if (!folder.trim() || !passphrase.trim()) {
      setError('Both folder and passphrase are required.');
      return;
    }
    setError(null);
    const result = await configure(folder.trim(), passphrase.trim());
    if (result.success) {
      // Check if auth is already configured (e.g. re-enabling after disconnect)
      const authStatus = await window.api.localAuthGetStatus();
      if (authStatus.authEnabled) {
        // Admin already exists — skip admin creation, just close
        setFolder('');
        setPassphrase('');
        setError(null);
        onOpenChange(false);
        return;
      }
      // First-time setup — proceed to admin creation
      setFolder('');
      setError(null);
      setSetupStep('admin');
    } else {
      setError(result.error ?? 'Failed to configure Local Sync.');
    }
  };

  const handleCreateAdmin = async () => {
    if (!adminName.trim() || !adminEmail.trim() || !adminPassword) {
      setError('All fields are required.');
      return;
    }
    if (adminPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (adminPassword !== adminConfirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setError(null);
    setCreatingAdmin(true);
    try {
      const result = await localCreateFirstAdmin(adminName.trim(), adminEmail.trim(), adminPassword, passphrase);
      if (result.success) {
        setPassphrase('');
        setAdminName('');
        setAdminEmail('');
        setAdminPassword('');
        setAdminConfirmPassword('');
        setSetupStep('folder');
        onOpenChange(false);
      } else {
        setError(result.error ?? 'Failed to create admin account.');
      }
    } finally {
      setCreatingAdmin(false);
    }
  };

  const handleSkipAdmin = () => {
    setPassphrase('');
    setSetupStep('folder');
    onOpenChange(false);
  };

  const handleDisconnect = async () => {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true);
      return;
    }
    await disconnect();
    setConfirmDisconnect(false);
    onOpenChange(false);
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await exportNow();
      await importNow();
    } finally {
      setSyncing(false);
    }
  };

  const handleCreateSnapshot = async () => {
    setSnapshotting(true);
    setSnapshotMessage(null);
    try {
      const result = await window.api.localSyncCreateSnapshot();
      if (result.success) {
        setSnapshotMessage(`Snapshot created (${result.changesetCount} changesets)`);
      } else {
        setSnapshotMessage(result.error ?? 'Failed to create snapshot.');
      }
    } catch {
      setSnapshotMessage('Failed to create snapshot.');
    } finally {
      setSnapshotting(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteName.trim() || !inviteEmail.trim()) {
      setInviteError('Name and email are required.');
      return;
    }
    setInviteError(null);
    setInviting(true);
    try {
      const result = await localInviteMember(inviteName.trim(), inviteEmail.trim(), inviteRole);
      if (result.success) {
        setLastInviteCode(result.inviteCode ?? null);
        setInviteName('');
        setInviteEmail('');
        setInviteRole('member');
      } else {
        setInviteError(result.error ?? 'Failed to invite member.');
      }
    } finally {
      setInviting(false);
    }
  };

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword) {
      setChangePasswordError('All fields are required.');
      return;
    }
    if (newPassword.length < 6) {
      setChangePasswordError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setChangePasswordError('New passwords do not match.');
      return;
    }
    setChangePasswordError(null);
    setChangingPassword(true);
    try {
      const result = await localChangePassword(oldPassword, newPassword);
      if (result.success) {
        setOldPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
        setChangePasswordSuccess(true);
        setTimeout(() => {
          setChangePasswordSuccess(false);
          setShowChangePassword(false);
        }, 2000);
      } else {
        setChangePasswordError(result.error ?? 'Failed to change password.');
      }
    } finally {
      setChangingPassword(false);
    }
  };

  const handleRemovePersonnel = async (id: string) => {
    const result = await removePersonnel(id);
    if (!result.success) {
      setError(result.error ?? 'Failed to remove member.');
    }
  };

  const handleToggleRole = async (p: PersonnelRecord) => {
    const newRole: PersonnelRole = p.role === 'admin' ? 'member' : 'admin';
    const result = await updatePersonnelRole(p.id, newRole);
    if (!result.success) {
      setError(result.error ?? 'Failed to update role.');
    }
  };

  if (enabled && setupStep !== 'admin') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderSync className="h-5 w-5" />
              Local Sync
            </DialogTitle>
            <DialogDescription>
              Sharing data with team members via a shared folder.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm items-center">
              <span className="text-muted-foreground">Status</span>
              <div className="flex items-center justify-end gap-2">
                <Badge variant="default" className="bg-green-600 text-xs">Enabled</Badge>
                <Badge variant="secondary" className="text-xs capitalize">{state}</Badge>
                {pendingConflicts > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    {pendingConflicts} conflict{pendingConflicts !== 1 ? 's' : ''}
                  </Badge>
                )}
              </div>

              <span className="text-muted-foreground">Sync Folder</span>
              <span className="truncate text-xs text-right" title={syncFolder ?? ''}>
                {syncFolder}
              </span>

              {config && (
                <>
                  <span className="text-muted-foreground">Device Name</span>
                  <span className="truncate text-right">{config.deviceName}</span>

                  <span className="text-muted-foreground">Device ID</span>
                  <span className="truncate text-xs font-mono text-right" title={config.deviceId}>
                    {config.deviceId.slice(0, 12)}...
                  </span>
                </>
              )}

              <span className="text-muted-foreground">Last Export</span>
              <span className="text-right text-muted-foreground">
                {lastExportAt ? formatRelativeTime(lastExportAt) : 'None this session'}
              </span>

              <span className="text-muted-foreground">Last Import</span>
              <span className="text-right text-muted-foreground">
                {lastImportAt ? formatRelativeTime(lastImportAt) : 'None this session'}
              </span>
            </div>

            {lastError && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{lastError}</span>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {snapshotMessage && (
              <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                {snapshotMessage}
              </div>
            )}

            {/* Personnel section — visible to all authenticated Local Sync users */}
            {isLocalSyncAuth && personnel.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">Team Members</h4>
                    {isAdmin && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowInviteForm(!showInviteForm)}
                      >
                        <UserPlus className="h-3.5 w-3.5 mr-1" />
                        Invite
                      </Button>
                    )}
                  </div>

                  <div className="space-y-1">
                    {personnel.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{p.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{p.email}</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge variant="secondary" className="text-xs capitalize">
                            {p.role}
                          </Badge>
                          {isAdmin && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-1.5 text-xs"
                                onClick={() => handleToggleRole(p)}
                              >
                                {p.role === 'admin' ? 'Demote' : 'Promote'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                                onClick={() => handleRemovePersonnel(p.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Invite form */}
                  {showInviteForm && isAdmin && (
                    <div className="space-y-2 rounded-md border p-3">
                      {lastInviteCode ? (
                        <>
                          <h4 className="text-sm font-medium">Invite Code</h4>
                          <p className="text-xs text-muted-foreground">
                            Share this code with the new member. They will use it along with their email to join and set their own password.
                          </p>
                          <div className="flex items-center justify-center rounded-md bg-muted p-3">
                            <span className="font-mono text-lg tracking-widest font-semibold select-all">
                              {lastInviteCode}
                            </span>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => { setLastInviteCode(null); setShowInviteForm(false); }}
                          >
                            Done
                          </Button>
                        </>
                      ) : (
                        <>
                          <div className="space-y-1.5">
                            <Label htmlFor="invite-name" className="text-xs">Name</Label>
                            <Input
                              id="invite-name"
                              value={inviteName}
                              onChange={(e) => setInviteName(e.target.value)}
                              placeholder="Member name"
                              className="h-8 text-sm"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="invite-email" className="text-xs">Email</Label>
                            <Input
                              id="invite-email"
                              type="email"
                              value={inviteEmail}
                              onChange={(e) => setInviteEmail(e.target.value)}
                              placeholder="member@example.com"
                              className="h-8 text-sm"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Role</Label>
                            <div className="flex gap-2">
                              <Button
                                variant={inviteRole === 'member' ? 'default' : 'outline'}
                                size="sm"
                                className="flex-1 h-7 text-xs"
                                onClick={() => setInviteRole('member')}
                              >
                                Member
                              </Button>
                              <Button
                                variant={inviteRole === 'admin' ? 'default' : 'outline'}
                                size="sm"
                                className="flex-1 h-7 text-xs"
                                onClick={() => setInviteRole('admin')}
                              >
                                Admin
                              </Button>
                            </div>
                          </div>
                          {inviteError && (
                            <p className="text-xs text-destructive">{inviteError}</p>
                          )}
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              onClick={() => { setShowInviteForm(false); setInviteError(null); }}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              className="flex-1"
                              onClick={handleInvite}
                              disabled={inviting}
                            >
                              {inviting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                              Invite
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Change Password — available to all authenticated users */}
            {isLocalSyncAuth && (
              <>
                <Separator />
                {showChangePassword ? (
                  <div className="space-y-2 rounded-md border p-3">
                    <h4 className="text-sm font-medium">Change Password</h4>
                    <div className="space-y-1.5">
                      <Label htmlFor="old-pw" className="text-xs">Current Password</Label>
                      <Input
                        id="old-pw"
                        type="password"
                        value={oldPassword}
                        onChange={(e) => setOldPassword(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="new-pw" className="text-xs">New Password</Label>
                      <Input
                        id="new-pw"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Min 6 characters"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="confirm-new-pw" className="text-xs">Confirm New Password</Label>
                      <Input
                        id="confirm-new-pw"
                        type="password"
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                    {changePasswordError && (
                      <p className="text-xs text-destructive">{changePasswordError}</p>
                    )}
                    {changePasswordSuccess && (
                      <p className="text-xs text-green-600">Password changed successfully.</p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => {
                          setShowChangePassword(false);
                          setChangePasswordError(null);
                          setOldPassword('');
                          setNewPassword('');
                          setConfirmNewPassword('');
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={handleChangePassword}
                        disabled={changingPassword}
                      >
                        {changingPassword && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                        Update
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowChangePassword(true)}
                  >
                    <Key className="h-3.5 w-3.5 mr-1.5" />
                    Change Password
                  </Button>
                )}
              </>
            )}
          </div>

          <DialogFooter className="flex w-full items-center justify-between sm:justify-between">
            <div className="flex gap-2">
              {(!isLocalSyncAuth || isAdmin) && (
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={handleCreateSnapshot} disabled={snapshotting}>
                  {snapshotting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Camera className="h-4 w-4 mr-1.5" />}
                  Snapshot
                </Button>
              )}
              {(!isLocalSyncAuth || isAdmin) && (
                <Button
                  variant={confirmDisconnect ? 'destructive' : 'ghost'}
                  size="sm"
                  className={confirmDisconnect ? '' : 'text-muted-foreground'}
                  onClick={handleDisconnect}
                >
                  {confirmDisconnect ? 'Confirm Disconnect' : 'Disconnect'}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleSyncNow} disabled={syncing}>
                {syncing && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Sync Now
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Not configured — setup form (two steps: folder → admin)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {setupStep === 'folder' ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FolderSync className="h-5 w-5" />
                Set Up Local Sync
              </DialogTitle>
              <DialogDescription>
                Share data with team members using a shared folder (e.g. OneDrive, Google Drive).
                All data is encrypted before leaving your device.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="sync-folder" className="text-sm font-medium">Sync Folder</label>
                <div className="flex gap-2">
                  <Input
                    id="sync-folder"
                    value={folder}
                    readOnly
                    placeholder="Select a shared folder..."
                    className="flex-1"
                  />
                  <Button variant="outline" size="sm" onClick={handleBrowse}>
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

              <div className="space-y-1.5">
                <label htmlFor="sync-passphrase" className="text-sm font-medium">Passphrase</label>
                <div className="relative">
                  <Input
                    id="sync-passphrase"
                    type={showPass ? 'text' : 'password'}
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="Shared encryption passphrase"
                    className="pr-10"
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
                  All team members must use the same passphrase. It encrypts your data in the shared folder.
                </p>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleEnable} disabled={configuring || !folder.trim() || !passphrase.trim()}>
                {configuring && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Enable Sync
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Create Admin Account
              </DialogTitle>
              <DialogDescription>
                Set up your admin account to protect this database. Team members will need to sign in to access data.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="admin-name">Name</Label>
                <Input
                  id="admin-name"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-email">Email</Label>
                <Input
                  id="admin-email"
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-password">Password</Label>
                <Input
                  id="admin-password"
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Min 6 characters"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-confirm-password">Confirm Password</Label>
                <Input
                  id="admin-confirm-password"
                  type="password"
                  value={adminConfirmPassword}
                  onChange={(e) => setAdminConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleSkipAdmin}>
                Skip for Now
              </Button>
              <Button onClick={handleCreateAdmin} disabled={creatingAdmin || !adminName.trim() || !adminEmail.trim() || !adminPassword}>
                {creatingAdmin && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Create Admin
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
