import { useEffect, useState, useCallback } from 'react';
import { Download, X, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import type { UpdateInfo } from '../../shared/ipc-types';

type ToastState =
  | { kind: 'available'; info: UpdateInfo }
  | { kind: 'downloading'; percent: number }
  | { kind: 'downloaded' }
  | { kind: 'upToDate'; version: string }
  | { kind: 'error'; message: string };

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
    const unsub3 = window.api.onUpdateError((message) => {
      setState({ kind: 'error', message });
    });
    const unsub4 = window.api.onUpdateDownloadProgress((progress) => {
      setState({ kind: 'downloading', percent: progress.percent });
    });
    const unsub5 = window.api.onUpdateDownloaded(() => {
      setState({ kind: 'downloaded' });
    });
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); };
  }, []);

  // Auto-dismiss "up to date" and "error" after a few seconds
  useEffect(() => {
    if (state?.kind !== 'upToDate' && state?.kind !== 'error') return;
    const delay = state.kind === 'error' ? 5000 : 3000;
    const timer = setTimeout(dismiss, delay);
    return () => clearTimeout(timer);
  }, [state, dismiss]);

  if (!state) return null;

  const handleDownload = () => {
    window.api.installUpdate();
    setState({ kind: 'downloading', percent: 0 });
  };

  const handleQuitAndInstall = () => {
    window.api.quitAndInstall();
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
                onClick={handleDownload}
                className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Download
              </button>
            </div>
          </>
        )}

        {state.kind === 'downloading' && (
          <div className="flex items-start gap-3">
            <Download className="h-5 w-5 text-primary mt-0.5 shrink-0 animate-pulse" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Downloading update…</p>
              <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${Math.min(state.percent, 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {Math.round(state.percent)}%
              </p>
            </div>
          </div>
        )}

        {state.kind === 'downloaded' && (
          <>
            <div className="flex items-start gap-3">
              <Check className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Update ready to install</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Fidra will restart to apply the update.
                </p>
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
                onClick={handleQuitAndInstall}
                className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors inline-flex items-center gap-1.5"
              >
                <RefreshCw className="h-3 w-3" />
                Install & Restart
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

        {state.kind === 'error' && (
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-fidra-warning mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Update check failed</p>
              <p className="text-xs text-muted-foreground mt-0.5">{state.message}</p>
            </div>
            <button
              onClick={dismiss}
              className="shrink-0 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
