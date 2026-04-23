import { useEffect, useState, useCallback } from 'react';
import { X } from 'lucide-react';
import type { ImportNotification, ImportPersonSummary } from '../../shared/ipc-types';

const TABLE_LABELS: Record<string, string> = {
  transactions: 'transactions',
  planned_templates: 'planned items',
  sheets: 'sheets',
  categories: 'categories',
  invoices: 'invoices',
  activity_notes: 'activity notes',
  personnel: 'personnel',
  // audit_log omitted — filtered at orchestrator level
  attachments: 'attachments',
  settings: 'settings',
};

function formatLabel(table: string): string {
  return TABLE_LABELS[table] ?? table;
}

function describeChanges(summary: ImportPersonSummary): string {
  const parts: string[] = [];
  for (const [table, counts] of Object.entries(summary.changes)) {
    const label = formatLabel(table);
    const total = counts.created + counts.updated + counts.deleted;
    if (total === 0) continue;

    const actions: string[] = [];
    if (counts.created > 0) actions.push(`added ${counts.created}`);
    if (counts.updated > 0) actions.push(`updated ${counts.updated}`);
    if (counts.deleted > 0) actions.push(`deleted ${counts.deleted}`);
    parts.push(`${actions.join(', ')} ${label}`);
  }
  return parts.join(' and ');
}

interface ToastItem {
  id: number;
  personName: string;
  description: string;
}

let toastIdCounter = 0;

const MAX_TOASTS = 3;
const AUTO_DISMISS_MS = 5000;

export function SyncToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const unsub = window.api.onLocalSyncImportSummary((notification: ImportNotification) => {
      // Skip startup catch-up — those go to the WhileAwayDialog
      if (notification.isStartupCatchup) return;

      const newToasts: ToastItem[] = [];
      for (const summary of notification.summaries) {
        const description = describeChanges(summary);
        if (!description) continue;
        newToasts.push({
          id: ++toastIdCounter,
          personName: summary.personName,
          description,
        });
      }

      if (newToasts.length > 0) {
        setToasts((prev) => [...prev, ...newToasts].slice(-MAX_TOASTS));
      }
    });

    return unsub;
  }, []);

  // Auto-dismiss timers
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      setTimeout(() => dismiss(t.id), AUTO_DISMISS_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto animate-in fade-in slide-in-from-right-5 duration-300 max-w-sm rounded-lg border bg-popover p-3 shadow-lg"
        >
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{toast.personName}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{toast.description}</p>
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="shrink-0 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
