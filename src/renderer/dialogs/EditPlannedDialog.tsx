import { useState, useCallback, useEffect, useRef } from 'react';
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

interface EditPlannedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: PlannedTemplateRow | null;
  incomeCategories: string[];
  expenseCategories: string[];
  sheets: string[];
  descriptionSuggestions: string[];
  partySuggestions: string[];
  activitySuggestions: string[];
  onSave: (original: PlannedTemplateRow, updated: PlannedTemplateRow) => void;
}

const FREQUENCY_OPTIONS = [
  { value: 'once', label: 'Once' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
] as const;

export function EditPlannedDialog({
  open,
  onOpenChange,
  template,
  incomeCategories,
  expenseCategories,
  sheets,
  descriptionSuggestions,
  partySuggestions,
  activitySuggestions,
  onSave,
}: EditPlannedDialogProps) {
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [startDate, setStartDate] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [party, setParty] = useState('');
  const [activity, setActivity] = useState('');
  const [sheet, setSheet] = useState('');
  const [frequency, setFrequency] = useState<PlannedTemplateRow['frequency']>('once');
  const [hasEndDate, setHasEndDate] = useState(false);
  const [endDate, setEndDate] = useState('');
  const [hasOccurrenceCount, setHasOccurrenceCount] = useState(false);
  const [occurrenceCount, setOccurrenceCount] = useState('12');
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});
  const amountRef = useRef<HTMLInputElement>(null);

  const categories = type === 'income' ? incomeCategories : expenseCategories;
  const isRecurring = frequency !== 'once';

  // Populate form when template changes
  useEffect(() => {
    if (!open || !template) return;
    setType(template.type);
    setAmount(template.amount);
    setStartDate(template.start_date);
    setDescription(template.description);
    setCategory(template.category ?? '');
    setParty(template.party ?? '');
    setActivity(template.activity ?? '');
    setSheet(template.target_sheet);
    setFrequency(template.frequency);
    setHasEndDate(!!template.end_date);
    setEndDate(template.end_date ?? '');
    setHasOccurrenceCount(template.occurrence_count !== null);
    setOccurrenceCount(template.occurrence_count !== null ? String(template.occurrence_count) : '12');
    setFieldErrors({});
  }, [open, template]);

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

  const handleSave = useCallback(() => {
    if (!template) return;

    const errors: Record<string, boolean> = {};
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) errors.amount = true;
    if (!description.trim()) errors.description = true;
    if (!startDate) errors.startDate = true;

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    if (hasEndDate && endDate && endDate <= startDate) return;

    const updated: PlannedTemplateRow = {
      ...template,
      type,
      amount: parseFloat(amount).toFixed(2),
      start_date: startDate,
      description: description.trim(),
      frequency,
      target_sheet: sheet || template.target_sheet,
      category: category || null,
      party: party || null,
      activity: activity || null,
      end_date: isRecurring && hasEndDate && endDate ? endDate : null,
      occurrence_count: isRecurring && hasOccurrenceCount && occurrenceCount ? parseInt(occurrenceCount) : null,
      version: template.version + 1,
    };

    onSave(template, updated);
    onOpenChange(false);
  }, [template, type, amount, startDate, description, frequency, sheet, category, party, activity, hasEndDate, endDate, hasOccurrenceCount, occurrenceCount, isRecurring, onSave, onOpenChange]);

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

  if (!template) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Planned Transaction</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {/* Type toggle — branded teal */}
          <div className="flex gap-1 rounded-md bg-surface-inset p-1">
            <button
              type="button"
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-display font-medium transition-fidra ${type === 'expense' ? 'bg-fidra-teal text-fidra-navy shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => { setType('expense'); setCategory(''); }}
            >
              Expense
            </button>
            <button
              type="button"
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-display font-medium transition-fidra ${type === 'income' ? 'bg-fidra-teal text-fidra-navy shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => { setType('income'); setCategory(''); }}
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
              placeholder="What is this for?"
              className={fieldErrors.description ? 'border-destructive' : ''}
            />
          </div>

          {/* Start Date — full width */}
          <div>
            <Label className="text-xs">Start Date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (fieldErrors.startDate) setFieldErrors((prev) => ({ ...prev, startDate: false }));
              }}
              className={fieldErrors.startDate ? 'border-destructive' : ''}
            />
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

          {/* Activity + Sheet (or just Activity if single sheet) */}
          <div className={`grid gap-2 ${sheets.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <div>
              <Label className="text-xs">Activity</Label>
              <ComboboxInput
                value={activity}
                onChange={setActivity}
                suggestions={activitySuggestions}
                placeholder="Activity"
              />
            </div>
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
          </div>

          {/* Frequency — full width */}
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
