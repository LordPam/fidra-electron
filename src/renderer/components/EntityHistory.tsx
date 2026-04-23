import { useState, useCallback } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { History } from 'lucide-react';
import { formatRelativeTime } from '@/lib/format';
import type { AuditLogRow } from '../../shared/ipc-types';

interface EntityHistoryProps {
  entityId: string;
  createdAt?: string;
}

function ActionBadge({ action }: { action: AuditLogRow['action'] }) {
  const variant = action === 'create' ? 'default' : action === 'delete' ? 'destructive' : 'secondary';
  return <Badge variant={variant} className="text-[10px] capitalize px-1 py-0">{action}</Badge>;
}

export function EntityHistory({ entityId, createdAt }: EntityHistoryProps) {
  const [entries, setEntries] = useState<AuditLogRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    if (entries !== null) return;
    setLoading(true);
    try {
      const result = await window.api.getAuditForEntity(entityId);
      setEntries(result);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [entityId, entries]);

  // Derive summary line from loaded entries or createdAt
  const createEntry = entries?.find((e) => e.action === 'create');
  const latestUpdate = entries?.find((e) => e.action === 'update');

  const summaryParts: string[] = [];
  if (createEntry) {
    summaryParts.push(`Created ${formatRelativeTime(createEntry.timestamp)} by ${createEntry.user}`);
  } else if (createdAt) {
    summaryParts.push(`Created ${formatRelativeTime(createdAt)}`);
  }
  if (latestUpdate) {
    summaryParts.push(`Modified ${formatRelativeTime(latestUpdate.timestamp)} by ${latestUpdate.user}`);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={loadHistory}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <History className="h-3 w-3" />
          {summaryParts.length > 0 ? (
            <span>{summaryParts.join(' · ')}</span>
          ) : (
            <span>View history</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-h-64 overflow-y-auto p-3" align="start">
        {loading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-8 rounded bg-muted animate-pulse" />
            ))}
          </div>
        )}
        {!loading && entries && entries.length === 0 && (
          <p className="text-xs text-muted-foreground">No history found</p>
        )}
        {!loading && entries && entries.length > 0 && (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2 text-xs">
                <ActionBadge action={entry.action} />
                <div className="flex-1 min-w-0">
                  <p className="text-foreground truncate">{entry.summary}</p>
                  <p className="text-muted-foreground">
                    {entry.user} · {formatRelativeTime(entry.timestamp)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
