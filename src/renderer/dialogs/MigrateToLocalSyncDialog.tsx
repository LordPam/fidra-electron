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
import { Eye, EyeOff, Loader2, AlertCircle, FolderSync } from 'lucide-react';

interface MigrateToLocalSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MigrateToLocalSyncDialog({ open, onOpenChange }: MigrateToLocalSyncDialogProps) {
  const [folder, setFolder] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [newDbPath, setNewDbPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBrowseFolder = async () => {
    const result = await window.api.showOpenDialog({
      title: 'Select Shared Sync Folder',
      properties: ['openDirectory'],
    });
    if (!result.canceled && result.filePaths[0]) {
      setFolder(result.filePaths[0]);
    }
  };

  const handleBrowseSaveLocation = async () => {
    const result = await window.api.showSaveDialog({
      title: 'Save Migrated Database As',
      defaultPath: 'finances.fdra',
      filters: [{ name: 'Fidra Database', extensions: ['fdra'] }],
    });
    if (!result.canceled && result.filePath) {
      setNewDbPath(result.filePath);
    }
  };

  const handleMigrate = async () => {
    if (!folder.trim() || !passphrase.trim() || !newDbPath.trim()) {
      setError('All fields are required.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await window.api.localSyncMigrateFromCloud({
        syncFolder: folder.trim(),
        passphrase: passphrase.trim(),
        newDbPath: newDbPath.trim(),
      });
      if (result.success && result.newDbPath) {
        onOpenChange(false);
        await window.api.switchToFile(result.newDbPath);
      } else {
        setError(result.error ?? 'Failed to migrate to Local Sync.');
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
        setNewDbPath('');
        setError(null);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderSync className="h-5 w-5" />
            Migrate to Local Sync
          </DialogTitle>
          <DialogDescription>
            This creates a new database file with your current data and configures Local Sync.
            Your Cloud Connect database remains unchanged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="migrate-sync-folder" className="text-sm font-medium">Sync Folder</label>
            <div className="flex gap-2">
              <Input
                id="migrate-sync-folder"
                value={folder}
                readOnly
                placeholder="Select a shared folder..."
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={handleBrowseFolder} disabled={loading}>
                Browse
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="migrate-passphrase" className="text-sm font-medium">Passphrase</label>
            <div className="relative">
              <Input
                id="migrate-passphrase"
                type={showPass ? 'text' : 'password'}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Set an encryption passphrase"
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
              All team members will need this passphrase to join. It encrypts your data in the shared folder.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="migrate-save-location" className="text-sm font-medium">Save Location</label>
            <div className="flex gap-2">
              <Input
                id="migrate-save-location"
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
            onClick={handleMigrate}
            disabled={loading || !folder.trim() || !passphrase.trim() || !newDbPath.trim()}
          >
            {loading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Migrate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
