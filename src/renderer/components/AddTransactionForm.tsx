import { useState, useCallback, useEffect, useRef } from 'react';
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
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { TransactionRow } from '../../shared/ipc-types';

interface AddTransactionFormProps {
  incomeCategories: string[];
  expenseCategories: string[];
  sheets: string[];
  currentSheet: string;
  descriptionSuggestions: string[];
  partySuggestions: string[];
  activitySuggestions: string[];
  onSubmit: (transaction: TransactionRow) => void;
}

function generateId(): string {
  return crypto.randomUUID();
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function AddTransactionForm({
  incomeCategories,
  expenseCategories,
  sheets,
  currentSheet,
  descriptionSuggestions,
  partySuggestions,
  activitySuggestions,
  onSubmit,
}: AddTransactionFormProps) {
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [party, setParty] = useState('');
  const [reference, setReference] = useState('');
  const [activity, setActivity] = useState('');
  const [notes, setNotes] = useState('');
  const [sheet, setSheet] = useState(currentSheet !== 'All Sheets' ? currentSheet : (sheets[0] ?? ''));
  const [showDetails, setShowDetails] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});
  const amountRef = useRef<HTMLInputElement>(null);

  // Update sheet when sheets list or currentSheet changes
  useEffect(() => {
    if (currentSheet !== 'All Sheets') {
      setSheet(currentSheet);
    } else if (!sheet && sheets[0]) {
      setSheet(sheets[0]);
    }
  }, [currentSheet, sheets]);

  // Auto-focus the amount input on mount
  useEffect(() => {
    amountRef.current?.focus();
  }, []);

  const categories = type === 'income' ? incomeCategories : expenseCategories;

  const resetForm = useCallback(() => {
    setAmount('');
    setDescription('');
    setCategory('');
    setParty('');
    setReference('');
    setActivity('');
    setNotes('');
    setDate(todayISO());
    setFieldErrors({});
    // Re-focus amount after reset
    setTimeout(() => amountRef.current?.focus(), 0);
  }, []);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Allow digits, one decimal point, and leading empty string
    const cleaned = raw.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
    setAmount(cleaned);
    if (fieldErrors.amount) setFieldErrors((prev) => ({ ...prev, amount: false }));
  };

  const handleAmountBlur = () => {
    if (amount && !isNaN(parseFloat(amount))) {
      setAmount(parseFloat(amount).toFixed(2));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const errors: Record<string, boolean> = {};
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) errors.amount = true;
    if (!description.trim()) errors.description = true;
    if (!date) errors.date = true;

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const targetSheet = sheet || sheets[0];
    if (!targetSheet) {
      setFieldErrors({ sheet: true });
      return;
    }
    setFieldErrors({});

    const now = new Date().toISOString();
    const transaction: TransactionRow = {
      id: generateId(),
      date,
      description: description.trim(),
      amount: parseFloat(amount).toFixed(2),
      type,
      status: type === 'income' ? '--' : 'pending',
      sheet: targetSheet,
      category: category || null,
      party: party || null,
      reference: reference || null,
      activity: activity || null,
      notes: notes || null,
      version: 1,
      created_at: now,
      modified_at: null,
      modified_by: null,
    };

    onSubmit(transaction);
    resetForm();
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {/* Type toggle */}
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

        {/* Description — primary field */}
        <div>
          <Label htmlFor="add-description" className="text-xs">Description *</Label>
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

        {/* Date — primary field */}
        <div>
          <Label htmlFor="add-date" className="text-xs">Date</Label>
          <Input
            id="add-date"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              if (fieldErrors.date) setFieldErrors((prev) => ({ ...prev, date: false }));
            }}
            className={fieldErrors.date ? 'border-destructive' : ''}
            required
          />
        </div>

        {/* More details toggle */}
        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-fidra self-start"
        >
          {showDetails ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          More details
        </button>

        {/* Secondary fields */}
        {showDetails && (
          <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-top-1 duration-150">
            {/* Category + Party row */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
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

            {/* Reference + Activity row */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="add-reference" className="text-xs">Reference</Label>
                <Input
                  id="add-reference"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Ref"
                  className="text-xs"
                />
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

            {/* Sheet (conditional) */}
            {currentSheet === 'All Sheets' && sheets.length > 1 && (
              <div>
                <Label className="text-xs">Sheet</Label>
                <Select value={sheet} onValueChange={setSheet}>
                  <SelectTrigger className="text-xs">
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

            {/* Notes */}
            <div>
              <Label htmlFor="add-notes" className="text-xs">Notes</Label>
              <Input
                id="add-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes"
                className="text-xs"
              />
            </div>
          </div>
        )}

        {/* Submit */}
        <Button type="submit" className="w-full mt-1">
          Add {type === 'income' ? 'Income' : 'Expense'}
        </Button>
      </form>
    </div>
  );
}
