import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface ConflictField {
  label: string;
  localValue: string;
  serverValue: string;
}

interface ConflictResolutionDialogProps {
  open: boolean;
  changeId: string;
  entityType: string;
  local: Record<string, unknown>;
  server: Record<string, unknown>;
  remaining?: number;
  onResolve: (changeId: string, useLocal: boolean) => void;
}

function buildTransactionFields(
  local: Record<string, unknown>,
  server: Record<string, unknown>,
): ConflictField[] {
  const fields: [string, string][] = [
    ['Description', 'description'],
    ['Amount', 'amount'],
    ['Date', 'date'],
    ['Type', 'type'],
    ['Status', 'status'],
    ['Sheet', 'sheet'],
    ['Category', 'category'],
    ['Party', 'party'],
    ['Reference', 'reference'],
    ['Activity', 'activity'],
    ['Notes', 'notes'],
  ];

  return fields.map(([label, key]) => ({
    label,
    localValue: formatValue(local[key], key),
    serverValue: formatValue(server[key], key),
  }));
}

function buildPlannedFields(
  local: Record<string, unknown>,
  server: Record<string, unknown>,
): ConflictField[] {
  const fields: [string, string][] = [
    ['Description', 'description'],
    ['Amount', 'amount'],
    ['Start Date', 'start_date'],
    ['Frequency', 'frequency'],
    ['Target Sheet', 'target_sheet'],
    ['Category', 'category'],
    ['Party', 'party'],
    ['Activity', 'activity'],
  ];

  return fields.map(([label, key]) => ({
    label,
    localValue: formatValue(local[key], key),
    serverValue: formatValue(server[key], key),
  }));
}

function formatValue(value: unknown, key: string): string {
  if (value == null || value === '') return '-';
  if (key === 'amount') {
    const num = parseFloat(String(value));
    return isNaN(num) ? String(value) : num.toFixed(2);
  }
  if (key === 'date' || key === 'start_date') {
    return String(value).substring(0, 10);
  }
  if (key === 'type' || key === 'status' || key === 'frequency') {
    const s = String(value);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return String(value);
}

export function ConflictResolutionDialog({
  open,
  changeId,
  entityType,
  local,
  server,
  remaining = 0,
  onResolve,
}: ConflictResolutionDialogProps) {
  const entityLabel = entityType === 'planned_template' ? 'planned template' : 'transaction';

  const fields =
    entityType === 'planned_template'
      ? buildPlannedFields(local, server)
      : buildTransactionFields(local, server);

  const localVersion = Number(local.version ?? 0);
  const serverVersion = Number(server.version ?? 0);

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-2xl"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-500">
            <AlertTriangle className="h-5 w-5" />
            Conflict Detected
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          This {entityLabel} was modified by someone else while you were editing it.
          Please choose which version to keep. Differences are highlighted.
          {remaining > 0 && (
            <span className="ml-1 font-medium">
              ({remaining} more conflict{remaining > 1 ? 's' : ''} to resolve)
            </span>
          )}
        </p>

        {/* Comparison table */}
        <div className="rounded-md border">
          <div className="grid grid-cols-[140px_1fr_1fr] gap-0">
            {/* Header row */}
            <div className="border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
              Field
            </div>
            <div className="border-b border-l bg-muted/50 px-3 py-2 text-xs font-medium text-blue-500">
              Your Changes
            </div>
            <div className="border-b border-l bg-muted/50 px-3 py-2 text-xs font-medium text-emerald-500">
              Database Version
            </div>

            {/* Data rows */}
            {fields.map(({ label, localValue, serverValue }) => {
              const isDifferent = localValue !== serverValue;
              return (
                <div key={label} className="contents">
                  <div className="border-b px-3 py-1.5 text-xs font-medium">
                    {label}
                  </div>
                  <div
                    className={`border-b border-l px-3 py-1.5 text-xs ${
                      isDifferent
                        ? 'bg-blue-500/10 font-medium text-blue-600 dark:text-blue-400'
                        : ''
                    }`}
                  >
                    {localValue}
                  </div>
                  <div
                    className={`border-b border-l px-3 py-1.5 text-xs ${
                      isDifferent
                        ? 'bg-emerald-500/10 font-medium text-emerald-600 dark:text-emerald-400'
                        : ''
                    }`}
                  >
                    {serverValue}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Version info */}
        <p className="text-xs text-muted-foreground">
          Your version: {Math.max(localVersion - 1, 0)} &rarr; {localVersion}
          &nbsp;&nbsp;|&nbsp;&nbsp;
          Database version: {serverVersion}
        </p>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onResolve(changeId, false)}
          >
            Use Database Version
          </Button>
          <Button onClick={() => onResolve(changeId, true)}>
            Keep My Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
