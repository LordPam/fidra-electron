import { useEffect, useState } from 'react';
import { FolderSync } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useLocalSyncStore } from '@/stores/local-sync-store';
import { LocalSyncSetupDialog } from '@/dialogs/LocalSyncSetupDialog';

export function LocalSyncIndicator() {
  const enabled = useLocalSyncStore((s) => s.enabled);
  const state = useLocalSyncStore((s) => s.state);
  const pendingConflicts = useLocalSyncStore((s) => s.pendingConflicts);
  const lastError = useLocalSyncStore((s) => s.lastError);
  const loadStatus = useLocalSyncStore((s) => s.loadStatus);
  const loadConfig = useLocalSyncStore((s) => s.loadConfig);
  const initEventListeners = useLocalSyncStore((s) => s.initEventListeners);

  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    loadStatus();
    loadConfig();
    const unsub = initEventListeners();
    return unsub;
  }, [loadStatus, loadConfig, initEventListeners]);

  if (!enabled) return null;

  // Determine dot color
  let dotColor = 'bg-green-500';
  let tooltipText = 'Local Sync: idle';

  if (lastError) {
    dotColor = 'bg-red-500';
    tooltipText = 'Local Sync: error';
  } else if (state === 'error') {
    dotColor = 'bg-red-500';
    tooltipText = 'Local Sync: error';
  } else if (state === 'exporting' || state === 'importing') {
    dotColor = 'bg-yellow-500';
    tooltipText = 'Local Sync: syncing...';
  } else if (pendingConflicts > 0) {
    dotColor = 'bg-orange-500';
    tooltipText = `Local Sync: ${pendingConflicts} conflict${pendingConflicts !== 1 ? 's' : ''}`;
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="relative flex h-10 w-10 items-center justify-center rounded-md text-fidra-slate transition-fidra hover:bg-fidra-teal/10 hover:text-foreground"
            onClick={() => setDialogOpen(true)}
          >
            <FolderSync className="h-5 w-5" />
            <span className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ${dotColor}`} />
            {pendingConflicts > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-orange-500 px-0.5 text-[9px] font-bold text-black">
                {pendingConflicts > 99 ? '99+' : pendingConflicts}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="font-display text-xs">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
      <LocalSyncSetupDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
