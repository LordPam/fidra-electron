import { useState, useEffect } from 'react';
import { FilePlus, FolderOpen, ArrowLeft, FolderSync, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { JoinLocalSyncDialog } from './JoinLocalSyncDialog';
import logoLight from '@/assets/logo-light.svg';
import logoDark from '@/assets/logo-dark.svg';

interface SetupWizardProps {
  onComplete: () => void;
}

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [accounts, setAccounts] = useState<{ path: string; databaseId: string }[]>([]);
  useEffect(() => { window.api.getDeviceDataInfo().then((info) => setAccounts(info.accounts)).catch(() => undefined); }, []);
  const [step, setStep] = useState(1);
  const [joinSyncOpen, setJoinSyncOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleComplete = async () => {
    await window.api.markFirstRunComplete();
    onComplete();
  };

  const handleCreateNew = async () => {
    setErrorMessage(null);
    const result = await window.api.createNewDb({ chooseLocation: false });
    if (result.error) {
      setErrorMessage(`Failed to create database: ${result.error}`);
      return;
    }
    if (!result.canceled && result.filePath) {
      await handleComplete();
    }
  };

  const handleOpenExisting = async () => {
    setErrorMessage(null);
    const result = await window.api.openFileDialog();
    if (result.error) {
      setErrorMessage(`Failed to open database: ${result.error}`);
      return;
    }
    if (!result.canceled && result.filePath) {
      await handleComplete();
    }
  };

  if (step === 0) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-surface-base">
        <div className="app-drag fixed inset-x-0 top-0 h-10" aria-hidden="true" />
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
    <div className="flex h-screen w-full items-center justify-center bg-surface-base">
      <div className="app-drag fixed inset-x-0 top-0 h-10" aria-hidden="true" />
      <div className="w-full max-w-md space-y-5 px-8">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">
            Welcome to Fidra
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Start fresh, continue with saved accounts, or join your team.
          </p>
        </div>

        {accounts.length > 0 && <div className="space-y-2">
          <p className="text-sm font-medium">Continue with saved accounts</p>
          {accounts.map((account) => <button key={account.path} className="w-full rounded-lg border border-border p-3 text-left text-sm break-all hover:border-fidra-gold"
            onClick={async () => {
              const result = await window.api.switchToFile(account.path);
              if (!result.success) setErrorMessage(result.error ?? 'Could not open this ledger.');
              else await handleComplete();
            }}>{account.path.split(/[\\/]/).pop()}<span className="block text-xs text-muted-foreground">{account.path}</span></button>)}
        </div>}
        <button
          className="flex w-full items-center gap-4 rounded-lg border border-border bg-surface-raised p-4 text-left transition-fidra hover:border-fidra-gold"
          onClick={handleCreateNew}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-fidra-gold/10 text-fidra-gold">
            <FilePlus className="h-5 w-5" />
          </div>
          <div>
            <div className="font-medium text-foreground">Start a ledger</div>
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
            <div className="font-medium text-foreground">Open a ledger</div>
            <div className="text-xs text-muted-foreground">
              Continue with an existing Fidra database file
            </div>
          </div>
        </button>

        <button
          className="flex w-full items-center gap-4 rounded-lg border border-fidra-teal/30 bg-surface-raised p-4 text-left transition-fidra hover:border-fidra-teal"
          onClick={() => setJoinSyncOpen(true)}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-fidra-teal/10 text-fidra-teal">
            <FolderSync className="h-5 w-5" />
          </div>
          <div>
            <div className="font-medium text-foreground">Join a team</div>
            <div className="text-xs text-muted-foreground">
              Join a team already sharing data via a shared folder
            </div>
          </div>
        </button>

        {errorMessage && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-destructive">{errorMessage}</p>
          </div>
        )}

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

        <JoinLocalSyncDialog
          open={joinSyncOpen}
          onOpenChange={setJoinSyncOpen}
          onComplete={handleComplete}
        />
      </div>
    </div>
  );
}
