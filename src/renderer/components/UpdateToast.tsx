import { useEffect, useState, useCallback } from 'react';
import { Download, X, Check } from 'lucide-react';
import type { UpdateInfo } from '../../shared/ipc-types';

type ToastState =
  | { kind: 'available'; info: UpdateInfo }
  | { kind: 'upToDate'; version: string };

export function UpdateToast() {
  const [state, setState] = useState<ToastState | null>(null);

  const dismiss = useCallback(() => setState(null), []);

  useEffect(() => {
    const unsub1 = window.api.onUpdateAvailable((info) => {
      setState({ kind: 'available', info });
    });
    const unsub2 = window.api.onUpdateUpToDate((version) => {
      setState({ kind: 'upToDate', version });
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  // Auto-dismiss "up to date" after 3s
  useEffect(() => {
    if (state?.kind !== 'upToDate') return;
    const timer = setTimeout(dismiss, 3000);
    return () => clearTimeout(timer);
  }, [state, dismiss]);

  if (!state) return null;

  const handleUpdate = () => {
    window.api.installUpdate();
    dismiss();
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 pointer-events-none">
      <div className="pointer-events-auto animate-in fade-in slide-in-from-right-5 duration-300 w-80 rounded-lg border bg-popover p-4 shadow-lg">
        {state.kind === 'available' && (
          <>
            <div className="flex items-start gap-3">
              <Download className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Fidra v{state.info.version} available</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  You have v{state.info.currentVersion}
                </p>
                {state.info.releaseNotes && (
                  <p className="text-xs text-muted-foreground mt-1.5 line-clamp-3">
                    {state.info.releaseNotes}
                  </p>
                )}
              </div>
              <button
                onClick={dismiss}
                className="shrink-0 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex gap-2 mt-3 justify-end">
              <button
                onClick={dismiss}
                className="px-3 py-1.5 text-xs rounded-md border hover:bg-accent transition-colors"
              >
                Later
              </button>
              <button
                onClick={handleUpdate}
                className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Download
              </button>
            </div>
          </>
        )}

        {state.kind === 'upToDate' && (
          <div className="flex items-center gap-3">
            <Check className="h-5 w-5 text-green-500 shrink-0" />
            <p className="text-sm font-medium">You're on the latest version (v{state.version})</p>
          </div>
        )}
      </div>
    </div>
  );
}
