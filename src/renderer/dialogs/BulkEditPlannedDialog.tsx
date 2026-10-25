import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { PlannedTemplateRow } from '../../shared/ipc-types';
import { isPositiveAmount, toAmountString } from '../../shared/money';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface BulkEditPlannedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: PlannedTemplateRow[];
  multiInstanceGroupCount: number;
  onSave: (originals: PlannedTemplateRow[], updated: PlannedTemplateRow[]) => void | Promise<void>;
}

export function BulkEditPlannedDialog({
  open,
  onOpenChange,
  templates,
  multiInstanceGroupCount,
  onSave,
}: BulkEditPlannedDialogProps) {
  const [changeDescription, setChangeDescription] = useState(false);
  const [changeAmount, setChangeAmount] = useState(false);
  const [changeNotes, setChangeNotes] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setChangeDescription(false);
    setChangeAmount(false);
    setChangeNotes(false);
    setDescription('');
    setAmount('');
    setNotes('');
    setError(null);
  }, [open, templates]);

  const handleSave = useCallback(async () => {
    if (templates.length < 2) return;
    if (!changeDescription && !changeAmount && !changeNotes) {
      setError('Choose at least one field to change.');
      return;
    }
    if (changeDescription && !description.trim()) {
      setError('Description cannot be empty.');
      return;
    }
    if (changeAmount && !isPositiveAmount(amount)) {
      setError('Enter a valid amount greater than zero.');
      return;
    }

    const normalisedAmount = changeAmount ? toAmountString(amount) : null;
    const updated = templates.map((template) => ({
      ...template,
      ...(changeDescription ? { description: description.trim() } : {}),
      ...(changeAmount && normalisedAmount ? { amount: normalisedAmount } : {}),
      ...(changeNotes ? { notes: notes.trim() || null } : {}),
      version: template.version + 1,
    }));

    await onSave(templates, updated);
    onOpenChange(false);
  }, [amount, changeAmount, changeDescription, changeNotes, description, notes, onOpenChange, onSave, templates]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk Edit ({templates.length} planned groups)</DialogTitle>
        </DialogHeader>

        {multiInstanceGroupCount > 0 && (
          <div className="flex gap-2 rounded-md border border-fidra-warning/40 bg-fidra-warning/10 p-3 text-xs text-fidra-warning" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {multiInstanceGroupCount} selected {multiInstanceGroupCount === 1 ? 'group has' : 'groups have'} multiple linked occurrences. These changes will propagate to every occurrence in those groups.
            </p>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Tick the fields to apply to every selected planned group. Unticked fields stay unchanged.
        </p>

        <div className="flex flex-col gap-4 py-2">
          <div className="grid grid-cols-[20px_1fr] items-start gap-2">
            <Checkbox
              id="bulk-planned-description-toggle"
              checked={changeDescription}
              onCheckedChange={(checked) => { setChangeDescription(!!checked); setError(null); }}
            />
            <div>
              <Label htmlFor="bulk-planned-description-toggle" className="text-xs">Change description</Label>
              <Input
                aria-label="New description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={!changeDescription}
                placeholder="New description"
                className="mt-1"
              />
            </div>
          </div>

          <div className="grid grid-cols-[20px_1fr] items-start gap-2">
            <Checkbox
              id="bulk-planned-amount-toggle"
              checked={changeAmount}
              onCheckedChange={(checked) => { setChangeAmount(!!checked); setError(null); }}
            />
            <div>
              <Label htmlFor="bulk-planned-amount-toggle" className="text-xs">Change amount</Label>
              <Input
                aria-label="New amount"
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                disabled={!changeAmount}
                placeholder="0.00"
                className="mt-1"
              />
            </div>
          </div>

          <div className="grid grid-cols-[20px_1fr] items-start gap-2">
            <Checkbox
              id="bulk-planned-notes-toggle"
              checked={changeNotes}
              onCheckedChange={(checked) => { setChangeNotes(!!checked); setError(null); }}
            />
            <div>
              <Label htmlFor="bulk-planned-notes-toggle" className="text-xs">Change notes</Label>
              <textarea
                aria-label="New notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                disabled={!changeNotes}
                placeholder="Leave blank to clear notes"
                rows={3}
                className="mt-1 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void handleSave()}>Apply Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
