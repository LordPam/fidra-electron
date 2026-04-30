import { useState, useEffect } from 'react';
import { FilePlus, FolderOpen, Cloud, Trash2, Settings, Plus, FileSpreadsheet, FolderSync, AlertTriangle } from 'lucide-react';
import logoLight from '@/assets/logo-light.svg';
import logoDark from '@/assets/logo-dark.svg';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CloudServerDialog } from './CloudServerDialog';
import { JoinLocalSyncDialog } from './JoinLocalSyncDialog';
import type { CloudServerConfig } from '../../shared/ipc-types';

interface RecentFileEntry {
  path: string;
  name: string;
  lastOpenedAt: string;
}

interface FileChooserDialogProps {
  onDismiss?: () => void;
}

function formatRelativeDate(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    const diffHours = Math.floor(diffMs / 3_600_000);
    const diffDays = Math.floor(diffMs / 86_400_000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

function getFileInitial(name: string): string {
  return name.replace(/\.(fdra|db|sqlite)$/, '').charAt(0).toUpperCase();
}

export function FileChooserDialog({ onDismiss }: FileChooserDialogProps) {
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>([]);
  const [cloudServers, setCloudServers] = useState<CloudServerConfig[]>([]);
  const [cloudDialogOpen, setCloudDialogOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<CloudServerConfig | null>(null);
  const [joinSyncOpen, setJoinSyncOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    window.api.getRecentFiles().then(setRecentFiles);
    window.api.getCloudServers().then((servers) => setCloudServers(servers as CloudServerConfig[]));
  }, []);

  const handleOpenFile = async () => {
    setErrorMessage(null);
    const dialogResult = await window.api.showOpenDialog({
      title: 'Open Fidra Database',
      filters: [
        { name: 'Fidra Database', extensions: ['fdra', 'db', 'sqlite'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (!dialogResult.canceled && dialogResult.filePaths.length > 0) {
      const result = await window.api.switchToFile(dialogResult.filePaths[0]);
      if (result.error) { setErrorMessage(`Failed to open database: ${result.error}`); return; }
      if (result.success && !result.reloading) onDismiss?.();
    }
  };

  const handleNewDb = async () => {
    setErrorMessage(null);
    const dialogResult = await window.api.showSaveDialog({
      title: 'Create New Fidra Database',
      defaultPath: 'finances.fdra',
      filters: [{ name: 'Fidra Database', extensions: ['fdra'] }],
    });
    if (!dialogResult.canceled && dialogResult.filePath) {
      const result = await window.api.switchToFile(dialogResult.filePath);
      if (result.error) { setErrorMessage(`Failed to create database: ${result.error}`); return; }
      if (result.success && !result.reloading) onDismiss?.();
    }
  };

  const handleOpenRecent = async (filePath: string) => {
    setErrorMessage(null);
    const result = await window.api.switchToFile(filePath);
    if (result.error) { setErrorMessage(`Failed to open database: ${result.error}`); return; }
    // If already showing this file (no reload), just dismiss the overlay
    if (result.success && !result.reloading) onDismiss?.();
  };

  const handleRemoveRecent = async (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await window.api.removeRecentFile(filePath);
    setRecentFiles((prev) => prev.filter((f) => f.path !== filePath));
  };

  const handleOpenCloudServer = async (serverId: string) => {
    const result = await window.api.switchToCloudServer(serverId);
    if (result.success && !result.reloading) onDismiss?.();
  };

  const handleEditCloudServer = (server: CloudServerConfig, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingServer(server);
    setCloudDialogOpen(true);
  };

  const handleAddCloudServer = () => {
    setEditingServer(null);
    setCloudDialogOpen(true);
  };

  const handleCloudDialogClose = (open: boolean) => {
    setCloudDialogOpen(open);
    if (!open) {
      setEditingServer(null);
      window.api.getCloudServers().then((servers) => setCloudServers(servers as CloudServerConfig[]));
    }
  };

  const hasContent = recentFiles.length > 0 || cloudServers.length > 0;

  return (
    <div className="flex h-screen w-full bg-surface">
      {/* Left panel — branding + actions */}
      <div className="flex w-64 shrink-0 flex-col border-r border-border bg-surface-raised p-6">
        <div className="flex items-center gap-2.5">
          <img src={logoLight} alt="Fidra" className="h-8 w-8 object-contain dark:hidden" />
          <img src={logoDark} alt="Fidra" className="hidden h-8 w-8 object-contain dark:block" />
          <span className="font-display text-lg font-semibold text-foreground">Fidra</span>
        </div>

        <div className="mt-8 space-y-2">
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={handleNewDb}
          >
            <FilePlus className="h-4 w-4" />
            New Database
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={handleOpenFile}
          >
            <FolderOpen className="h-4 w-4" />
            Open File
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={() => setJoinSyncOpen(true)}
          >
            <FolderSync className="h-4 w-4" />
            Join Local Sync
          </Button>
        </div>

        {/* Cloud servers section */}
        <div className="mt-8">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Cloud Servers
          </h3>
          {cloudServers.length > 0 && (
            <ul className="mb-2 space-y-1">
              {cloudServers.map((server) => (
                <li key={server.id}>
                  <button
                    className="group flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-inset transition-fidra"
                    onClick={() => handleOpenCloudServer(server.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Cloud className="h-3.5 w-3.5 shrink-0 text-fidra-teal" />
                      <span className="truncate text-foreground">{server.name}</span>
                    </div>
                    <button
                      className="ml-1 rounded p-0.5 opacity-0 hover:text-foreground group-hover:opacity-100 transition-fidra"
                      onClick={(e) => handleEditCloudServer(server, e)}
                      title="Edit server"
                    >
                      <Settings className="h-3 w-3" />
                    </button>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-surface-inset transition-fidra"
            onClick={handleAddCloudServer}
          >
            <Plus className="h-3.5 w-3.5" />
            Add Server
          </button>
        </div>

        <div className="mt-auto" />
      </div>

      {/* Right panel — recent files */}
      <div className="flex flex-1 flex-col p-8">
        <div className="mb-6">
          <h1 className="font-display text-xl font-semibold text-foreground">
            Recent Databases
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick up where you left off or start something new.
          </p>
        </div>

        {errorMessage && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-destructive">{errorMessage}</p>
          </div>
        )}

        {hasContent ? (
          <ScrollArea className="flex-1">
            <div className="grid grid-cols-2 gap-3 pr-3">
              {recentFiles.map((file) => (
                <button
                  key={file.path}
                  className="group relative flex items-start gap-3 rounded-lg border border-border bg-surface-raised p-4 text-left transition-fidra hover:border-fidra-teal/50 hover:shadow-sm"
                  onClick={() => handleOpenRecent(file.path)}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-fidra-navy/10 text-fidra-navy dark:bg-fidra-cream/10 dark:text-fidra-cream">
                    <FileSpreadsheet className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">
                      {file.name}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {formatRelativeDate(file.lastOpenedAt)}
                    </div>
                  </div>
                  <button
                    className="absolute right-2 top-2 rounded p-1 opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 transition-fidra"
                    onClick={(e) => handleRemoveRecent(file.path, e)}
                    title="Remove from recent files"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </button>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-inset">
              <FileSpreadsheet className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">No recent databases</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Create a new database or open an existing file to get started.
            </p>
            <div className="mt-6 flex gap-3">
              <Button size="sm" onClick={handleNewDb}>
                <FilePlus className="mr-1.5 h-4 w-4" />
                New Database
              </Button>
              <Button size="sm" variant="outline" onClick={handleOpenFile}>
                <FolderOpen className="mr-1.5 h-4 w-4" />
                Open File
              </Button>
            </div>
          </div>
        )}
      </div>

      <CloudServerDialog
        open={cloudDialogOpen}
        onOpenChange={handleCloudDialogClose}
        editServer={editingServer}
        isStandalone
      />

      <JoinLocalSyncDialog
        open={joinSyncOpen}
        onOpenChange={setJoinSyncOpen}
        onComplete={() => onDismiss?.()}
      />
    </div>
  );
}
