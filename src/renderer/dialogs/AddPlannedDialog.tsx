import { useState, useCallback, useEffect } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import type { PlannedTemplateRow } from '../../shared/ipc-types';

interface AddPlannedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incomeCategories: string[];
  expenseCategories: string[];
  sheets: string[];
  currentSheet: string;
  descriptionSuggestions: string[];
  partySuggestions: string[];
  activitySuggestions: string[];
  onSave: (template: PlannedTemplateRow) => void;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const FREQUENCY_OPTIONS = [
  { value: 'once', label: 'Once' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
] as const;

export function AddPlannedDialog({
  open,
  onOpenChange,
  incomeCategories,
  expenseCategories,
  sheets,
  currentSheet,
  descriptionSuggestions,
  partySuggestions,
  activitySuggestions,
  onSave,
}: AddPlannedDialogProps) {
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [startDate, setStartDate] = useState(todayISO());
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [party, setParty] = useState('');
  const [activity, setActivity] = useState('');
  const [notes, setNotes] = useState('');
  const [sheet, setSheet] = useState(currentSheet !== 'All Sheets' ? currentSheet : (sheets[0] ?? ''));
  const [frequency, setFrequency] = useState<PlannedTemplateRow['frequency']>('once');
  const [hasEndDate, setHasEndDate] = useState(false);
  const [endDate, setEndDate] = useState('');
  const [hasOccurrenceCount, setHasOccurrenceCount] = useState(false);
  const [occurrenceCount, setOccurrenceCount] = useState('12');

  const categories = type === 'income' ? incomeCategories : expenseCategories;
  const isRecurring = frequency !== 'once';

  useEffect(() => {
    if (!open) return;
    setType('expense');
    setAmount('');
    setStartDate(todayISO());
    setDescription('');
    setCategory('');
    setParty('');
    setActivity('');
    setNotes('');
    setSheet(currentSheet !== 'All Sheets' ? currentSheet : (sheets[0] ?? ''));
    setFrequency('once');
    setHasEndDate(false);
    setEndDate('');
    setHasOccurrenceCount(false);
    setOccurrenceCount('12');
  }, [open, currentSheet, sheets]);

  const handleSave = useCallback(() => {
    if (!description.trim()) return;
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) return;
    if (!startDate) return;

    const targetSheet = sheet || sheets[0];
    if (!targetSheet) return;

    if (hasEndDate && endDate && endDate <= startDate) return;

    const template: PlannedTemplateRow = {
      id: crypto.randomUUID(),
      start_date: startDate,
      description: description.trim(),
      amount: parseFloat(amount).toFixed(2),
      type,
      frequency,
      target_sheet: targetSheet,
      category: category || null,
      party: party || null,
      activity: activity || null,
      notes: notes.trim() || null,
      end_date: isRecurring && hasEndDate && endDate ? endDate : null,
      occurrence_count: isRecurring && hasOccurrenceCount && occurrenceCount ? parseInt(occurrenceCount) : null,
      skipped_dates: '[]',
      fulfilled_dates: '[]',
      version: 1,
      created_at: new Date().toISOString(),
    };

    onSave(template);
    onOpenChange(false);
  }, [description, amount, startDate, sheet, sheets, type, frequency, category, party, activity, notes, hasEndDate, endDate, hasOccurrenceCount, occurrenceCount, isRecurring, onSave, onOpenChange]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Planned Transaction</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {/* Type toggle */}
          <div className="flex gap-1 rounded-md bg-muted p-1">
            <button
              type="button"
              className={`flex-1 rounded-sm px-3 py-1 text-sm font-medium transition-colors ${type === 'expense' ? 'bg-background shadow text-foreground' : 'text-muted-foreground'}`}
              onClick={() => { setType('expense'); setCategory(''); }}
            >
              Expense
            </button>
            <button
              type="button"
              className={`flex-1 rounded-sm px-3 py-1 text-sm font-medium transition-colors ${type === 'income' ? 'bg-background shadow text-foreground' : 'text-muted-foreground'}`}
              onClick={() => { setType('income'); setCategory(''); }}
            >
              Income
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Amount</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label className="text-xs">Start Date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="text-xs">Description *</Label>
            <ComboboxInput
              value={description}
              onChange={setDescription}
              suggestions={descriptionSuggestions}
              placeholder="Description"
            />
          </div>

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

          <div>
            <Label className="text-xs">Activity</Label>
            <ComboboxInput
              value={activity}
              onChange={setActivity}
              suggestions={activitySuggestions}
              placeholder="Activity"
            />
          </div>

          <div>
            <Label className="text-xs">Notes</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-fidra-teal/40 focus:border-fidra-teal transition-fidra resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            {currentSheet === 'All Sheets' && sheets.length > 1 && (
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
              <Label className="text-xs">Frequency</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as PlannedTemplateRow['frequency'])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* End conditions (recurring only) */}
          {isRecurring && (
            <div className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
              <p className="text-xs font-display font-medium text-muted-foreground uppercase tracking-[0.05em]">End Condition</p>

              <div className="flex items-center gap-2">
                <Checkbox
                  checked={hasEndDate}
                  onCheckedChange={(checked) => {
                    setHasEndDate(!!checked);
                    if (checked) setHasOccurrenceCount(false);
                  }}
                />
                <Label className="text-xs">End date</Label>
                {hasEndDate && (
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="flex-1 h-8"
                  />
                )}
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  checked={hasOccurrenceCount}
                  onCheckedChange={(checked) => {
                    setHasOccurrenceCount(!!checked);
                    if (checked) setHasEndDate(false);
                  }}
                />
                <Label className="text-xs">After</Label>
                {hasOccurrenceCount && (
                  <>
                    <Input
                      type="number"
                      min="1"
                      max="1000"
                      value={occurrenceCount}
                      onChange={(e) => setOccurrenceCount(e.target.value)}
                      className="w-20 h-8"
                    />
                    <span className="text-xs text-muted-foreground">occurrences</span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
