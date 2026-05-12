import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ComboboxInput } from '@/components/ComboboxInput';
import { DropZone } from '@/components/DropZone';
import { EntityHistory } from '@/components/EntityHistory';
import type { TransactionRow, AttachmentRow } from '../../shared/ipc-types';
import { resolveStatus } from '../../shared/transaction-rules';
import { Paperclip, File, FileText, FileImage, FileSpreadsheet, Trash2 } from 'lucide-react';
import { useUndoStore } from '@/stores/undo-store';
import { useAttachmentSignal } from '@/stores/attachment-signal';
import { createAddAttachmentCommand, createRemoveAttachmentCommand } from '@/services/undo';

interface EditTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TransactionRow | null;
  isConversion?: boolean;
  incomeCategories: string[];
  expenseCategories: string[];
  sheets: string[];
  descriptionSuggestions: string[];
  partySuggestions: string[];
  activitySuggestions: string[];
  onSave: (original: TransactionRow, updated: TransactionRow) => void;
}

export function EditTransactionDialog({
  open,
  onOpenChange,
  transaction,
  isConversion = false,
  incomeCategories,
  expenseCategories,
  sheets,
  descriptionSuggestions,
  partySuggestions,
  activitySuggestions,
  onSave,
}: EditTransactionDialogProps) {
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [party, setParty] = useState('');
  const [reference, setReference] = useState('');
  const [activity, setActivity] = useState('');
  const [notes, setNotes] = useState('');
  const [sheet, setSheet] = useState('');
  const [status, setStatus] = useState('');
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});
  const amountRef = useRef<HTMLInputElement>(null);

  // Initialize form fields only when the dialog opens, not when the prop
  // reference changes mid-edit (which happens during cloud sync refreshes).
  // This prevents loss of in-progress edits.
  const prevOpenRef = useRef(false);
  useEffect(() => {
    const justOpened = open && !prevOpenRef.current;
    prevOpenRef.current = open;
    if (justOpened && transaction) {
      setType(transaction.type);
      setAmount(transaction.amount);
      setDate(transaction.date);
      setDescription(transaction.description);
      setCategory(transaction.category ?? '');
      setParty(transaction.party ?? '');
      setReference(transaction.reference ?? '');
      setActivity(transaction.activity ?? '');
      setNotes(transaction.notes ?? '');
      setSheet(transaction.sheet);
      setStatus(transaction.status);
      setFieldErrors({});
      window.api.getAttachments(transaction.id).then((rows) => {
        setAttachments(rows);
      });
      // Focus the amount input after the dialog finishes opening, so initial
      // focus doesn't land on the type toggle buttons (which would cause
      // Enter-key propagation to switch income→expense).
      requestAnimationFrame(() => amountRef.current?.focus());
    }
  }, [open, transaction]);

  const categories = type === 'income' ? incomeCategories : expenseCategories;

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const cleaned = raw.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
    setAmount(cleaned);
    if (fieldErrors.amount) setFieldErrors((prev) => ({ ...prev, amount: false }));
  };

  const handleAmountBlur = () => {
    if (amount && !isNaN(parseFloat(amount))) {
      setAmount(parseFloat(amount).toFixed(2));
    }
  };

  const attachmentRevision = useAttachmentSignal((s) => s.revision);

  const reloadAttachments = useCallback(async () => {
    if (!transaction) return;
    const rows = await window.api.getAttachments(transaction.id);
    setAttachments(rows);
  }, [transaction]);

  // Refetch attachments when sync brings in changes while dialog is open
  useEffect(() => {
    if (open && transaction) reloadAttachments();
  }, [attachmentRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  // record() is intentional: addAttachment copies the source file — the command's
  // execute() only does restoreAttachment (file already on disk). See AttachmentPanel.
  const handleAttachFiles = useCallback(
    async (files: { path: string; name: string }[]) => {
      if (!transaction) return;
      for (const file of files) {
        const row = await window.api.addAttachment(transaction.id, file.path, file.name);
        const cmd = createAddAttachmentCommand(row, reloadAttachments);
        useUndoStore.getState().record(cmd);
      }
      await reloadAttachments();
    },
    [transaction, reloadAttachments],
  );

  const handleRemoveAttachment = useCallback(
    async (attachment: AttachmentRow) => {
      await useUndoStore.getState().execute(createRemoveAttachmentCommand(attachment, reloadAttachments));
    },
    [reloadAttachments],
  );

  const handleOpenAttachment = useCallback(async (id: string) => {
    await window.api.openAttachment(id);
  }, []);

  const handleSave = useCallback(() => {
    if (!transaction) return;

    const errors: Record<string, boolean> = {};
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) errors.amount = true;
    if (!description.trim()) errors.description = true;

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    const updated: TransactionRow = {
      ...transaction,
      type,
      amount: parseFloat(amount).toFixed(2),
      date,
      description: description.trim(),
      category: category || null,
      party: party || null,
      reference: reference || null,
      activity: activity || null,
      notes: notes || null,
      sheet,
      status: resolveStatus(type, status),
      version: isConversion ? transaction.version : transaction.version + 1,
      modified_at: isConversion ? null : new Date().toISOString(),
      modified_by: isConversion ? null : 'local',
    };

    onSave(transaction, updated);
    onOpenChange(false);
  }, [transaction, type, amount, date, description, category, party, reference, activity, notes, sheet, status, isConversion, onSave, onOpenChange]);

  // Cmd+S to save
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, handleSave]);

  if (!transaction) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>{isConversion ? 'Convert Planned to Transaction' : 'Edit Transaction'}</DialogTitle>
          {!isConversion && transaction && (
            <EntityHistory entityId={transaction.id} createdAt={transaction.created_at} />
          )}
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2 min-w-0">
          {/* Type toggle — branded teal */}
          <div className="flex gap-1 rounded-md bg-surface-inset p-1">
            <button
              type="button"
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-display font-medium transition-fidra ${type === 'expense' ? 'bg-fidra-teal text-fidra-navy shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => { setType('expense'); if (status === '--') setStatus('pending'); }}
            >
              Expense
            </button>
            <button
              type="button"
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-display font-medium transition-fidra ${type === 'income' ? 'bg-fidra-teal text-fidra-navy shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => { setType('income'); setStatus('--'); }}
            >
              Income
            </button>
          </div>

          {/* Hero amount */}
          <div className="flex items-center justify-center gap-1 py-4">
            <span className="text-2xl font-mono text-muted-foreground">£</span>
            <input
              ref={amountRef}
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={handleAmountChange}
              onBlur={handleAmountBlur}
              placeholder="0.00"
              className={`text-3xl font-mono font-bold text-center bg-transparent border-none
                         outline-none w-[160px] tabular-nums text-foreground placeholder:text-muted-foreground/30
                         ${fieldErrors.amount ? 'text-destructive placeholder:text-destructive/30' : ''}`}
            />
          </div>

          {/* Description — full width */}
          <div>
            <Label className="text-xs">Description *</Label>
            <ComboboxInput
              value={description}
              onChange={(val) => {
                setDescription(val);
                if (fieldErrors.description) setFieldErrors((prev) => ({ ...prev, description: false }));
              }}
              suggestions={descriptionSuggestions}
              placeholder="What was this for?"
              className={fieldErrors.description ? 'border-destructive' : ''}
            />
          </div>

          {/* Date + Status row (2-col, status hidden for income) */}
          <div className={`grid gap-2 ${type === 'expense' ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            {type === 'expense' && (
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Separator */}
          <div className="h-px bg-border-subtle" />

          {/* Category + Party */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={category || '__none__'} onValueChange={(v) => setCategory(v === '__none__' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Party</Label>
              <ComboboxInput
                value={party}
                onChange={setParty}
                suggestions={partySuggestions}
                placeholder="Party"
              />
            </div>
          </div>

          {/* Reference + Activity */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Reference</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ref" className="text-xs" />
            </div>
            <div>
              <Label className="text-xs">Activity</Label>
              <ComboboxInput
                value={activity}
                onChange={setActivity}
                suggestions={activitySuggestions}
                placeholder="Activity"
              />
            </div>
          </div>

          {/* Sheet + Notes (or just Notes if single sheet) */}
          <div className={`grid gap-2 ${sheets.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {sheets.length > 1 && (
              <div>
                <Label className="text-xs">Sheet</Label>
                <Select value={sheet} onValueChange={setSheet}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sheets.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs">Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" className="text-xs" />
            </div>
          </div>

          {/* Attachments — always visible */}
          <div className="border border-border-subtle rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium">
              <Paperclip className="h-3 w-3" />
              <span>Attachments ({attachments.length})</span>
            </div>

            <div className="border-t border-border-subtle px-3 py-2 flex flex-col gap-2">
              {attachments.length > 0 && (
                <div className="flex flex-col gap-1 min-w-0">
                  {attachments.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/50 group cursor-pointer min-w-0"
                      onClick={() => handleOpenAttachment(a.id)}
                    >
                      {a.mime_type?.startsWith('image/') ? (
                        <FileImage className="h-3.5 w-3.5 text-fidra-teal shrink-0" />
                      ) : a.mime_type === 'application/pdf' ? (
                        <FileText className="h-3.5 w-3.5 text-fidra-negative shrink-0" />
                      ) : a.mime_type?.includes('spreadsheet') || a.mime_type?.includes('excel') ? (
                        <FileSpreadsheet className="h-3.5 w-3.5 text-fidra-positive shrink-0" />
                      ) : (
                        <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                      <span className="text-xs truncate flex-1" title={a.stored_name}>{a.stored_name}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {a.file_size < 1024
                          ? `${a.file_size} B`
                          : a.file_size < 1024 * 1024
                            ? `${(a.file_size / 1024).toFixed(1)} KB`
                            : `${(a.file_size / (1024 * 1024)).toFixed(1)} MB`}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-fidra-negative shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveAttachment(a);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <DropZone onFilesDropped={handleAttachFiles} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>{isConversion ? 'Add Transaction' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
