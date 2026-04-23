import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Unplug,
  Trash2,
  Cloud,
} from 'lucide-react';
import { useCloudStore } from '@/stores/cloud-store';
import { useAuthStore } from '@/stores/auth-store';
import type { CloudServerConfig } from '../../shared/ipc-types';
import type { AuthMode } from '../../shared/auth-types';

interface CloudServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editServer?: CloudServerConfig | null;
  isStandalone?: boolean;
}

export function CloudServerDialog({ open, onOpenChange, editServer, isStandalone }: CloudServerDialogProps) {
  const { config, connected, connecting, error, saveConfig, deleteConfig, connect, disconnect, testConnection, clearError } = useCloudStore();
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const [name, setName] = useState('');
  const [authMode, setAuthMode] = useState<AuthMode>('admin');
  const [connectionString, setConnectionString] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [poolMin, setPoolMin] = useState(2);
  const [poolMax, setPoolMax] = useState(10);
  const [projectUrl, setProjectUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [storageBucket, setStorageBucket] = useState('attachments');
  const [showAnonKey, setShowAnonKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showInfrastructure, setShowInfrastructure] = useState(false);

  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [testError, setTestError] = useState('');
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState('');

  // Determine which config to edit: explicit editServer prop, or cloud store config
  const activeConfig = isStandalone ? (editServer ?? null) : config;

  // Mode is only selectable when creating a new server — once saved, it's locked
  const isNewServer = !activeConfig;

  // Load existing config when dialog opens
  useEffect(() => {
    if (open && activeConfig) {
      setName(activeConfig.name);
      setAuthMode(activeConfig.authMode ?? 'admin');
      setConnectionString(activeConfig.connectionString);
      setPoolMin(activeConfig.poolMin);
      setPoolMax(activeConfig.poolMax);
      setProjectUrl(activeConfig.projectUrl ?? activeConfig.storageUrl ?? '');
      setAnonKey(activeConfig.anonKey ?? activeConfig.storageKey ?? '');
      setStorageBucket(activeConfig.storageBucket ?? 'attachments');
    } else if (open && !activeConfig) {
      setName('');
      setAuthMode('admin');
      setConnectionString('');
      setPoolMin(2);
      setPoolMax(10);
      setProjectUrl('');
      setAnonKey('');
      setStorageBucket('attachments');
    }
    setTestStatus('idle');
    setTestError('');
    setValidationError('');
    setShowPassword(false);
    setShowAnonKey(false);
    clearError();
  }, [open, activeConfig, clearError]);

  const handleTest = async () => {
    const trimmed = connectionString.trim();
    if (!trimmed) {
      setTestError('Enter a connection string first');
      setTestStatus('failed');
      return;
    }
    setTestStatus('testing');
    setTestError('');

    const result = await testConnection(trimmed);
    if (result.success) {
      setTestStatus('success');
    } else {
      setTestStatus('failed');
      setTestError(result.error ?? 'Connection failed');
    }
  };

  const handleSaveAndConnect = async () => {
    const trimmedName = name.trim();
    const trimmedConn = connectionString.trim();
    const trimmedProjectUrl = projectUrl.trim();
    const trimmedAnonKey = anonKey.trim();

    if (!trimmedName) {
      setValidationError('Please enter a server name.');
      return;
    }
    if (authMode === 'admin' && !trimmedConn) {
      setValidationError('Please enter a database connection string.');
      return;
    }
    if (authMode === 'member' && (!trimmedProjectUrl || !trimmedAnonKey)) {
      setValidationError('Project URL and Anon Key are required for member mode.');
      return;
    }
    setValidationError('');
    setSaving(true);

    const newConfig: CloudServerConfig = {
      id: activeConfig?.id ?? crypto.randomUUID(),
      name: trimmedName,
      connectionString: trimmedConn,
      poolMin,
      poolMax,
      authMode,
      projectUrl: trimmedProjectUrl || undefined,
      anonKey: trimmedAnonKey || undefined,
      // Storage uses the same Supabase credentials as auth
      storageUrl: trimmedProjectUrl || undefined,
      storageKey: trimmedAnonKey || undefined,
      storageBucket: storageBucket.trim() || 'attachments',
      createdAt: activeConfig?.createdAt ?? new Date().toISOString(),
    };

    if (isStandalone) {
      // Standalone mode: save to global settings only, no connect
      await window.api.saveCloudServer(newConfig);
      setSaving(false);
      onOpenChange(false);
      return;
    }

    await saveConfig(newConfig);
    const success = await connect();
    setSaving(false);

    if (success) {
      onOpenChange(false);
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
  };

  const handleRemove = async () => {
    if (isStandalone && activeConfig) {
      await window.api.removeCloudServer(activeConfig.id);
    } else {
      await deleteConfig();
    }
    onOpenChange(false);
  };

  const maskedConnectionString = showPassword
    ? connectionString
    : connectionString.replace(/(:\/\/[^:]+:)([^@]+)(@)/, '$1****$3');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{activeConfig ? 'Cloud Server' : 'Add Cloud Server'}</DialogTitle>
        </DialogHeader>

        {/* Connected status banner */}
        {!isStandalone && connected && (
          <div className="flex items-center gap-2 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-3 py-2">
            <Cloud className="h-4 w-4 text-green-600" />
            <span className="text-sm text-green-700 dark:text-green-400">
              Connected to <span className="font-medium">{activeConfig?.name}</span>
            </span>
            <Badge variant="outline" className="ml-auto text-xs">
              {isAdmin ? 'Admin' : 'Member'}
            </Badge>
          </div>
        )}

        {(validationError || error) && (
          <p className="text-sm text-destructive">{validationError || error}</p>
        )}

        {/* Mode toggle — only shown when creating a new server */}
        {isNewServer && (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Connection Mode
              </Label>
              <div className="flex gap-2">
                <Button
                  variant={authMode === 'admin' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setAuthMode('admin')}
                  className="flex-1"
                >
                  Admin
                </Button>
                <Button
                  variant={authMode === 'member' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setAuthMode('member')}
                  className="flex-1"
                >
                  Member
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {authMode === 'admin'
                  ? 'Direct database access via connection string. For server setup and administration.'
                  : 'Authenticated access via Supabase. Members sign in with email — no connection string needed.'}
              </p>
            </div>

            <Separator />
          </>
        )}

        {/* Server name (both modes) */}
        <div className="space-y-1.5">
          <Label htmlFor="server-name" className="text-sm">Name</Label>
          <Input
            id="server-name"
            value={name}
            onChange={(e) => { setName(e.target.value); setValidationError(''); }}
            placeholder="e.g., Sub Aqua Club"
          />
        </div>

        {authMode === 'admin' ? (
          <>
            {/* Admin mode: Database Connection section — collapsed when connected */}
            {!isStandalone && connected && !showInfrastructure ? (
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowInfrastructure(true)}
              >
                <ChevronRight className="h-3 w-3" />
                Infrastructure Details
              </button>
            ) : (
              <div className="space-y-3">
                {!isStandalone && connected && (
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setShowInfrastructure(false)}
                  >
                    <ChevronDown className="h-3 w-3" />
                    Infrastructure Details
                  </button>
                )}
                {(!connected || isStandalone || showInfrastructure) && (
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Database Connection
                  </Label>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="conn-string" className="text-sm">Connection String</Label>
                  <div className="relative">
                    <Input
                      id="conn-string"
                      type={showPassword ? 'text' : 'password'}
                      value={showPassword ? connectionString : maskedConnectionString}
                      onChange={(e) => {
                        setConnectionString(e.target.value);
                        setTestStatus('idle');
                        setValidationError('');
                      }}
                      placeholder="postgresql://user:password@host:5432/database"
                      className="pr-9"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Advanced settings (pool) */}
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  {showAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  Advanced
                </button>

                {showAdvanced && (
                  <div className="flex items-center gap-2 pl-4">
                    <Label className="text-sm">Pool:</Label>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={poolMin}
                      onChange={(e) => setPoolMin(Math.max(1, Math.min(10, Number(e.target.value))))}
                      className="h-8 w-16 text-center"
                    />
                    <span className="text-muted-foreground">-</span>
                    <Input
                      type="number"
                      min={2}
                      max={50}
                      value={poolMax}
                      onChange={(e) => setPoolMax(Math.max(2, Math.min(50, Number(e.target.value))))}
                      className="h-8 w-16 text-center"
                    />
                    <span className="text-xs text-muted-foreground">connections</span>
                  </div>
                )}
              </div>
            )}

            <Separator />

            {/* Supabase Storage — optional for admin mode */}
            <div className="space-y-3">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Supabase Storage (Optional)
              </Label>
              <p className="text-xs text-muted-foreground">
                Required for cloud file attachments. Leave blank if not using Supabase or if attachments are local only.
              </p>

              <div className="space-y-1.5">
                <Label htmlFor="project-url-admin" className="text-sm">Project URL</Label>
                <Input
                  id="project-url-admin"
                  value={projectUrl}
                  onChange={(e) => setProjectUrl(e.target.value)}
                  placeholder="https://xxx.supabase.co"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="anon-key-admin" className="text-sm">Anon Key</Label>
                <div className="relative">
                  <Input
                    id="anon-key-admin"
                    type={showAnonKey ? 'text' : 'password'}
                    value={anonKey}
                    onChange={(e) => setAnonKey(e.target.value)}
                    placeholder="eyJhbGciOiJIUzI1NiIs..."
                    className="pr-9"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowAnonKey(!showAnonKey)}
                    tabIndex={-1}
                  >
                    {showAnonKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bucket" className="text-sm">Storage Bucket</Label>
                <Input
                  id="bucket"
                  value={storageBucket}
                  onChange={(e) => setStorageBucket(e.target.value)}
                  placeholder="attachments"
                />
              </div>
            </div>

            <Separator />

            {/* Test connection */}
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testStatus === 'testing' || !connectionString.trim()}
              >
                {testStatus === 'testing' && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Test Connection
              </Button>

              {testStatus === 'success' && (
                <span className="flex items-center gap-1 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" /> Connected
                </span>
              )}
              {testStatus === 'failed' && (
                <span className="flex items-center gap-1 text-sm text-destructive">
                  <XCircle className="h-4 w-4" /> {testError || 'Failed'}
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Member mode: Project URL + Anon Key */}
            <div className="space-y-3">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Supabase Project
              </Label>
              <p className="text-xs text-muted-foreground">
                Get these from your organisation admin or from the Supabase project settings.
              </p>

              <div className="space-y-1.5">
                <Label htmlFor="project-url" className="text-sm">Project URL</Label>
                <Input
                  id="project-url"
                  value={projectUrl}
                  onChange={(e) => { setProjectUrl(e.target.value); setValidationError(''); }}
                  placeholder="https://xxx.supabase.co"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="member-anon-key" className="text-sm">Anon Key</Label>
                <div className="relative">
                  <Input
                    id="member-anon-key"
                    type={showAnonKey ? 'text' : 'password'}
                    value={anonKey}
                    onChange={(e) => { setAnonKey(e.target.value); setValidationError(''); }}
                    placeholder="eyJhbGciOiJIUzI1NiIs..."
                    className="pr-9"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowAnonKey(!showAnonKey)}
                    tabIndex={-1}
                  >
                    {showAnonKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <div className="flex gap-2">
            {!isStandalone && activeConfig && connected && (
              <Button variant="outline" size="sm" onClick={handleDisconnect}>
                <Unplug className="h-4 w-4 mr-1" /> Disconnect
              </Button>
            )}
            {activeConfig && (
              <Button variant="outline" size="sm" className="text-destructive" onClick={handleRemove}>
                <Trash2 className="h-4 w-4 mr-1" /> Remove
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveAndConnect} disabled={saving || connecting}>
              {(saving || connecting) && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {isStandalone
                ? (activeConfig ? 'Save' : 'Add Server')
                : (activeConfig ? 'Save & Reconnect' : 'Save & Connect')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
