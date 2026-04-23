import { useState, useMemo, useEffect, useCallback } from 'react';
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
import type { TransactionRow } from '../../shared/ipc-types';

interface BulkEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactions: TransactionRow[];
  incomeCategories: string[];
  expenseCategories: string[];
  sheets: string[];
  descriptionSuggestions: string[];
  partySuggestions: string[];
  activitySuggestions: string[];
  onSave: (originals: TransactionRow[], updated: TransactionRow[]) => void;
}

function allSame<T>(items: T[], fn: (t: T) => unknown): boolean {
  if (items.length === 0) return false;
  const first = fn(items[0]);
  return items.every((t) => fn(t) === first);
}

export function BulkEditDialog({
  open,
  onOpenChange,
  transactions,
  incomeCategories,
  expenseCategories,
  sheets,
  descriptionSuggestions,
  partySuggestions,
  activitySuggestions,
  onSave,
}: BulkEditDialogProps) {
  // Analyze which fields are identical
  const analysis = useMemo(() => {
    if (transactions.length < 2) return null;
    return {
      sameType: allSame(transactions, (t) => t.type),
      sameDate: allSame(transactions, (t) => t.date),
      sameAmount: allSame(transactions, (t) => t.amount),
      sameDescription: allSame(transactions, (t) => t.description),
      sameCategory: allSame(transactions, (t) => t.category),
      sameParty: allSame(transactions, (t) => t.party),
      sameSheet: allSame(transactions, (t) => t.sheet),
      sameStatus: allSame(transactions, (t) => t.status),
      sameReference: allSame(transactions, (t) => t.reference),
      sameActivity: allSame(transactions, (t) => t.activity),
      sameNotes: allSame(transactions, (t) => t.notes),
      allExpenses: transactions.every((t) => t.type === 'expense'),
    };
  }, [transactions]);

  const first = transactions[0];

  // Form state — initialized from common values
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

  const categories = type === 'income' ? incomeCategories : expenseCategories;
  const hasEditableFields = analysis
    ? analysis.sameType || analysis.sameDate || analysis.sameAmount ||
      analysis.sameDescription || analysis.sameCategory || analysis.sameParty ||
      (analysis.sameSheet && sheets.length > 1) || (analysis.sameStatus && analysis.allExpenses) ||
      analysis.sameReference || analysis.sameActivity || analysis.sameNotes
    : false;

  const handleSave = useCallback(() => {
    if (!analysis || !first) return;

    const now = new Date().toISOString();
    const updated = transactions.map((t) => {
      const changes: Partial<TransactionRow> = {};

      if (analysis.sameType && type !== t.type) {
        changes.type = type;
        if (type === 'income') changes.status = '--';
      }
      if (analysis.sameAmount) {
        const newAmount = parseFloat(amount).toFixed(2);
        if (newAmount !== t.amount) changes.amount = newAmount;
      }
      if (analysis.sameDate && date !== t.date) {
        changes.date = date;
      }
      if (analysis.sameDescription) {
        const trimmed = description.trim();
        if (trimmed && trimmed !== t.description) changes.description = trimmed;
      }
      if (analysis.sameCategory) {
        const newCat = category || null;
        if (newCat !== t.category) changes.category = newCat;
      }
      if (analysis.sameParty) {
        const newParty = party.trim() || null;
        if (newParty !== t.party) changes.party = newParty;
      }
      if (analysis.sameSheet && sheets.length > 1 && sheet !== t.sheet) {
        changes.sheet = sheet;
      }
      if (analysis.sameStatus && analysis.allExpenses && t.type === 'expense') {
        if (status !== t.status) changes.status = status as TransactionRow['status'];
      }
      if (analysis.sameReference) {
        const newRef = reference.trim() || null;
        if (newRef !== t.reference) changes.reference = newRef;
      }
      if (analysis.sameActivity) {
        const newAct = activity.trim() || null;
        if (newAct !== t.activity) changes.activity = newAct;
      }
      if (analysis.sameNotes) {
        const newNotes = notes.trim() || null;
        if (newNotes !== t.notes) changes.notes = newNotes;
      }

      if (Object.keys(changes).length === 0) return t;

      return {
        ...t,
        ...changes,
        version: t.version + 1,
        modified_at: now,
        modified_by: 'local',
      };
    });

    onSave(transactions, updated);
  }, [transactions, analysis, first, type, amount, date, description, category, party, sheet, sheets, status, reference, activity, notes, onSave]);

  // Reset form when dialog opens or the selection changes.
  useEffect(() => {
    if (!open) return;

    if (!first || !analysis) {
      setType('expense');
      setAmount('');
      setDate('');
      setDescription('');
      setCategory('');
      setParty('');
      setReference('');
      setActivity('');
      setNotes('');
      setSheet('');
      setStatus('');
      return;
    }

    setType(analysis.sameType ? first.type : 'expense');
    setAmount(analysis.sameAmount ? first.amount : '');
    setDate(analysis.sameDate ? first.date : '');
    setDescription(analysis.sameDescription ? first.description : '');
    setCategory(analysis.sameCategory ? first.category ?? '' : '');
    setParty(analysis.sameParty ? first.party ?? '' : '');
    setReference(analysis.sameReference ? first.reference ?? '' : '');
    setActivity(analysis.sameActivity ? first.activity ?? '' : '');
    setNotes(analysis.sameNotes ? first.notes ?? '' : '');
    setSheet(analysis.sameSheet ? first.sheet : '');
    setStatus(
      analysis.sameStatus
        ? first.status
        : first.type === 'income'
          ? '--'
          : 'pending',
    );
  }, [open, first, analysis]);

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

  if (!analysis || !first) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Edit ({transactions.length} transactions)</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Only fields with identical values across all selected transactions are shown.
        </p>

        {!hasEditableFields ? (
          <p className="text-sm text-muted-foreground py-4">
            No fields are identical across all selected transactions.
          </p>
        ) : (
          <div className="flex flex-col gap-3 py-2">
            {/* Type toggle */}
            {analysis.sameType && (
              <div className="flex gap-1 rounded-md bg-muted p-1">
                <button
                  type="button"
                  className={`flex-1 rounded-sm px-3 py-1 text-sm font-medium transition-colors ${type === 'expense' ? 'bg-background shadow text-foreground' : 'text-muted-foreground'}`}
                  onClick={() => { setType('expense'); if (status === '--') setStatus('pending'); }}
                >
                  Expense
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-sm px-3 py-1 text-sm font-medium transition-colors ${type === 'income' ? 'bg-background shadow text-foreground' : 'text-muted-foreground'}`}
                  onClick={() => { setType('income'); setStatus('--'); }}
                >
                  Income
                </button>
              </div>
            )}

            {/* Amount & Date row */}
            {(analysis.sameAmount || analysis.sameDate) && (
              <div className="flex gap-3">
                {analysis.sameAmount && (
                  <div className="flex-1">
                    <Label className="text-xs">Amount</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                )}
                {analysis.sameDate && (
                  <div className="flex-1">
                    <Label className="text-xs">Date</Label>
                    <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </div>
                )}
              </div>
            )}

            {/* Description */}
            {analysis.sameDescription && (
              <div>
                <Label className="text-xs">Description</Label>
                <ComboboxInput
                  value={description}
                  onChange={setDescription}
                  suggestions={descriptionSuggestions}
                  placeholder="Description"
                />
              </div>
            )}

            {/* Category & Party row */}
            {(analysis.sameCategory || analysis.sameParty) && (
              <div className="flex gap-3">
                {analysis.sameCategory && (
                  <div className="flex-1">
                    <Label className="text-xs">Category</Label>
                    <Select value={category || '__none__'} onValueChange={(v) => setCategory(v === '__none__' ? '' : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {categories.map((cat) => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {analysis.sameParty && (
                  <div className="flex-1">
                    <Label className="text-xs">Party</Label>
                    <ComboboxInput
                      value={party}
                      onChange={setParty}
                      suggestions={partySuggestions}
                      placeholder="Party"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Sheet & Status row */}
            {((analysis.sameSheet && sheets.length > 1) || (analysis.sameStatus && analysis.allExpenses)) && (
              <div className="flex gap-3">
                {analysis.sameSheet && sheets.length > 1 && (
                  <div className="flex-1">
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
                {analysis.sameStatus && analysis.allExpenses && (
                  <div className="flex-1">
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
            )}

            {/* Reference & Activity row */}
            {(analysis.sameReference || analysis.sameActivity) && (
              <div className="flex gap-3">
                {analysis.sameReference && (
                  <div className="flex-1">
                    <Label className="text-xs">Reference</Label>
                    <Input value={reference} onChange={(e) => setReference(e.target.value)} />
                  </div>
                )}
                {analysis.sameActivity && (
                  <div className="flex-1">
                    <Label className="text-xs">Activity</Label>
                    <ComboboxInput
                      value={activity}
                      onChange={setActivity}
                      suggestions={activitySuggestions}
                      placeholder="Activity"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Notes */}
            {analysis.sameNotes && (
              <div>
                <Label className="text-xs">Notes</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!hasEditableFields}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
