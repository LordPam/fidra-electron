import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { ImportPersonSummary } from '../../shared/ipc-types';

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

function describePersonChanges(summary: ImportPersonSummary): string[] {
  const lines: string[] = [];
  for (const [table, counts] of Object.entries(summary.changes)) {
    const label = formatLabel(table);
    const actions: string[] = [];
    if (counts.created > 0) actions.push(`added ${counts.created}`);
    if (counts.updated > 0) actions.push(`updated ${counts.updated}`);
    if (counts.deleted > 0) actions.push(`deleted ${counts.deleted}`);
    if (actions.length > 0) {
      lines.push(`${actions.join(', ')} ${label}`);
    }
  }
  return lines;
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
            const lines = describePersonChanges(summary);
            if (lines.length === 0) return null;
            return (
              <div key={summary.deviceId} className="space-y-1">
                <p className="text-sm font-medium">{summary.personName}</p>
                <ul className="text-sm text-muted-foreground list-disc list-inside">
                  {lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
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
