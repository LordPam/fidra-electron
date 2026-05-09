import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { ImportPersonSummary, ImportChangeSummary } from '../../shared/ipc-types';

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

const MAX_DETAIL_LINES = 5;

function describeTableChanges(table: string, counts: ImportChangeSummary): string {
  const label = formatLabel(table);
  const actions: string[] = [];
  if (counts.created > 0) actions.push(`added ${counts.created}`);
  if (counts.updated > 0) actions.push(`updated ${counts.updated}`);
  if (counts.deleted > 0) actions.push(`deleted ${counts.deleted}`);
  return actions.length > 0 ? `${actions.join(', ')} ${label}` : '';
}

interface WhileAwayDialogProps {
  open: boolean;
  onDismiss: () => void;
  summaries: ImportPersonSummary[];
}

export function WhileAwayDialog({ open, onDismiss, summaries }: WhileAwayDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onDismiss(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Welcome back!</DialogTitle>
          <DialogDescription>Here&apos;s what changed while you were away:</DialogDescription>
        </DialogHeader>

        <div className="max-h-64 overflow-y-auto space-y-3">
          {summaries.map((summary) => {
            const tables = Object.entries(summary.changes).filter(
              ([, c]) => c.created + c.updated + c.deleted > 0,
            );
            if (tables.length === 0) return null;
            return (
              <div key={summary.deviceId} className="space-y-1">
                <p className="text-sm font-medium">{summary.personName}</p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-0.5">
                  {tables.map(([table, counts]) => {
                    const headline = describeTableChanges(table, counts);
                    if (!headline) return null;
                    const details = counts.details;
                    return (
                      <li key={table}>
                        {headline}
                        {details && details.length > 0 && (
                          <ul className="ml-5 mt-0.5 space-y-0.5 list-[circle] list-inside text-xs">
                            {details.slice(0, MAX_DETAIL_LINES).map((d, i) => (
                              <li key={i} className="truncate">
                                <span className="capitalize">{d.action}</span>: {d.label}
                              </li>
                            ))}
                            {details.length > MAX_DETAIL_LINES && (
                              <li className="text-muted-foreground/70">
                                + {details.length - MAX_DETAIL_LINES} more
                              </li>
                            )}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button onClick={onDismiss}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
