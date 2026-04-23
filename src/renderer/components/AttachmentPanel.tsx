import { useState, useEffect, useCallback } from 'react';
import { X, Paperclip, FileText, FileImage, FileSpreadsheet, File, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropZone } from '@/components/DropZone';
import type { AttachmentRow } from '../../shared/ipc-types';
import { cn } from '@/lib/utils';
import { useUndoStore } from '@/stores/undo-store';
import { useAttachmentSignal } from '@/stores/attachment-signal';
import { createAddAttachmentCommand, createRemoveAttachmentCommand } from '@/services/undo';

interface AttachmentPanelProps {
  transactionId: string;
  transactionDescription: string;
  transactionDate: string;
  onClose: () => void;
  onCountChange: (transactionId: string, count: number) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ mimeType }: { mimeType: string | null }) {
  if (mimeType?.startsWith('image/')) return <FileImage className="h-4 w-4 text-fidra-teal" />;
  if (mimeType === 'application/pdf') return <FileText className="h-4 w-4 text-fidra-negative" />;
  if (mimeType?.includes('spreadsheet') || mimeType?.includes('excel') || mimeType === 'text/csv')
    return <FileSpreadsheet className="h-4 w-4 text-fidra-positive" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

export function AttachmentPanel({
  transactionId,
  transactionDescription,
  transactionDate,
  onClose,
  onCountChange,
}: AttachmentPanelProps) {
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const { execute } = useUndoStore();
  const attachmentRevision = useAttachmentSignal((s) => s.revision);

  const loadAttachments = useCallback(async () => {
    const rows = await window.api.getAttachments(transactionId);
    setAttachments(rows);
    onCountChange(transactionId, rows.length);
  }, [transactionId, onCountChange]);

  // Refetch when transactionId changes or when sync brings in new attachment data
  useEffect(() => {
    loadAttachments();
  }, [loadAttachments, attachmentRevision]);

  // record() is intentional here: addAttachment copies the source file into
  // storage — the command's execute() only does restoreAttachment (re-insert DB
  // record, file already on disk). The initial file copy can't be replayed.
  const handleFilesDropped = useCallback(
    async (files: { path: string; name: string }[]) => {
      for (const file of files) {
        const row = await window.api.addAttachment(transactionId, file.path, file.name);
        const cmd = createAddAttachmentCommand(row, loadAttachments);
        useUndoStore.getState().record(cmd);
      }
      await loadAttachments();
    },
    [transactionId, loadAttachments],
  );

  const handleOpen = useCallback(async (id: string) => {
    await window.api.openAttachment(id);
  }, []);

  const handleRemove = useCallback(
    async (attachment: AttachmentRow) => {
      setRemovingId(attachment.id);
      await execute(createRemoveAttachmentCommand(attachment, loadAttachments));
      setRemovingId(null);
    },
    [execute, loadAttachments],
  );

  return (
    <div className="w-[280px] shrink-0 flex flex-col rounded-xl border border-border-subtle bg-surface-raised overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 min-w-0">
          <Paperclip className="h-4 w-4 text-fidra-teal shrink-0" />
          <span className="text-sm font-display font-semibold truncate">Attachments</span>
        </div>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Transaction label */}
      <div className="px-4 py-2 border-b border-border-subtle">
        <p className="text-xs text-muted-foreground truncate" title={transactionDescription}>
          {transactionDescription}
        </p>
        {transactionDate && (
          <p className="text-[10px] text-muted-foreground/70">{transactionDate}</p>
        )}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {attachments.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            No attachments &mdash; drop files here or click Attach
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {attachments.map((a) => (
              <div
                key={a.id}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 group cursor-pointer transition-opacity',
                  removingId === a.id && 'opacity-40',
                )}
                onClick={() => handleOpen(a.id)}
              >
                <FileIcon mimeType={a.mime_type} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" title={a.stored_name}>{a.stored_name}</p>
                  <p className="text-[10px] text-muted-foreground">{formatFileSize(a.file_size)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-fidra-negative shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(a);
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* DropZone */}
      <div className="px-3 pb-3">
        <DropZone onFilesDropped={handleFilesDropped} />
      </div>
    </div>
  );
}
