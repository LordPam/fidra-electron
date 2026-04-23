import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import type { LocalSyncConflict } from '../../shared/ipc-types';

interface LocalSyncConflictDialogProps {
  open: boolean;
  conflict: LocalSyncConflict;
  remaining: number;
  onResolve: (id: string, resolution: 'keep-local' | 'accept-remote' | 'manual') => void;
}

function formatValue(value: string | null, fieldName: string): string {
  if (value == null || value === '') return '-';
  if (fieldName === 'amount' || fieldName === 'subtotal') {
    const num = parseFloat(value);
    return isNaN(num) ? value : num.toFixed(2);
  }
  if (fieldName === 'date' || fieldName === 'start_date' || fieldName === 'due_date') {
    return value.substring(0, 10);
  }
  if (fieldName === 'type' || fieldName === 'status' || fieldName === 'frequency' || fieldName === 'role') {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
  return value;
}

function formatFieldName(fieldName: string): string {
  return fieldName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function LocalSyncConflictDialog({
  open,
  conflict,
  remaining,
  onResolve,
}: LocalSyncConflictDialogProps) {
  const entityLabel = conflict.entity_type.replace(/_/g, ' ');
  const localDisplay = formatValue(conflict.local_value, conflict.field_name);
  const remoteDisplay = formatValue(conflict.remote_value, conflict.field_name);
  const isDifferent = localDisplay !== remoteDisplay;

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-500">
            <AlertTriangle className="h-5 w-5" />
            Sync Conflict
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          A conflicting change was detected on a <span className="font-medium">{entityLabel}</span>.
          {remaining > 0 && (
            <span className="ml-1 font-medium">
              ({remaining} more conflict{remaining > 1 ? 's' : ''} to resolve)
            </span>
          )}
        </p>

        {/* Comparison table */}
        <div className="rounded-md border">
          <div className="grid grid-cols-[120px_1fr_1fr] gap-0">
            {/* Header */}
            <div className="border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
              Field
            </div>
            <div className="border-b border-l bg-muted/50 px-3 py-2 text-xs font-medium text-blue-500">
              Local Value
            </div>
            <div className="border-b border-l bg-muted/50 px-3 py-2 text-xs font-medium text-emerald-500">
              Remote Value
            </div>

            {/* Field row */}
            <div className="border-b px-3 py-1.5 text-xs font-medium">
              {formatFieldName(conflict.field_name)}
            </div>
            <div
              className={`border-b border-l px-3 py-1.5 text-xs ${
                isDifferent
                  ? 'bg-blue-500/10 font-medium text-blue-600 dark:text-blue-400'
                  : ''
              }`}
            >
              {localDisplay}
            </div>
            <div
              className={`border-b border-l px-3 py-1.5 text-xs ${
                isDifferent
                  ? 'bg-emerald-500/10 font-medium text-emerald-600 dark:text-emerald-400'
                  : ''
              }`}
            >
              {remoteDisplay}
            </div>
          </div>
        </div>

        {/* Device info */}
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>Entity: <span className="font-mono">{conflict.entity_id.slice(0, 12)}...</span></span>
          <span>Local v{conflict.local_version}</span>
          <span>Remote v{conflict.remote_version}</span>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onResolve(conflict.id, 'manual')}
          >
            Review Later
          </Button>
          <Button
            variant="outline"
            onClick={() => onResolve(conflict.id, 'accept-remote')}
          >
            Accept Remote
          </Button>
          <Button onClick={() => onResolve(conflict.id, 'keep-local')}>
            Keep Local
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
