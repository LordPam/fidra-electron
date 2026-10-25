import { useEffect, useState } from 'react';
import { FolderSync } from 'lucide-react';
import { useLocalSyncStore } from '@/stores/local-sync-store';
import { LocalSyncSetupDialog } from '@/dialogs/LocalSyncSetupDialog';
import {
  SidebarIcon,
  SidebarRow,
  SidebarLabel,
  sidebarRowClasses,
} from '@/components/SidebarRow';

export function LocalSyncIndicator({ collapsed = true }: { collapsed?: boolean }) {
  const enabled = useLocalSyncStore((s) => s.enabled);
  const state = useLocalSyncStore((s) => s.state);
  const pendingConflicts = useLocalSyncStore((s) => s.pendingConflicts);
  const lastError = useLocalSyncStore((s) => s.lastError);
  const staleReason = useLocalSyncStore((s) => s.staleReason);
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
  } else if (state === 'stale') {
    dotColor = 'bg-amber-500';
    tooltipText = `Local Sync: ${staleReason || 'sync issue detected'}`;
  } else if (pendingConflicts > 0) {
    dotColor = 'bg-orange-500';
    tooltipText = `Local Sync: ${pendingConflicts} conflict${pendingConflicts !== 1 ? 's' : ''}`;
  }

  return (
    <>
      <SidebarRow collapsed={collapsed} label={tooltipText}>
        <button
          type="button"
          className={sidebarRowClasses(collapsed, 'text-fidra-slate')}
          onClick={() => setDialogOpen(true)}
          title={collapsed ? undefined : tooltipText}
        >
          <SidebarIcon>
            <FolderSync className="h-[18px] w-[18px]" />
            {collapsed && (
              <span className={`absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-surface-base ${dotColor}`} />
            )}
            {collapsed && pendingConflicts > 0 && (
              <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-orange-500 px-0.5 text-[9px] font-bold text-black">
                {pendingConflicts > 99 ? '99+' : pendingConflicts}
              </span>
            )}
          </SidebarIcon>
          <SidebarLabel collapsed={collapsed}>Local Sync</SidebarLabel>
          {!collapsed && (
            <span className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
              {pendingConflicts > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-black">
                  {pendingConflicts > 99 ? '99+' : pendingConflicts}
                </span>
              )}
              <span className={`h-2 w-2 rounded-full ${dotColor}`} />
            </span>
          )}
        </button>
      </SidebarRow>
      <LocalSyncSetupDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
