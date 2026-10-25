import { useEffect } from 'react';
import { Download } from 'lucide-react';
import { useUpdateStore } from '@/stores/update-store';

/** Keeps the process-wide update connection alive even on the startup/auth screens. */
export function UpdateToast() {
  const { status, actionError, preparing, connect, openInstaller, download, remindLater } = useUpdateStore();
  useEffect(connect, [connect]);
  if (preparing) {
    return <div role="status" className="fixed inset-0 z-[100] flex items-center justify-center bg-background/90 text-sm">Finishing saves before opening the installer…</div>;
  }
  if (!status || (!['available', 'ready'].includes(status.phase) && !status.installerReady) ||
    (status.remindAfter && Date.now() < Date.parse(status.remindAfter))) return null;
  return (
    <aside role="status" aria-label="Fidra update" className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border bg-popover p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <Download className="h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-medium">{status.installerReady ? 'Fidra is ready to update' : `Fidra ${status.version} is available`}</p>
          <p className="mt-1 text-xs text-muted-foreground">{status.installerReady ? 'Open the verified installer when you’re ready. Your ledgers stay in place.' : 'Download the update here. You can keep working.'}</p>
        </div>
      </div>
      {(actionError || status.error) && <p role="alert" className="mt-2 text-xs text-destructive">{actionError ?? status.error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button className="rounded-md border px-3 py-1.5 text-xs" onClick={() => void remindLater()}>Later</button>
        <button className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground" onClick={() => void (status.installerReady ? openInstaller() : download())}>
          {status.installerReady ? 'Open installer' : 'Download update'}
        </button>
      </div>
    </aside>
  );
}
