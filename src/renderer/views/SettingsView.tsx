import { useState, useEffect, useCallback, useMemo } from 'react';
import { useCloudStore } from '@/stores/cloud-store';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { PersonnelPanel } from '@/components/PersonnelPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LogOut, Monitor, Sun, Moon, Check, Users, ChevronDown, ChevronUp, FolderSync, Loader2, DatabaseBackup, Info } from 'lucide-react';
import { getFYStart, getFYEnd } from '@/lib/chart-utils';
import { formatRelativeTime } from '@/lib/format';
import type { ThemeMode } from '../../shared/global-settings-types';
import type { AuditLogRow } from '../../shared/ipc-types';
import { useLocalSyncStore } from '@/stores/local-sync-store';
import { LocalSyncSetupDialog } from '@/dialogs/LocalSyncSetupDialog';
import { MigrateToLocalSyncDialog } from '@/dialogs/MigrateToLocalSyncDialog';
import { BackupRestoreDialog } from '@/dialogs/BackupRestoreDialog';
import { cn } from '@/lib/utils';
import { useWindowStore } from '@/stores/window-store';
import logoLight from '@/assets/logo-light.svg';
import logoDark from '@/assets/logo-dark.svg';

/** Cloud-synced folder path fragments (macOS iCloud, OneDrive, Dropbox, Google Drive). */
const CLOUD_FOLDER_MARKERS = [
  'Library/Mobile Documents/com~apple~CloudDocs',
  '/OneDrive',
  '/Dropbox',
  '/Google Drive',
  '/My Drive',
];

function isCloudSyncedPath(p: string): boolean {
  return CLOUD_FOLDER_MARKERS.some((m) => p.includes(m));
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const themeOptions: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

const ENTITY_TYPE_FILTERS = [
  { value: '', label: 'All' },
  { value: 'transaction', label: 'Transactions' },
  { value: 'planned', label: 'Planned Templates' },
  { value: 'sheet', label: 'Sheets' },
  { value: 'invoice', label: 'Invoices' },
  { value: 'attachment', label: 'Attachments' },
];

function ActionBadge({ action }: { action: AuditLogRow['action'] }) {
  const variant = action === 'create' ? 'default' : action === 'delete' ? 'destructive' : 'secondary';
  return <Badge variant={variant} className="text-[10px] capitalize">{action}</Badge>;
}

export default function SettingsView() {
  const dbPath = useWindowStore((s) => s.dbPath);
  const isCloudWindow = useCloudStore((s) => s.isCloudWindow);
  const connected = useCloudStore((s) => s.connected);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const session = useAuthStore((s) => s.session);
  const personnel = useAuthStore((s) => s.personnel);
  const currentPersonnel = useAuthStore((s) => s.currentPersonnel);
  const signOut = useAuthStore((s) => s.signOut);
  const localSignOut = useAuthStore((s) => s.localSignOut);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const fyStartMonth = useUiStore((s) => s.fyStartMonth);
  const setFYStartMonth = useUiStore((s) => s.setFYStartMonth);
  const [aboutInfo, setAboutInfo] = useState<{ version: string; description: string; logPath: string } | null>(null);

  // Profile state
  const [profileName, setProfileName] = useState('');
  const [profileInitials, setProfileInitials] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);

  // Transaction settings
  const [dateOnApprove, setDateOnApprove] = useState(false);
  const [dateOnPlannedConversion, setDateOnPlannedConversion] = useState(true);

  // Local Sync state
  const lsEnabled = useLocalSyncStore((s) => s.enabled);
  const lsState = useLocalSyncStore((s) => s.state);
  const lsSyncFolder = useLocalSyncStore((s) => s.syncFolder);
  const lsLastExportAt = useLocalSyncStore((s) => s.lastExportAt);
  const lsLastImportAt = useLocalSyncStore((s) => s.lastImportAt);
  const lsPendingConflicts = useLocalSyncStore((s) => s.pendingConflicts);
  const lsLastError = useLocalSyncStore((s) => s.lastError);
  const lsConfig = useLocalSyncStore((s) => s.config);
  const lsExportNow = useLocalSyncStore((s) => s.exportNow);
  const lsImportNow = useLocalSyncStore((s) => s.importNow);
  const lsLoadStatus = useLocalSyncStore((s) => s.loadStatus);
  const lsLoadConfig = useLocalSyncStore((s) => s.loadConfig);

  useEffect(() => {
    lsLoadStatus();
    lsLoadConfig();
  }, [lsLoadStatus, lsLoadConfig]);
  const [lsDialogOpen, setLsDialogOpen] = useState(false);
  const [lsSyncing, setLsSyncing] = useState(false);
  const [lsRecovering, setLsRecovering] = useState(false);
  const [lsRecoverMessage, setLsRecoverMessage] = useState<string | null>(null);
  const [migrateDialogOpen, setMigrateDialogOpen] = useState(false);
  const [backupDialogOpen, setBackupDialogOpen] = useState(false);

  // Audit log state
  const [auditEntries, setAuditEntries] = useState<AuditLogRow[]>([]);
  const [auditFilter, setAuditFilter] = useState('');
  const [auditOpen, setAuditOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const authMode = useAuthStore((s) => s.authMode);
  const isLocalSyncAuth = authMode === 'localSync';
  const personnelMode = useMemo<'disabled' | 'readonly' | 'admin'>(() => {
    if (isLocalSyncAuth) return isAdmin ? 'admin' : 'readonly';
    if (!isCloudWindow || !connected) return 'disabled';
    if (isAdmin) return 'admin';
    return 'readonly';
  }, [isLocalSyncAuth, isCloudWindow, connected, isAdmin]);

  const fyPreview = useMemo(() => {
    const start = getFYStart(fyStartMonth);
    const end = getFYEnd(fyStartMonth);
    const fmt = (iso: string) => {
      const [y, m, d] = iso.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    };
    return `${fmt(start)} \u2013 ${fmt(end)}`;
  }, [fyStartMonth]);

  useEffect(() => {
    window.api.getAboutInfo().then(setAboutInfo);
    window.api.getProfile().then((p) => {
      setProfileName(p.name);
      setProfileInitials(p.initials);
      setProfileLoaded(true);
    });
    window.api.getTransactionSettings().then((s) => {
      setDateOnApprove(s.dateOnApprove);
      setDateOnPlannedConversion(s.dateOnPlannedConversion);
    });
  }, []);

  // Fetch audit log when section is opened or filter changes
  useEffect(() => {
    if (!auditOpen) return;
    const filter = auditFilter || undefined;
    window.api.getAuditLog(filter, 500).then((rows) => {
      setAuditEntries(rows as AuditLogRow[]);
    });
  }, [auditOpen, auditFilter]);

  const saveProfile = useCallback(async () => {
    await window.api.saveProfile({ name: profileName.trim(), initials: profileInitials.trim().slice(0, 3) });
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 2000);
  }, [profileName, profileInitials]);

  const handleSignOut = async () => {
    if (authMode === 'localSync') {
      await localSignOut();
    } else {
      await signOut();
      window.dispatchEvent(new CustomEvent('fidra:showFileChooser'));
    }
  };

  const showProfileForm = profileLoaded && !(isAuthenticated && session) && !isLocalSyncAuth;

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border-subtle bg-surface-raised">
        <h1 className="text-xl font-display font-semibold">Settings</h1>
      </header>
      <main className="flex-1 overflow-auto p-6 space-y-4">
        {/* Row 1: Identity + Personnel */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Identity card */}
          <Card>
            <CardHeader>
              <CardTitle>{(isAuthenticated && session) || isLocalSyncAuth ? 'Account' : 'Profile'}</CardTitle>
              <CardDescription>
                {(isAuthenticated && session) || isLocalSyncAuth
                  ? isLocalSyncAuth ? 'Your Local Sync identity' : 'Your cloud account details'
                  : 'Your name and initials identify you in audit logs and transaction history.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLocalSyncAuth ? (
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    {currentPersonnel && (
                      <>
                        <p className="font-medium">{currentPersonnel.email}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">{currentPersonnel.name}</span>
                          <Badge variant={currentPersonnel.role === 'admin' ? 'default' : 'secondary'} className="text-xs">
                            {currentPersonnel.role === 'admin' ? 'Admin' : 'Member'}
                          </Badge>
                        </div>
                      </>
                    )}
                  </div>
                  <Button variant="outline" size="sm" onClick={handleSignOut}>
                    <LogOut className="h-4 w-4 mr-1.5" />
                    Sign Out
                  </Button>
                </div>
              ) : isAuthenticated && session ? (
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="font-medium">{session.user.email}</p>
                    {currentPersonnel && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">{currentPersonnel.name}</span>
                        <Badge variant={currentPersonnel.role === 'admin' ? 'default' : 'secondary'} className="text-xs">
                          {currentPersonnel.role === 'admin' ? 'Admin' : 'Member'}
                        </Badge>
                      </div>
                    )}
                    {!currentPersonnel && (
                      <p className="text-sm text-muted-foreground">No personnel record linked</p>
                    )}
                  </div>
                  <Button variant="outline" size="sm" onClick={handleSignOut}>
                    <LogOut className="h-4 w-4 mr-1.5" />
                    Sign Out
                  </Button>
                </div>
              ) : showProfileForm ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-[1fr_auto] gap-4 items-end">
                    <div className="space-y-1.5">
                      <label htmlFor="profile-name" className="text-sm font-medium">Name</label>
                      <Input
                        id="profile-name"
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        placeholder="Your name"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="profile-initials" className="text-sm font-medium">Initials</label>
                      <Input
                        id="profile-initials"
                        value={profileInitials}
                        onChange={(e) => setProfileInitials(e.target.value.slice(0, 3))}
                        placeholder="e.g. JSP"
                        className="w-20"
                        maxLength={3}
                      />
                    </div>
                  </div>
                  <Button size="sm" onClick={saveProfile}>
                    {profileSaved ? <><Check className="h-4 w-4 mr-1.5" />Saved</> : 'Save'}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Personnel card */}
          <Card className={personnelMode === 'disabled' ? 'border-dashed' : undefined}>
            <CardHeader>
              <CardTitle>Personnel</CardTitle>
              <CardDescription>
                {personnelMode === 'disabled'
                  ? 'Team access management'
                  : isLocalSyncAuth
                    ? 'Team members with access to this database.'
                    : 'Manage who can access the cloud database.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {personnelMode === 'disabled' && (
                <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                  <Users className="h-10 w-10 mb-2 opacity-40" />
                  <p className="text-sm">Set up sync to manage team members</p>
                </div>
              )}
              {personnelMode === 'readonly' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-3">
                    {personnel.map((p) => {
                      const isSelf = p.id === currentPersonnel?.id;
                      return (
                        <div key={p.id} className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-fidra-teal/15 text-fidra-teal text-xs font-semibold">
                            {p.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <span className="text-sm">
                            {p.name}
                            {isSelf && <span className="text-muted-foreground ml-1">(you)</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {personnel.length > 0 && (
                    <p className="text-xs text-muted-foreground">{personnel.length} member{personnel.length !== 1 ? 's' : ''}</p>
                  )}
                </div>
              )}
              {personnelMode === 'admin' && (
                <PersonnelPanel compact />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Row 2: Appearance + Transaction Behavior */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Appearance card */}
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Choose your preferred colour scheme.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="inline-flex rounded-md border border-border-subtle overflow-hidden">
                {themeOptions.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTheme(value)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors',
                      theme === value
                        ? 'bg-fidra-teal/15 text-fidra-teal'
                        : 'text-muted-foreground hover:bg-surface-inset',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Transaction Behavior card */}
          <Card>
            <CardHeader>
              <CardTitle>Transaction Behavior</CardTitle>
              <CardDescription>Configure how dates are handled for transactions.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox
                    checked={dateOnApprove}
                    onCheckedChange={(checked) => {
                      const val = checked === true;
                      setDateOnApprove(val);
                      window.api.saveTransactionSettings({ dateOnApprove: val, dateOnPlannedConversion });
                    }}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium">Set date to today when approving transactions</p>
                    <p className="text-xs text-muted-foreground">
                      When enabled, approving a pending transaction will update its date to the current date.
                    </p>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox
                    checked={dateOnPlannedConversion}
                    onCheckedChange={(checked) => {
                      const val = checked === true;
                      setDateOnPlannedConversion(val);
                      window.api.saveTransactionSettings({ dateOnApprove, dateOnPlannedConversion: val });
                    }}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium">Set date to today when converting planned to actual</p>
                    <p className="text-xs text-muted-foreground">
                      When enabled, converting a planned transaction will use today's date instead of the scheduled date.
                    </p>
                  </div>
                </label>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Row 3: Financial Year + About */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Financial Year card */}
          <Card>
            <CardHeader>
              <CardTitle>Financial Year</CardTitle>
              <CardDescription>Set which month your financial year begins.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <label htmlFor="fy-start-month" className="text-sm font-medium whitespace-nowrap">
                    Starts in
                  </label>
                  <select
                    id="fy-start-month"
                    value={fyStartMonth}
                    onChange={(e) => setFYStartMonth(Number(e.target.value))}
                    className="rounded-md border border-border-subtle bg-surface-inset px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-fidra-teal/40"
                  >
                    {MONTH_NAMES.map((name, i) => (
                      <option key={i + 1} value={i + 1}>{name}</option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-muted-foreground">
                  Current FY: {fyPreview}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* About card */}
          <Card>
            <CardHeader>
              <CardTitle>About</CardTitle>
              <CardDescription>Application information</CardDescription>
            </CardHeader>
            <CardContent>
              {aboutInfo && (
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 shrink-0">
                    <img src={logoLight} alt="Fidra" className="h-12 w-12 object-contain dark:hidden" />
                    <img src={logoDark} alt="Fidra" className="hidden h-12 w-12 object-contain dark:block" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold">Fidra</p>
                    <p className="text-sm text-muted-foreground">Version {aboutInfo.version}</p>
                    <p className="text-xs text-muted-foreground mt-1">{aboutInfo.description}</p>
                    <p className="text-xs text-muted-foreground/70 mt-1 truncate select-all">Log: {aboutInfo.logPath}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Row 4: Backup & Restore */}
        <Card>
          <CardHeader>
            <CardTitle>Backup & Restore</CardTitle>
            <CardDescription>Protect your data with automatic and manual backups.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Button variant="outline" size="sm" onClick={() => setBackupDialogOpen(true)}>
                <DatabaseBackup className="h-4 w-4 mr-1.5" />
                Manage Backups
              </Button>
            </div>
          </CardContent>
        </Card>
        <BackupRestoreDialog open={backupDialogOpen} onOpenChange={setBackupDialogOpen} />

        {/* Row 5: Local Sync */}
        <Card className={!lsEnabled ? 'border-dashed' : undefined}>
          <CardHeader>
            <CardTitle>Local Sync</CardTitle>
            <CardDescription>
              {lsEnabled
                ? 'Sharing data with team members via a shared folder.'
                : 'Share data with team members via a shared folder.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!lsEnabled ? (
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                <FolderSync className="h-10 w-10 mb-2 opacity-40" />
                <p className="text-sm mb-3">Share data with team members via a shared folder</p>
                {isCloudWindow ? (
                  <Button variant="outline" size="sm" onClick={() => setMigrateDialogOpen(true)}>
                    Migrate to Local Sync
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setLsDialogOpen(true)}>
                    Set Up
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="default" className="bg-green-600 text-xs">Enabled</Badge>
                  <Badge variant="secondary" className="text-xs capitalize">{lsState}</Badge>
                  {lsPendingConflicts > 0 && (
                    <Badge variant="destructive" className="text-xs">
                      {lsPendingConflicts} conflict{lsPendingConflicts !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>

                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <span className="text-muted-foreground">Folder</span>
                  <span className="truncate text-xs" title={lsSyncFolder ?? ''}>{lsSyncFolder}</span>

                  {lsConfig && (
                    <>
                      <span className="text-muted-foreground">Device</span>
                      <span>{lsConfig.deviceName}</span>
                    </>
                  )}

                  <span className="text-muted-foreground">Last Export</span>
                  <span>{lsLastExportAt ? formatRelativeTime(lsLastExportAt) : 'None this session'}</span>

                  <span className="text-muted-foreground">Last Import</span>
                  <span>{lsLastImportAt ? formatRelativeTime(lsLastImportAt) : 'None this session'}</span>
                </div>

                {lsLastError && (
                  <p className="text-sm text-destructive">{lsLastError}</p>
                )}

                {isCloudSyncedPath(dbPath) && (
                  <div className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      Your database is in a cloud-synced folder. If sync settings seem to reset,
                      just reconfigure Local Sync and everything will pick up where it left off.
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setLsDialogOpen(true)}>
                    Configure
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={lsSyncing}
                    onClick={async () => {
                      setLsSyncing(true);
                      try {
                        await lsExportNow();
                        await lsImportNow();
                      } finally {
                        setLsSyncing(false);
                      }
                    }}
                  >
                    {lsSyncing && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                    Sync Now
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={lsRecovering}
                    onClick={async () => {
                      setLsRecovering(true);
                      setLsRecoverMessage(null);
                      try {
                        const result = await window.api.localSyncRecoverAttachments();
                        if (result.success) {
                          setLsRecoverMessage(`Recovered ${result.copiedCount} file${result.copiedCount !== 1 ? 's' : ''}, exported ${result.exportedCount} to sync folder`);
                        } else {
                          setLsRecoverMessage(result.error ?? 'Recovery failed.');
                        }
                      } catch {
                        setLsRecoverMessage('Recovery failed.');
                      } finally {
                        setLsRecovering(false);
                      }
                    }}
                  >
                    {lsRecovering && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                    Recover Files
                  </Button>
                </div>

                {lsRecoverMessage && (
                  <p className="text-xs text-muted-foreground">{lsRecoverMessage}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <LocalSyncSetupDialog open={lsDialogOpen} onOpenChange={setLsDialogOpen} />
        <MigrateToLocalSyncDialog open={migrateDialogOpen} onOpenChange={setMigrateDialogOpen} />

        {/* Row 6: Audit Log */}
        <Card>
          <CardHeader
            className="cursor-pointer select-none"
            onClick={() => setAuditOpen((o) => !o)}
          >
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Audit Log</CardTitle>
                <CardDescription>History of all changes made to your data.</CardDescription>
              </div>
              {auditOpen ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
            </div>
          </CardHeader>
          {auditOpen && (
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <label htmlFor="audit-filter" className="text-sm font-medium whitespace-nowrap">Filter</label>
                  <select
                    id="audit-filter"
                    value={auditFilter}
                    onChange={(e) => setAuditFilter(e.target.value)}
                    className="rounded-md border border-border-subtle bg-surface-inset px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-fidra-teal/40"
                  >
                    {ENTITY_TYPE_FILTERS.map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {auditEntries.length} entr{auditEntries.length === 1 ? 'y' : 'ies'}
                  </span>
                </div>

                {auditEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No audit entries found.</p>
                ) : (
                  <div className="border border-border-subtle rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-surface-inset text-left">
                          <th className="px-3 py-2 font-medium text-muted-foreground">Time</th>
                          <th className="px-3 py-2 font-medium text-muted-foreground">Action</th>
                          <th className="px-3 py-2 font-medium text-muted-foreground">Type</th>
                          <th className="px-3 py-2 font-medium text-muted-foreground">Summary</th>
                          <th className="px-3 py-2 font-medium text-muted-foreground">User</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditEntries.map((entry) => (
                          <>
                            <tr
                              key={entry.id}
                              className={cn(
                                'border-t border-border-subtle hover:bg-surface-inset/50 transition-colors',
                                entry.details ? 'cursor-pointer' : '',
                              )}
                              onClick={() => {
                                if (entry.details) {
                                  setExpandedRow(expandedRow === entry.id ? null : entry.id);
                                }
                              }}
                            >
                              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground text-xs" title={entry.timestamp}>
                                {formatRelativeTime(entry.timestamp)}
                              </td>
                              <td className="px-3 py-2">
                                <ActionBadge action={entry.action} />
                              </td>
                              <td className="px-3 py-2 capitalize text-xs">{entry.entity_type}</td>
                              <td className="px-3 py-2 max-w-[400px] truncate" title={entry.summary}>
                                {entry.summary}
                              </td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">{entry.user}</td>
                            </tr>
                            {expandedRow === entry.id && entry.details && (
                              <tr key={`${entry.id}-details`} className="border-t border-border-subtle bg-surface-inset/30">
                                <td colSpan={5} className="px-3 py-2">
                                  <pre className="text-xs text-muted-foreground overflow-auto max-h-40 whitespace-pre-wrap">
                                    {JSON.stringify(JSON.parse(entry.details), null, 2)}
                                  </pre>
                                </td>
                              </tr>
                            )}
                          </>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </CardContent>
          )}
        </Card>
      </main>
    </div>
  );
}
