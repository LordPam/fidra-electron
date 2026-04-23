import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Loader2,
  Download,
  Upload,
  Trash2,
  FolderOpen,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { BackupListItem, BackupSettings } from '../../shared/ipc-types';

interface BackupRestoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function TriggerBadge({ trigger }: { trigger: string }) {
  const variant = trigger === 'manual' ? 'default' : trigger === 'pre-restore' ? 'destructive' : 'secondary';
  const label = trigger === 'auto-close' ? 'Auto' : trigger === 'pre-restore' ? 'Safety' : 'Manual';
  return <Badge variant={variant} className="text-[10px]">{label}</Badge>;
}

export function BackupRestoreDialog({ open, onOpenChange }: BackupRestoreDialogProps) {
  const [backups, setBackups] = useState<BackupListItem[]>([]);
  const [settings, setSettings] = useState<BackupSettings>({
    backupDir: null,
    retentionCount: 10,
    autoBackupOnClose: true,
  });
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoringPath, setRestoringPath] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, s] = await Promise.all([
        window.api.backupList(),
        window.api.backupGetSettings(),
      ]);
      setBackups(list);
      setSettings(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      load();
      setError(null);
      setConfirmRestore(null);
      setConfirmDelete(null);
    }
  }, [open, load]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      await window.api.backupCreate();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (backupPath: string) => {
    setRestoringPath(backupPath);
    setError(null);
    try {
      const result = await window.api.backupRestore(backupPath);
      if (!result.success) {
        setError(result.error ?? 'Restore failed');
        setRestoringPath(null);
      }
      // On success the window reloads, no need to update state
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRestoringPath(null);
    }
  };

  const handleDelete = async (backupPath: string) => {
    try {
      await window.api.backupDelete(backupPath);
      setConfirmDelete(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleBrowseDir = async () => {
    const result = await window.api.showOpenDialog({
      title: 'Select Backup Folder',
      properties: ['openDirectory'],
    });
    if (!result.canceled && result.filePaths[0]) {
      setSettings((s) => ({ ...s, backupDir: result.filePaths[0] }));
      setSettingsDirty(true);
    }
  };

  const handleSaveSettings = async () => {
    try {
      await window.api.backupSaveSettings(settings);
      setSettingsDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Backup & Restore</DialogTitle>
          <DialogDescription>
            Create and manage backups of your database and attachments.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Create backup */}
          <div className="flex items-center gap-3">
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-1.5" />
              )}
              Create Backup Now
            </Button>
            {backups.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {backups.length} backup{backups.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {/* Backup history */}
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : backups.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No backups yet. Create your first backup above.
            </p>
          ) : (
            <div className="border border-border-subtle rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-inset text-left">
                    <th className="px-3 py-2 font-medium text-muted-foreground">Date</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Size</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Attachments</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Type</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((backup) => (
                    <tr
                      key={backup.metadata.id}
                      className="border-t border-border-subtle hover:bg-surface-inset/50 transition-colors"
                    >
                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                        {formatDate(backup.metadata.createdAt)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                        {formatBytes(backup.metadata.dbSize)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                        {backup.metadata.attachmentsCount > 0
                          ? `${backup.metadata.attachmentsCount} (${formatBytes(backup.metadata.attachmentsSize)})`
                          : 'None'}
                      </td>
                      <td className="px-3 py-2">
                        <TriggerBadge trigger={backup.metadata.trigger} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {confirmRestore === backup.path ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">Restore? Safety backup will be created.</span>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-6 text-xs px-2"
                              disabled={restoringPath !== null}
                              onClick={() => handleRestore(backup.path)}
                            >
                              {restoringPath === backup.path ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                'Confirm'
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs px-2"
                              onClick={() => setConfirmRestore(null)}
                            >
                              Cancel
                            </Button>
                          </span>
                        ) : confirmDelete === backup.path ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">Delete this backup?</span>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-6 text-xs px-2"
                              onClick={() => handleDelete(backup.path)}
                            >
                              Delete
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs px-2"
                              onClick={() => setConfirmDelete(null)}
                            >
                              Cancel
                            </Button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs px-2"
                              disabled={restoringPath !== null}
                              onClick={() => {
                                setConfirmRestore(backup.path);
                                setConfirmDelete(null);
                              }}
                            >
                              <Upload className="h-3 w-3 mr-1" />
                              Restore
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs px-2 text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                setConfirmDelete(backup.path);
                                setConfirmRestore(null);
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Settings section */}
          <div className="border border-border-subtle rounded-md">
            <button
              type="button"
              className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium text-left hover:bg-surface-inset/50 transition-colors"
              onClick={() => setSettingsOpen((o) => !o)}
            >
              <span>Backup Settings</span>
              {settingsOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            {settingsOpen && (
              <div className="px-3 pb-3 space-y-4 border-t border-border-subtle pt-3">
                {/* Backup folder */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Backup Folder</label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={settings.backupDir ?? ''}
                      placeholder="Default (next to database file)"
                      readOnly
                      className="text-xs flex-1"
                    />
                    <Button variant="outline" size="sm" onClick={handleBrowseDir}>
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                    {settings.backupDir && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSettings((s) => ({ ...s, backupDir: null }));
                          setSettingsDirty(true);
                        }}
                      >
                        Reset
                      </Button>
                    )}
                  </div>
                </div>

                {/* Retention */}
                <div className="space-y-1.5">
                  <label htmlFor="retention-count" className="text-sm font-medium">
                    Keep last
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="retention-count"
                      type="number"
                      min={1}
                      max={100}
                      value={settings.retentionCount}
                      onChange={(e) => {
                        const val = Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 1));
                        setSettings((s) => ({ ...s, retentionCount: val }));
                        setSettingsDirty(true);
                      }}
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">backups</span>
                  </div>
                </div>

                {/* Auto-backup */}
                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox
                    checked={settings.autoBackupOnClose}
                    onCheckedChange={(checked) => {
                      setSettings((s) => ({ ...s, autoBackupOnClose: checked === true }));
                      setSettingsDirty(true);
                    }}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium">Automatically back up when closing</p>
                    <p className="text-xs text-muted-foreground">
                      Creates a backup each time the database window is closed.
                    </p>
                  </div>
                </label>

                {settingsDirty && (
                  <Button size="sm" onClick={handleSaveSettings}>
                    Save Settings
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
