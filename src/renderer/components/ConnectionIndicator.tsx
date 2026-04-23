import { useEffect, useState } from 'react';
import { Cloud, CloudOff } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCloudStore } from '@/stores/cloud-store';
import { CloudServerDialog } from '@/dialogs/CloudServerDialog';

export function ConnectionIndicator() {
  const {
    isCloudWindow, config, connected, connectionStatus, isSyncing, pendingCount,
    loadIsCloudWindow, loadConfig, initEventListeners,
  } = useCloudStore();
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    loadIsCloudWindow();
    loadConfig();
    const unsub = initEventListeners();
    return unsub;
  }, [loadIsCloudWindow, loadConfig, initEventListeners]);

  // Local windows: don't show cloud indicator at all
  if (!isCloudWindow) {
    return null;
  }

  // Cloud window but not yet configured/connected
  if (!config) {
    return (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-md text-fidra-slate transition-fidra hover:bg-fidra-teal/10 hover:text-foreground"
              onClick={() => setDialogOpen(true)}
            >
              <CloudOff className="h-5 w-5 opacity-40" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-display text-xs">
            Cloud Sync (not configured)
          </TooltipContent>
        </Tooltip>
        <CloudServerDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </>
    );
  }

  // Determine status dot color
  let dotColor = 'bg-red-500';      // offline/disconnected
  let tooltipText = `Disconnected: ${config.name}`;

  if (connected && connectionStatus === 'connected') {
    if (isSyncing || pendingCount > 0) {
      dotColor = 'bg-yellow-500';
      tooltipText = pendingCount > 0
        ? `Syncing (${pendingCount} pending): ${config.name}`
        : `Syncing: ${config.name}`;
    } else {
      dotColor = 'bg-green-500';
      tooltipText = `Connected: ${config.name}`;
    }
  } else if (connectionStatus === 'reconnecting') {
    dotColor = 'bg-yellow-500';
    tooltipText = `Reconnecting: ${config.name}`;
  } else if (connectionStatus === 'offline-authenticated') {
    dotColor = 'bg-orange-500';
    tooltipText = `Offline (cached login): ${config.name}`;
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
            <Cloud className="h-5 w-5" />
            <span className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ${dotColor}`} />
            {pendingCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-yellow-500 px-0.5 text-[9px] font-bold text-black">
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="font-display text-xs">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
      <CloudServerDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
