import { useState, useEffect, useRef } from 'react';
import { FilePlus, FolderOpen, Cloud, ArrowLeft, Plus, Settings, FolderSync } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CloudServerDialog } from './CloudServerDialog';
import { JoinLocalSyncDialog } from './JoinLocalSyncDialog';
import type { CloudServerConfig } from '../../shared/ipc-types';
import logoLight from '@/assets/logo-light.svg';
import logoDark from '@/assets/logo-dark.svg';

interface SetupWizardProps {
  onComplete: () => void;
}

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [cloudServers, setCloudServers] = useState<CloudServerConfig[]>([]);
  const [cloudDialogOpen, setCloudDialogOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<CloudServerConfig | null>(null);
  const [joinSyncOpen, setJoinSyncOpen] = useState(false);
  const serverCountBeforeDialog = useRef(0);

  useEffect(() => {
    if (step === 1) {
      window.api.getCloudServers().then((servers) => setCloudServers(servers as CloudServerConfig[]));
    }
  }, [step]);

  const handleComplete = async () => {
    await window.api.markFirstRunComplete();
    onComplete();
  };

  const handleCreateNew = async () => {
    const result = await window.api.createNewDb();
    if (!result.canceled && result.filePath) {
      await handleComplete();
    }
  };

  const handleOpenExisting = async () => {
    const result = await window.api.openFileDialog();
    if (!result.canceled && result.filePath) {
      await handleComplete();
    }
  };

  const handleOpenCloudServer = async (serverId: string) => {
    const result = await window.api.openCloudServer(serverId);
    if (result.success) {
      await handleComplete();
    }
  };

  const handleAddCloudServer = () => {
    setEditingServer(null);
    serverCountBeforeDialog.current = cloudServers.length;
    setCloudDialogOpen(true);
  };

  const handleEditCloudServer = (server: CloudServerConfig, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingServer(server);
    serverCountBeforeDialog.current = cloudServers.length;
    setCloudDialogOpen(true);
  };

  const handleCloudDialogClose = async (open: boolean) => {
    setCloudDialogOpen(open);
    if (!open) {
      setEditingServer(null);
      const servers = await window.api.getCloudServers() as CloudServerConfig[];
      setCloudServers(servers);

      // Only auto-open if a new server was added (not just editing or cancelling)
      if (servers.length > serverCountBeforeDialog.current) {
        const newest = servers[servers.length - 1];
        const result = await window.api.openCloudServer(newest.id);
        if (result.success) {
          await handleComplete();
        }
      }
    }
  };

  if (step === 0) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-6 px-8">
          <div className="flex h-24 w-24 items-center justify-center">
            <img src={logoLight} alt="Fidra" className="h-24 w-24 object-contain dark:hidden" />
            <img src={logoDark} alt="Fidra" className="hidden h-24 w-24 object-contain dark:block" />
          </div>
          <div className="text-center">
            <h1 className="font-display text-3xl font-semibold text-foreground">
              Welcome to Fidra
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Simple, powerful financial tracking for organisations
            </p>
          </div>
          <Button
            size="lg"
            className="mt-4 min-w-[180px]"
            onClick={() => setStep(1)}
          >
            Get Started
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-surface">
      <div className="w-full max-w-md space-y-5 px-8">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">
            Choose Your Database
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Fidra stores your financial data in a database file.
            Create a new one, open an existing file, or connect to a cloud server.
          </p>
        </div>

        <button
          className="flex w-full items-center gap-4 rounded-lg border border-border bg-surface-raised p-4 text-left transition-fidra hover:border-fidra-gold"
          onClick={handleCreateNew}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-fidra-gold/10 text-fidra-gold">
            <FilePlus className="h-5 w-5" />
          </div>
          <div>
            <div className="font-medium text-foreground">Create New Database</div>
            <div className="text-xs text-muted-foreground">
              Start fresh with a new financial ledger
            </div>
          </div>
        </button>

        <button
          className="flex w-full items-center gap-4 rounded-lg border border-border bg-surface-raised p-4 text-left transition-fidra hover:border-foreground/30"
          onClick={handleOpenExisting}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground">
            <FolderOpen className="h-5 w-5" />
          </div>
          <div>
            <div className="font-medium text-foreground">Open Existing Database</div>
            <div className="text-xs text-muted-foreground">
              Continue with an existing Fidra database file
            </div>
          </div>
        </button>

        {cloudServers.length > 0 && (
          <div className="space-y-2">
            <h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Cloud className="h-3.5 w-3.5" />
              Cloud Servers
            </h2>
            <ul className="space-y-1">
              {cloudServers.map((server) => (
                <li key={server.id}>
                  <button
                    className="group flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-surface-raised transition-fidra"
                    onClick={() => handleOpenCloudServer(server.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Cloud className="h-4 w-4 shrink-0 text-fidra-teal" />
                      <span className="truncate font-medium text-foreground">
                        {server.name}
                      </span>
                    </div>
                    <button
                      className="ml-2 rounded p-1 opacity-0 hover:bg-fidra-teal/10 hover:text-foreground group-hover:opacity-100 transition-fidra"
                      onClick={(e) => handleEditCloudServer(server, e)}
                      title="Edit server settings"
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </button>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          className="flex w-full items-center gap-4 rounded-lg border border-fidra-teal/30 bg-surface-raised p-4 text-left transition-fidra hover:border-fidra-teal"
          onClick={handleAddCloudServer}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-fidra-teal/10 text-fidra-teal">
            {cloudServers.length > 0 ? <Plus className="h-5 w-5" /> : <Cloud className="h-5 w-5" />}
          </div>
          <div>
            <div className="font-medium text-foreground">
              {cloudServers.length > 0 ? 'Add Cloud Server' : 'Connect to Cloud Server'}
            </div>
            <div className="text-xs text-muted-foreground">
              Connect to a shared cloud database (Supabase)
            </div>
          </div>
        </button>

        <button
          className="flex w-full items-center gap-4 rounded-lg border border-border bg-surface-raised p-4 text-left transition-fidra hover:border-foreground/30"
          onClick={() => setJoinSyncOpen(true)}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground">
            <FolderSync className="h-5 w-5" />
          </div>
          <div>
            <div className="font-medium text-foreground">Join Local Sync Group</div>
            <div className="text-xs text-muted-foreground">
              Join a team already sharing data via a shared folder
            </div>
          </div>
        </button>

        <div className="pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setStep(0)}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
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
          onComplete={handleComplete}
        />
      </div>
    </div>
  );
}
