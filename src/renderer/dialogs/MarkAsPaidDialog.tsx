import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ComboboxInput } from '@/components/ComboboxInput';
import { formatCurrency } from '@/lib/format';
import type { InvoiceRow } from '../../shared/ipc-types';

export interface MarkAsPaidFields {
  sheet: string;
  category: string;
  reference: string;
  activity: string;
  notes: string;
}

export interface TemplateDefaults {
  sheet?: string;
  category?: string;
  activity?: string;
}

interface MarkAsPaidDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: InvoiceRow;
  sheets: string[];
  currentSheet: string;
  incomeCategories: string[];
  activitySuggestions: string[];
  templateDefaults?: TemplateDefaults;
  onConfirm: (fields: MarkAsPaidFields) => void;
}

export function MarkAsPaidDialog({
  open,
  onOpenChange,
  invoice,
  sheets,
  currentSheet,
  incomeCategories,
  activitySuggestions,
  templateDefaults,
  onConfirm,
}: MarkAsPaidDialogProps) {
  const isOnSpecificSheet = currentSheet !== 'All Sheets';
  const defaultSheet = isOnSpecificSheet ? currentSheet : (templateDefaults?.sheet ?? '');
  const [sheet, setSheet] = useState(defaultSheet);
  const [category, setCategory] = useState(templateDefaults?.category ?? '');
  const [reference, setReference] = useState('');
  const [activity, setActivity] = useState(templateDefaults?.activity ?? '');
  const [notes, setNotes] = useState('');

  // Reset fields when dialog opens with new defaults
  useEffect(() => {
    if (open) {
      setSheet(isOnSpecificSheet ? currentSheet : (templateDefaults?.sheet ?? ''));
      setCategory(templateDefaults?.category ?? '');
      setActivity(templateDefaults?.activity ?? '');
      setReference('');
      setNotes('');
    }
  }, [open, isOnSpecificSheet, currentSheet, templateDefaults]);

  const amount = formatCurrency(invoice.subtotal);

  const handleConfirm = () => {
    if (!sheet) return;
    onConfirm({ sheet, category, reference, activity, notes });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark Invoice as Paid</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Creates an income transaction for{' '}
            <span className="font-semibold text-foreground">{amount}</span>
            {invoice.to_name && (
              <> from <span className="font-semibold text-foreground">{invoice.to_name}</span></>
            )}
          </p>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Sheet <span className="text-fidra-negative">*</span>
            </Label>
            <Select value={sheet} onValueChange={setSheet} disabled={isOnSpecificSheet}>
              <SelectTrigger>
                <SelectValue placeholder="Select sheet" />
              </SelectTrigger>
              <SelectContent>
                {sheets.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {incomeCategories.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Reference</Label>
            <input
              className="w-full h-9 px-3 text-sm bg-background border border-border-subtle rounded-md focus:outline-none focus:ring-2 focus:ring-fidra-teal/40 focus:border-fidra-teal transition-fidra"
              placeholder="Payment reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Activity</Label>
            <ComboboxInput
              value={activity}
              onChange={setActivity}
              suggestions={activitySuggestions}
              placeholder="Select or type activity"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <textarea
              className="w-full px-3 py-2.5 text-sm bg-background border border-border-subtle rounded-md focus:outline-none focus:ring-2 focus:ring-fidra-teal/40 focus:border-fidra-teal transition-fidra resize-none"
              rows={3}
              placeholder="Optional notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!sheet}>
            Confirm & Pay
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
