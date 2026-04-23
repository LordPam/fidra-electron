// Invoices are intentionally not sheet-scoped — they are ledger-wide documents.
// Mark-as-paid creates a sheet-scoped transaction, but the invoice itself is global.
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toISODate } from '@/lib/chart-utils';
import { formatCurrency, formatDate } from '@/lib/format';
import { Plus, Trash2, FileDown, Link2, CheckCircle2, Image, X, Undo2, Copy } from 'lucide-react';
import { useInvoiceStore } from '@/stores/invoice-store';
import { useSheetStore } from '@/stores/sheet-store';
import type { InvoiceLineItem } from '@/services/invoice-html';
import type { InvoiceRow, InvoicePrefill, InvoiceDefaults, TransactionRow, PlannedTemplateRow } from '../../shared/ipc-types';
import { cn } from '@/lib/utils';
import { useUndoStore } from '@/stores/undo-store';
import { usePlannedStore } from '@/stores/planned-store';
import { createDeleteInvoiceCommand, createMarkAsPaidCommand, createRevertToDraftCommand } from '@/services/undo';
import { MarkAsPaidDialog } from '@/dialogs/MarkAsPaidDialog';
import type { MarkAsPaidFields, TemplateDefaults } from '@/dialogs/MarkAsPaidDialog';
import { useUndoRedoShortcuts } from '@/hooks/useUndoRedoShortcuts';
import { nextInvoiceNumber, peekInvoiceNumber } from '@/services/invoice-numbering';

// --- Main ---

export default function InvoicesView() {
  const location = useLocation();
  const { invoices, loading, loadAll, save, remove, markPaid, revertToDraft } = useInvoiceStore();
  const { sheets, currentSheet } = useSheetStore();
  const execute = useUndoStore((s) => s.execute);

  // --- Builder state (hydrated from SQLite settings via IPC) ---
  const [fromName, setFromName] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [toName, setToName] = useState('');
  const [toAddress, setToAddress] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [date, setDate] = useState(() => toISODate(new Date()));
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return toISODate(d);
  });
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([
    { description: '', quantity: 1, unitPrice: 0 },
  ]);
  const [notes, setNotes] = useState('');
  const [bankDetails, setBankDetails] = useState('');
  const [plannedTemplateId, setPlannedTemplateId] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [hoveredInvoiceId, setHoveredInvoiceId] = useState<string | null>(null);
  const [logoPath, setLogoPath] = useState('');
  const [hydrated, setHydrated] = useState(false);

  // Counter JSON stored in SQLite — kept in a ref so invoice number generation
  // can read/write it synchronously while persistence happens via IPC.
  const counterRef = useRef('');

  // Hydrate persisted defaults from SQLite settings
  useEffect(() => {
    window.api.getInvoiceDefaults().then((defaults) => {
      setFromName(defaults.fromName);
      setFromAddress(defaults.fromAddress);
      setNotes(defaults.notes);
      setBankDetails(defaults.bankDetails);
      setLogoPath(defaults.logoPath);
      counterRef.current = defaults.counter;
      setHydrated(true);
    });
  }, []);
  const [markAsPaidOpen, setMarkAsPaidOpen] = useState(false);
  const [templateDefaults, setTemplateDefaults] = useState<TemplateDefaults | undefined>();
  const [incomeCategories, setIncomeCategories] = useState<string[]>([]);
  const [activitySuggestions, setActivitySuggestions] = useState<string[]>([]);

  const toNameRef = useRef<HTMLInputElement>(null);

  const existingNumbers = useMemo(
    () => new Set(invoices.map((inv) => inv.invoice_number)),
    [invoices],
  );

  const selectedInvoice = useMemo(
    () => invoices.find((inv) => inv.id === selectedInvoiceId) ?? null,
    [invoices, selectedInvoiceId],
  );

  const isPaid = selectedInvoice?.status === 'paid';

  const unpaidInvoices = useMemo(
    () => invoices.filter((inv) => inv.status !== 'paid'),
    [invoices],
  );
  const paidInvoices = useMemo(
    () => invoices.filter((inv) => inv.status === 'paid'),
    [invoices],
  );

  const sheetNames = useMemo(
    () => sheets.filter((s) => !s.is_virtual && !s.is_planned).map((s) => s.name),
    [sheets],
  );

  // Initialize invoice number after invoices are loaded and defaults hydrated
  useEffect(() => {
    if (!loading && invoiceNumber === '' && hydrated) {
      setInvoiceNumber(peekInvoiceNumber(existingNumbers, counterRef.current));
    }
  }, [loading, existingNumbers, invoiceNumber, hydrated]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useUndoRedoShortcuts();

  // Load categories and activities for mark-as-paid dialog
  useEffect(() => {
    window.api.getCategories('income').then(setIncomeCategories).catch(() => {});
    window.api.getTransactions().then((txns) => {
      const activities = new Set<string>();
      for (const t of txns) {
        if (t.activity) activities.add(t.activity);
      }
      setActivitySuggestions([...activities].sort());
    }).catch(() => {});
  }, []);

  // --- Persist defaults to SQLite (debounced, only after hydration) ---
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!hydrated) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const defaults: InvoiceDefaults = {
        fromName, fromAddress, bankDetails, notes, logoPath,
        counter: counterRef.current,
      };
      window.api.saveInvoiceDefaults(defaults);
    }, 500);
    return () => clearTimeout(saveTimerRef.current);
  }, [hydrated, fromName, fromAddress, bankDetails, notes, logoPath]);

  // --- Apply prefill from navigation state ---
  useEffect(() => {
    const state = location.state as { invoicePrefill?: InvoicePrefill } | null;
    if (!state?.invoicePrefill) return;
    const prefill = state.invoicePrefill;
    setToName(prefill.toName);
    setLineItems([{ description: prefill.description, quantity: 1, unitPrice: prefill.amount }]);
    if (prefill.date) {
      setDueDate(prefill.date);
      setDate(toISODate(new Date()));
    }
    if (prefill.plannedTemplateId) setPlannedTemplateId(prefill.plannedTemplateId);
    setSelectedInvoiceId(null);
    window.history.replaceState({}, '');
    setTimeout(() => toNameRef.current?.focus(), 100);
  }, [location.state]);

  // --- Line items ---
  const subtotal = lineItems.reduce((s, item) => s + item.quantity * item.unitPrice, 0);

  const updateLineItem = (index: number, field: keyof InvoiceLineItem, value: string | number) => {
    setLineItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addLineItem = () => {
    setLineItems((prev) => [...prev, { description: '', quantity: 1, unitPrice: 0 }]);
  };

  const removeLineItem = (index: number) => {
    if (lineItems.length <= 1) return;
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  };

  // --- Reset builder to blank ---
  const resetBuilder = useCallback(() => {
    setToName('');
    setToAddress('');
    setLineItems([{ description: '', quantity: 1, unitPrice: 0 }]);
    setDate(toISODate(new Date()));
    const d = new Date();
    d.setDate(d.getDate() + 30);
    setDueDate(toISODate(d));
    setPlannedTemplateId(null);
    setSelectedInvoiceId(null);
    setInvoiceNumber(peekInvoiceNumber(existingNumbers, counterRef.current));
  }, [existingNumbers]);

  // --- Load invoice into builder ---
  const loadInvoice = useCallback((inv: InvoiceRow) => {
    setSelectedInvoiceId(inv.id);
    setFromName(inv.from_name);
    setFromAddress(inv.from_address ?? '');
    setToName(inv.to_name);
    setToAddress(inv.to_address ?? '');
    setInvoiceNumber(inv.invoice_number);
    setDate(inv.date);
    setDueDate(inv.due_date);
    setNotes(inv.notes ?? '');
    setBankDetails(inv.bank_details ?? '');
    setPlannedTemplateId(inv.planned_template_id);
    try {
      const items = JSON.parse(inv.line_items) as InvoiceLineItem[];
      setLineItems(items.length > 0 ? items : [{ description: '', quantity: 1, unitPrice: 0 }]);
    } catch {
      setLineItems([{ description: '', quantity: 1, unitPrice: 0 }]);
    }
  }, []);

  // --- Select existing invoice from navigation state ---
  useEffect(() => {
    const state = location.state as { selectInvoiceId?: string } | null;
    if (!state?.selectInvoiceId || loading || invoices.length === 0) return;
    const target = invoices.find((inv) => inv.id === state.selectInvoiceId);
    if (target) {
      loadInvoice(target);
      window.history.replaceState({}, '');
    }
  }, [location.state, loading, invoices, loadInvoice]);

  // --- Logo ---
  const handleChooseLogo = useCallback(async () => {
    const result = await window.api.showOpenDialog({
      title: 'Choose Invoice Logo',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }],
      properties: ['openFile'],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      setLogoPath(result.filePaths[0]);
    }
  }, []);

  const handleRemoveLogo = useCallback(() => { setLogoPath(''); }, []);

  // --- Duplicate ---
  const handleDuplicate = useCallback(() => {
    // Keep all current field values but reset to a new invoice
    setSelectedInvoiceId(null);
    setPlannedTemplateId(null);
    setDate(toISODate(new Date()));
    const d = new Date();
    d.setDate(d.getDate() + 30);
    setDueDate(toISODate(d));
    setInvoiceNumber(peekInvoiceNumber(existingNumbers, counterRef.current));
  }, [existingNumbers]);

  // --- Generate ---
  const handleGenerateInvoice = useCallback(async () => {
    const validItems = lineItems.filter((item) => item.description.trim() && item.unitPrice > 0);
    if (validItems.length === 0) return;

    const todayStr = toISODate(new Date());
    const isOverdue = dueDate < todayStr && !isPaid;

    let finalInvoiceNumber: string;
    if (selectedInvoiceId) {
      finalInvoiceNumber = invoiceNumber;
    } else {
      const result = nextInvoiceNumber(existingNumbers, counterRef.current);
      finalInvoiceNumber = result.invoiceNumber;
      counterRef.current = result.counter;
      // Persist updated counter immediately
      window.api.saveInvoiceDefaults({
        fromName, fromAddress, bankDetails, notes, logoPath,
        counter: counterRef.current,
      });
    }
    setInvoiceNumber(finalInvoiceNumber);

    // Save invoice record to SQLite (only for non-paid invoices)
    if (!isPaid) {
      const invoiceRow: InvoiceRow = {
        id: selectedInvoiceId ?? crypto.randomUUID(),
        invoice_number: finalInvoiceNumber,
        date,
        due_date: dueDate,
        from_name: fromName,
        from_address: fromAddress || null,
        to_name: toName,
        to_address: toAddress || null,
        line_items: JSON.stringify(validItems),
        subtotal: subtotal.toFixed(2),
        notes: notes.trim() || null,
        bank_details: bankDetails.trim() || null,
        planned_template_id: plannedTemplateId,
        status: 'draft',
        transaction_id: null,
        paid_at: null,
        planned_template_snapshot: null,
        version: selectedInvoiceId
          ? (invoices.find((i) => i.id === selectedInvoiceId)?.version ?? 1)
          : 1,
        created_at: selectedInvoiceId
          ? (invoices.find((i) => i.id === selectedInvoiceId)?.created_at ?? new Date().toISOString())
          : new Date().toISOString(),
        modified_at: null,
        modified_by: null,
      };
      await save(invoiceRow);
      if (!selectedInvoiceId) setSelectedInvoiceId(invoiceRow.id);
    }

    const { generateInvoicePDF, saveInvoicePDF } = await import('@/services/invoice-generator');
    const pdfBytes = await generateInvoicePDF({
      fromName,
      fromAddress,
      toName,
      toAddress,
      invoiceNumber: finalInvoiceNumber,
      date,
      dueDate,
      lineItems: validItems,
      notes: notes.trim(),
      bankDetails: bankDetails.trim(),
      isOverdue,
      logoPath,
    });
    await saveInvoicePDF(pdfBytes, finalInvoiceNumber);

    if (!selectedInvoiceId) {
      setInvoiceNumber(peekInvoiceNumber(new Set([...existingNumbers, finalInvoiceNumber]), counterRef.current));
    }
  }, [fromName, fromAddress, toName, toAddress, invoiceNumber, date, dueDate, lineItems, notes, bankDetails, plannedTemplateId, selectedInvoiceId, existingNumbers, invoices, subtotal, save, isPaid, logoPath]);

  // --- Mark as paid ---
  const handleMarkAsPaid = useCallback(async (fields: MarkAsPaidFields) => {
    if (!selectedInvoice) return;

    let description = '';
    try {
      const items = JSON.parse(selectedInvoice.line_items) as InvoiceLineItem[];
      description = items[0]?.description || selectedInvoice.invoice_number;
    } catch {
      description = selectedInvoice.invoice_number;
    }

    const transaction: TransactionRow = {
      id: crypto.randomUUID(),
      date: toISODate(new Date()),
      description,
      amount: selectedInvoice.subtotal,
      type: 'income',
      status: '--',
      sheet: fields.sheet,
      category: fields.category || null,
      party: selectedInvoice.to_name || null,
      reference: fields.reference || null,
      activity: fields.activity || null,
      notes: fields.notes || null,
      version: 1,
      created_at: new Date().toISOString(),
      modified_at: null,
      modified_by: null,
    };

    // Capture template state before modification for undo
    let templateBefore: PlannedTemplateRow | undefined;
    let templateAfter: PlannedTemplateRow | undefined;
    let invoiceAfterPaid: InvoiceRow = { ...selectedInvoice, status: 'paid', transaction_id: transaction.id, paid_at: new Date().toISOString(), planned_template_snapshot: null };

    if (selectedInvoice.planned_template_id) {
      try {
        const templates = await window.api.getPlannedTemplates();
        const template = templates.find((t) => t.id === selectedInvoice.planned_template_id);
        if (template) {
          templateBefore = { ...template };
          if (template.frequency === 'once') {
            // Will delete template; snapshot stored on invoice
            invoiceAfterPaid = { ...invoiceAfterPaid, planned_template_snapshot: JSON.stringify(template) };
          } else {
            const fulfilled: string[] = JSON.parse(template.fulfilled_dates || '[]');
            const dateToAdd = toISODate(new Date());
            fulfilled.push(dateToAdd);
            templateAfter = { ...template, fulfilled_dates: JSON.stringify(fulfilled), version: template.version + 1 };
            invoiceAfterPaid = { ...invoiceAfterPaid, planned_template_snapshot: dateToAdd };
          }
        }
      } catch { /* Non-critical: proceed without template handling */ }
    }

    await execute(createMarkAsPaidCommand({
      invoice: selectedInvoice,
      transaction,
      templateBefore,
      templateAfter,
      invoiceAfterPaid,
    }));

    // Refresh planned store so UI updates
    await usePlannedStore.getState().loadAll();
  }, [selectedInvoice, execute]);

  // --- Revert to draft ---
  const handleRevertToDraft = useCallback(async () => {
    if (!selectedInvoice || selectedInvoice.status !== 'paid') return;

    const linkedTxId = selectedInvoice.transaction_id;
    const templateId = selectedInvoice.planned_template_id;
    const snapshot = selectedInvoice.planned_template_snapshot;

    // Capture linked transaction for undo
    let linkedTransaction: TransactionRow | null = null;
    if (linkedTxId) {
      try {
        linkedTransaction = await window.api.getTransaction(linkedTxId);
      } catch { /* Non-critical */ }
    }

    // Capture template state before and after revert for undo
    let templateBeforeRevert: PlannedTemplateRow | undefined;
    let templateAfterRevert: PlannedTemplateRow | undefined;

    if (templateId && snapshot) {
      try {
        const templates = await window.api.getPlannedTemplates();
        const existing = templates.find((t) => t.id === templateId);

        if (existing) {
          // Recurring: will remove a fulfilled date
          templateBeforeRevert = { ...existing };
          const fulfilled: string[] = JSON.parse(existing.fulfilled_dates || '[]');
          const idx = fulfilled.indexOf(snapshot);
          if (idx >= 0) fulfilled.splice(idx, 1);
          templateAfterRevert = { ...existing, fulfilled_dates: JSON.stringify(fulfilled), version: existing.version + 1 };
        } else {
          // Once: template was deleted, will be recreated from snapshot
          templateAfterRevert = JSON.parse(snapshot) as PlannedTemplateRow;
        }
      } catch { /* Non-critical */ }
    }

    await execute(createRevertToDraftCommand(
      selectedInvoice,
      linkedTransaction,
      templateBeforeRevert,
      templateAfterRevert,
    ));

    // Refresh planned store so UI updates
    await usePlannedStore.getState().loadAll();
  }, [selectedInvoice, execute]);

  const handleDeleteInvoice = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const invoice = invoices.find((inv) => inv.id === id);
    if (!invoice) return;
    await execute(createDeleteInvoiceCommand(invoice));
    if (selectedInvoiceId === id) resetBuilder();
  }, [invoices, execute, selectedInvoiceId, resetBuilder]);

  // --- Status badge component ---
  const StatusBadge = ({ inv }: { inv: InvoiceRow }) => {
    if (inv.status === 'paid') {
      return (
        <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-medium">
          <CheckCircle2 className="h-2.5 w-2.5" />
          Paid
        </span>
      );
    }
    const isOverdue = inv.due_date < toISODate(new Date());
    if (isOverdue) {
      return (
        <span className="inline-flex items-center rounded-full border border-fidra-negative/30 bg-fidra-negative/10 text-fidra-negative px-2 py-0.5 text-[10px] font-medium">
          Overdue
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full border border-fidra-slate/20 dark:border-fidra-cream/15 bg-fidra-slate/10 dark:bg-fidra-cream/8 text-fidra-slate dark:text-fidra-cream/70 px-2 py-0.5 text-[10px] font-medium">
        Draft
      </span>
    );
  };

  // --- Render history item ---
  const renderInvoiceItem = (inv: InvoiceRow) => {
    const invIsPaid = inv.status === 'paid';
    return (
      <div
        key={inv.id}
        className={cn(
          'relative px-3 py-3 cursor-pointer transition-colors',
          'hover:bg-fidra-teal/5',
          selectedInvoiceId === inv.id
            ? 'bg-fidra-teal/12 border-l-2 border-l-fidra-teal'
            : 'border-l-2 border-l-transparent',
        )}
        onClick={() => loadInvoice(inv)}
        onMouseEnter={() => setHoveredInvoiceId(inv.id)}
        onMouseLeave={() => setHoveredInvoiceId(null)}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {/* Recipient name — most prominent */}
            <p className="text-sm font-body font-medium text-foreground truncate">
              {inv.to_name}
            </p>
            {/* Invoice number — secondary reference */}
            <p className="text-[11px] font-mono text-fidra-slate dark:text-fidra-cream/50 truncate mt-0.5">
              {inv.invoice_number}
            </p>
            {/* Date · Amount */}
            <p className="text-xs text-fidra-slate dark:text-fidra-cream/50 mt-1">
              {formatDate(inv.date)}
              <span className="mx-1.5 text-fidra-slate/40 dark:text-fidra-cream/25">&middot;</span>
              <span className="font-mono tabular-nums">{formatCurrency(inv.subtotal)}</span>
            </p>
            {/* Status badge */}
            <div className="mt-1.5 flex items-center gap-1.5">
              <StatusBadge inv={inv} />
              {inv.planned_template_id && (
                <span className="inline-flex items-center gap-0.5 rounded-full border border-fidra-teal/25 bg-fidra-teal/10 text-fidra-teal dark:text-fidra-teal px-2 py-0.5 text-[10px] font-medium">
                  <Link2 className="h-2.5 w-2.5" />
                  Linked
                </span>
              )}
            </div>
          </div>
          {hoveredInvoiceId === inv.id && !invIsPaid && (
            <button
              type="button"
              className="shrink-0 w-6 h-6 flex items-center justify-center text-fidra-slate/60 hover:text-fidra-negative hover:bg-fidra-negative/10 rounded-md transition-fidra"
              onClick={(e) => handleDeleteInvoice(inv.id, e)}
              title="Delete invoice"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    );
  };

  // --- Input class for inset-style inputs ---
  const INSET_INPUT =
    'w-full h-9 px-3 text-sm bg-surface-inset dark:bg-[#222528] border border-border-subtle dark:border-[#3a3d42] rounded-md focus:outline-none focus:border-fidra-teal focus:ring-[3px] focus:ring-fidra-teal/30 transition-fidra placeholder:text-fidra-slate/40 dark:placeholder:text-fidra-cream/25 disabled:opacity-50 disabled:cursor-not-allowed';

  const INSET_TEXTAREA =
    'w-full px-3 py-2.5 text-sm bg-surface-inset dark:bg-[#222528] border border-border-subtle dark:border-[#3a3d42] rounded-md focus:outline-none focus:border-fidra-teal focus:ring-[3px] focus:ring-fidra-teal/30 transition-fidra resize-none placeholder:text-fidra-slate/40 dark:placeholder:text-fidra-cream/25 leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed';

  // Borderless inline inputs for table cells
  const CELL_INPUT =
    'w-full h-9 px-2 text-sm bg-transparent border-b border-transparent focus:border-fidra-teal focus:bg-surface-inset/30 dark:focus:bg-[#222528]/30 rounded-none focus:outline-none transition-fidra placeholder:text-fidra-slate/30 dark:placeholder:text-fidra-cream/20 disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border-subtle bg-surface-raised shrink-0">
        <h1 className="text-xl font-display font-semibold">Invoices</h1>
      </header>

      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left panel: Invoice History */}
        <div className="w-[220px] shrink-0 border-r border-border-subtle bg-surface-raised flex flex-col overflow-hidden">
          <div className="px-3 py-3 border-b border-border-subtle">
            <h2 className="text-sm font-display font-semibold text-foreground">
              Invoice history
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <p className="text-sm text-fidra-slate">Loading...</p>
              </div>
            ) : invoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-3 text-center">
                <p className="text-sm text-fidra-slate dark:text-fidra-cream/60">No invoices yet</p>
                <p className="text-xs text-fidra-slate/60 dark:text-fidra-cream/35 mt-1">
                  Generate an invoice to see it here
                </p>
              </div>
            ) : (
              <div>
                {/* Unpaid invoices */}
                {unpaidInvoices.map(renderInvoiceItem)}

                {/* Paid section */}
                {paidInvoices.length > 0 && (
                  <>
                    <div className="px-3 py-2 mt-1 border-t border-border-subtle">
                      <p className="text-[10px] font-display font-semibold uppercase tracking-widest text-fidra-slate/50 dark:text-fidra-cream/35">
                        Paid
                      </p>
                    </div>
                    {paidInvoices.map(renderInvoiceItem)}
                  </>
                )}
              </div>
            )}
          </div>
          {/* Bottom: New Invoice button */}
          <div className="px-3 py-3 border-t border-border-subtle">
            <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs" onClick={resetBuilder}>
              <Plus className="h-3.5 w-3.5" />
              New Invoice
            </Button>
          </div>
        </div>

        {/* Right panel: Invoice Editor */}
        <div className="flex-1 overflow-y-auto bg-background p-6">
          <div className="max-w-[780px] mx-auto bg-[#EEEEE9] dark:bg-[#2A2D32] rounded-xl border border-border-subtle dark:border-[#3a3d42] shadow-sm px-8 py-7">
            {/* Paid banner */}
            {isPaid && selectedInvoice && (
              <div className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                      Invoice Paid
                    </p>
                    <p className="text-xs text-emerald-600/80 dark:text-emerald-400/80 mt-0.5">
                      {selectedInvoice.paid_at ? formatDate(selectedInvoice.paid_at.split('T')[0]) : 'Unknown date'}
                      {selectedInvoice.transaction_id && ` \u00b7 Txn ${selectedInvoice.transaction_id.slice(0, 8)}\u2026`}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs text-emerald-700 dark:text-emerald-300 hover:text-fidra-negative hover:bg-fidra-negative/10"
                  onClick={handleRevertToDraft}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Revert to Draft
                </Button>
              </div>
            )}

            {!selectedInvoiceId && (
              <p className="text-sm text-muted-foreground mb-5">
                Create a one-page invoice PDF. Fields marked with a dot are remembered across sessions.
              </p>
            )}

            {/* === Parties (no section label — From/Bill To labels inside cards suffice) === */}
            <div className="grid grid-cols-2 gap-4 mb-5">
              {/* From card */}
              <div className="rounded-lg border border-border-subtle dark:border-[#3a3d42] bg-surface-inset/50 dark:bg-[#24262a] p-4 space-y-2.5 focus-within:border-fidra-teal/50 transition-colors">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-fidra-teal" title="Persisted across sessions" />
                  <Label className="text-xs uppercase tracking-wider text-fidra-slate dark:text-fidra-cream/50">From</Label>
                </div>
                <input
                  className="w-full h-9 px-3 text-sm bg-transparent border-0 focus:outline-none placeholder:text-fidra-slate/40 dark:placeholder:text-fidra-cream/25 disabled:opacity-50 disabled:cursor-not-allowed font-body font-medium"
                  placeholder="Organisation / sender name"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  disabled={isPaid}
                />
                <textarea
                  className="w-full px-3 py-2 text-sm bg-transparent border-0 focus:outline-none resize-none placeholder:text-fidra-slate/40 dark:placeholder:text-fidra-cream/25 leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
                  rows={3}
                  placeholder={"Address line 1\nCity, Postcode\nCountry"}
                  value={fromAddress}
                  onChange={(e) => setFromAddress(e.target.value)}
                  disabled={isPaid}
                />
                {/* Logo picker */}
                <div className="flex items-center gap-2 pt-0.5">
                  {logoPath ? (
                    <>
                      <div className="h-7 w-7 rounded border border-border-subtle dark:border-[#3a3d42] bg-background dark:bg-[#222528] flex items-center justify-center overflow-hidden">
                        <Image className="h-3.5 w-3.5 text-fidra-slate/40 dark:text-fidra-cream/25" />
                      </div>
                      <span className="text-[11px] text-fidra-slate dark:text-fidra-cream/50 truncate flex-1" title={logoPath}>
                        {logoPath.split('/').pop()}
                      </span>
                      <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] text-fidra-slate dark:text-fidra-cream/50" onClick={handleChooseLogo} disabled={isPaid}>
                        Change
                      </Button>
                      <button
                        type="button"
                        className="h-6 w-6 flex items-center justify-center text-fidra-slate/50 dark:text-fidra-cream/30 hover:text-fidra-negative rounded transition-fidra"
                        onClick={handleRemoveLogo}
                        disabled={isPaid}
                        title="Remove logo"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </>
                  ) : (
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] text-fidra-slate dark:text-fidra-cream/50 gap-1" onClick={handleChooseLogo} disabled={isPaid}>
                      <Image className="h-3 w-3" />
                      Add logo
                    </Button>
                  )}
                </div>
              </div>

              {/* Bill To card */}
              <div className="rounded-lg border border-border-subtle dark:border-[#3a3d42] bg-surface-inset/50 dark:bg-[#24262a] p-4 space-y-2.5 focus-within:border-fidra-teal/50 transition-colors">
                <Label className="text-xs uppercase tracking-wider text-fidra-slate dark:text-fidra-cream/50">Bill To</Label>
                <input
                  ref={toNameRef}
                  className="w-full h-9 px-3 text-sm bg-transparent border-0 focus:outline-none placeholder:text-fidra-slate/40 dark:placeholder:text-fidra-cream/25 disabled:opacity-50 disabled:cursor-not-allowed font-body font-medium"
                  placeholder="Recipient name"
                  value={toName}
                  onChange={(e) => setToName(e.target.value)}
                  disabled={isPaid}
                />
                <textarea
                  className="w-full px-3 py-2 text-sm bg-transparent border-0 focus:outline-none resize-none placeholder:text-fidra-slate/40 dark:placeholder:text-fidra-cream/25 leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
                  rows={3}
                  placeholder={"Address line 1\nCity, Postcode\nCountry"}
                  value={toAddress}
                  onChange={(e) => setToAddress(e.target.value)}
                  disabled={isPaid}
                />
              </div>
            </div>

            {/* === Invoice Details — compact row, no section label === */}
            <div className="flex gap-4 mb-5">
              <div className="flex-[1.2]">
                <Label className="text-xs text-fidra-slate dark:text-fidra-cream/50">Invoice Number</Label>
                <input
                  className={`${INSET_INPUT} mt-1 font-mono tabular-nums`}
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  disabled={isPaid}
                />
              </div>
              <div className="flex-1">
                <Label className="text-xs text-fidra-slate dark:text-fidra-cream/50">Date</Label>
                <input
                  type="date"
                  className={`${INSET_INPUT} mt-1`}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  disabled={isPaid}
                />
              </div>
              <div className="flex-1">
                <Label className="text-xs text-fidra-slate dark:text-fidra-cream/50">Due Date</Label>
                <input
                  type="date"
                  className={`${INSET_INPUT} mt-1`}
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={isPaid}
                />
              </div>
            </div>

            {/* === Line Items === */}
            <section className="mb-6">
              <p className="text-xs font-display font-medium uppercase tracking-[0.06em] text-fidra-slate dark:text-fidra-cream/50 mb-3">
                Line Items
              </p>
              <div className="rounded-lg border border-border-subtle dark:border-[#3a3d42] overflow-hidden shadow-xs">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-raised dark:bg-[#32363B]">
                      <th className="text-left px-4 py-2.5 font-display text-[11px] font-semibold uppercase tracking-wider text-fidra-slate dark:text-fidra-cream/50">
                        Description
                      </th>
                      <th className="text-center px-3 py-2.5 font-display text-[11px] font-semibold uppercase tracking-wider text-fidra-slate dark:text-fidra-cream/50 w-[70px]">
                        Qty
                      </th>
                      <th className="text-right px-3 py-2.5 font-display text-[11px] font-semibold uppercase tracking-wider text-fidra-slate dark:text-fidra-cream/50 w-[110px]">
                        Unit Price
                      </th>
                      <th className="text-right px-4 py-2.5 font-display text-[11px] font-semibold uppercase tracking-wider text-fidra-slate dark:text-fidra-cream/50 w-[110px]">
                        Total
                      </th>
                      {!isPaid && <th className="w-[36px]" />}
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item, i) => (
                      <tr
                        key={i}
                        className="group border-t border-border-subtle/50 hover:bg-fidra-teal/3 transition-colors"
                      >
                        <td className="px-3 py-1">
                          <input
                            className={CELL_INPUT}
                            placeholder="Item description"
                            value={item.description}
                            onChange={(e) => updateLineItem(i, 'description', e.target.value)}
                            disabled={isPaid}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            min={1}
                            className={`${CELL_INPUT} text-center tabular-nums`}
                            value={item.quantity}
                            onChange={(e) =>
                              updateLineItem(i, 'quantity', Math.max(1, parseInt(e.target.value) || 1))
                            }
                            disabled={isPaid}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            className={`${CELL_INPUT} text-right font-mono tabular-nums`}
                            value={item.unitPrice || ''}
                            onChange={(e) =>
                              updateLineItem(i, 'unitPrice', Math.max(0, parseFloat(e.target.value) || 0))
                            }
                            disabled={isPaid}
                          />
                        </td>
                        <td className="px-4 py-1.5 text-right tabular-nums font-mono text-fidra-slate dark:text-fidra-cream/50">
                          {'£'}{(item.quantity * item.unitPrice).toFixed(2)}
                        </td>
                        {!isPaid && (
                          <td className="px-1 py-1.5">
                            <button
                              type="button"
                              className="w-7 h-7 flex items-center justify-center text-fidra-slate/30 dark:text-fidra-cream/20 group-hover:text-fidra-slate/60 dark:group-hover:text-fidra-cream/40 hover:!text-fidra-negative hover:!bg-fidra-negative/10 rounded transition-fidra disabled:opacity-30"
                              onClick={() => removeLineItem(i)}
                              disabled={lineItems.length <= 1}
                              title="Remove line item"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Total row inside the table border */}
                <div className="border-t-[1.5px] border-border-emphasis px-4 py-3 flex justify-between items-baseline">
                  <div>
                    {!isPaid && (
                      <button
                        type="button"
                        className="text-xs text-fidra-teal hover:text-fidra-teal/80 font-medium flex items-center gap-1 transition-fidra"
                        onClick={addLineItem}
                      >
                        <Plus className="h-3 w-3" />
                        Add line item
                      </button>
                    )}
                  </div>
                  <div className="flex items-baseline gap-4">
                    <span className="font-body font-medium text-sm text-foreground">Total</span>
                    <span className="font-mono font-bold text-lg tabular-nums text-foreground">
                      {'£'}{subtotal.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* === Payment & Notes === */}
            <section className="mb-6">
              <p className="text-xs font-display font-medium uppercase tracking-[0.06em] text-fidra-slate dark:text-fidra-cream/50 mb-3">
                Payment & Notes
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-fidra-teal" title="Persisted across sessions" />
                    <Label className="text-xs text-fidra-slate dark:text-fidra-cream/50">Bank Details</Label>
                  </div>
                  <textarea
                    className={`${INSET_TEXTAREA} font-mono text-xs min-h-[120px]`}
                    rows={4}
                    placeholder={"Sort code: 00-00-00\nAccount: 12345678\nName: Club Name"}
                    value={bankDetails}
                    onChange={(e) => setBankDetails(e.target.value)}
                    disabled={isPaid}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-fidra-teal" title="Persisted across sessions" />
                    <Label className="text-xs text-fidra-slate dark:text-fidra-cream/50">Notes / Terms</Label>
                  </div>
                  <textarea
                    className={`${INSET_TEXTAREA} min-h-[120px]`}
                    rows={4}
                    placeholder="Payment due within 30 days..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={isPaid}
                  />
                </div>
              </div>
            </section>

            {/* === Actions === */}
            <div className="flex items-center justify-between pt-4">
              <p className="text-xs text-muted-foreground">
                {isPaid
                  ? 'Re-generate this paid invoice as PDF'
                  : selectedInvoiceId
                    ? 'Re-generate this invoice PDF'
                    : 'Generates a professional A4 PDF invoice'}
              </p>
              <div className="flex items-center gap-2">
                {isPaid && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={handleDuplicate}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Duplicate
                  </Button>
                )}
                {selectedInvoiceId && !isPaid && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={async () => {
                      // Fetch linked template defaults if applicable
                      if (selectedInvoice?.planned_template_id) {
                        try {
                          const templates = await window.api.getPlannedTemplates();
                          const tmpl = templates.find((t) => t.id === selectedInvoice.planned_template_id);
                          if (tmpl) {
                            setTemplateDefaults({
                              sheet: tmpl.target_sheet,
                              category: tmpl.category ?? undefined,
                              activity: tmpl.activity ?? undefined,
                            });
                          } else {
                            setTemplateDefaults(undefined);
                          }
                        } catch {
                          setTemplateDefaults(undefined);
                        }
                      } else {
                        setTemplateDefaults(undefined);
                      }
                      setMarkAsPaidOpen(true);
                    }}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Mark as Paid
                  </Button>
                )}
                <Button
                  onClick={handleGenerateInvoice}
                  className="gap-2 px-6 py-2.5 bg-fidra-teal text-fidra-navy hover:bg-fidra-teal/90 hover:shadow-[0_2px_8px_rgba(137,176,174,0.25)] font-display font-semibold text-sm"
                >
                  <FileDown className="h-4 w-4" />
                  Generate Invoice PDF
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mark as Paid dialog */}
      {selectedInvoice && (
        <MarkAsPaidDialog
          open={markAsPaidOpen}
          onOpenChange={setMarkAsPaidOpen}
          invoice={selectedInvoice}
          sheets={sheetNames}
          currentSheet={currentSheet}
          incomeCategories={incomeCategories}
          activitySuggestions={activitySuggestions}
          templateDefaults={templateDefaults}
          onConfirm={handleMarkAsPaid}
        />
      )}
    </div>
  );
}
