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
import { renderInvoiceHTML } from '@/services/invoice-html';
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

/** Backward-compatible line_items JSON format */
interface LineItemsWrapper {
  items: InvoiceLineItem[];
  taxRate: number;
  accentMode?: AccentMode;
}

function parseLineItems(json: string): { items: InvoiceLineItem[]; taxRate: number; accentMode?: AccentMode } {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      // Legacy format: raw array
      return { items: parsed.length > 0 ? parsed : [{ description: '', quantity: 1, unitPrice: 0 }], taxRate: 0 };
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
      // New format: { items, taxRate, accentMode? }
      const wrapper = parsed as LineItemsWrapper;
      return {
        items: wrapper.items.length > 0 ? wrapper.items : [{ description: '', quantity: 1, unitPrice: 0 }],
        taxRate: wrapper.taxRate ?? 0,
        accentMode: wrapper.accentMode,
      };
    }
  } catch { /* fall through */ }
  return { items: [{ description: '', quantity: 1, unitPrice: 0 }], taxRate: 0 };
}

// --- Accent color types ---
type AccentMode = 'fidra' | 'black' | 'logo';
const ACCENT_FIDRA = '#89b0ae';
const ACCENT_BLACK = '#313e50';

/**
 * Extract the dominant non-white/non-black color from an image via canvas sampling.
 * Returns a hex string or null if extraction fails.
 */
function extractDominantColor(dataUri: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const size = 64; // sample at small size for speed
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        // Count colors, ignoring near-white, near-black, and transparent pixels
        const colorCounts = new Map<string, number>();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 128) continue; // skip transparent
          const luma = 0.299 * r + 0.587 * g + 0.114 * b;
          if (luma > 230 || luma < 25) continue; // skip near-white/near-black
          // Quantize to reduce noise (bucket into 8-value steps)
          const qr = (r >> 3) << 3, qg = (g >> 3) << 3, qb = (b >> 3) << 3;
          const key = `${qr},${qg},${qb}`;
          colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
        }

        if (colorCounts.size === 0) { resolve(null); return; }

        // Find the most common color
        let maxCount = 0;
        let dominant = '';
        for (const [key, count] of colorCounts) {
          if (count > maxCount) { maxCount = count; dominant = key; }
        }

        const [r, g, b] = dominant.split(',').map(Number);
        const hex = `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
        resolve(hex);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUri;
  });
}

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
  const [taxRate, setTaxRate] = useState(0);
  const [notes, setNotes] = useState('');
  const [bankDetails, setBankDetails] = useState('');
  const [plannedTemplateId, setPlannedTemplateId] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [hoveredInvoiceId, setHoveredInvoiceId] = useState<string | null>(null);
  const [logoPath, setLogoPath] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [builderActive, setBuilderActive] = useState(false);

  // --- Accent color ---
  const [accentMode, setAccentMode] = useState<AccentMode>('fidra');
  const [logoColor, setLogoColor] = useState<string | null>(null);
  const [logoDataUri, setLogoDataUri] = useState<string | undefined>(undefined);

  const resolvedAccent = useMemo(() => {
    switch (accentMode) {
      case 'black': return ACCENT_BLACK;
      case 'logo': return logoColor || ACCENT_FIDRA;
      default: return ACCENT_FIDRA;
    }
  }, [accentMode, logoColor]);

  // Load logo data URI + extract color when logoPath changes
  // Falls back to synced logoData if the local file doesn't exist (e.g. synced from another machine)
  useEffect(() => {
    if (!logoPath) {
      setLogoDataUri(undefined);
      setLogoColor(null);
      if (accentMode === 'logo') setAccentMode('fidra');
      return;
    }
    let cancelled = false;
    window.api.readFileBase64(logoPath).then(async (uri) => {
      if (cancelled) return;
      setLogoDataUri(uri);
      const color = await extractDominantColor(uri);
      if (!cancelled) setLogoColor(color);
    }).catch(async () => {
      if (cancelled) return;
      // File doesn't exist locally — try synced logoData
      const defaults = await window.api.getInvoiceDefaults();
      if (cancelled) return;
      if (defaults.logoData) {
        setLogoDataUri(defaults.logoData);
        const color = await extractDominantColor(defaults.logoData);
        if (!cancelled) setLogoColor(color);
      } else {
        setLogoDataUri(undefined);
        setLogoColor(null);
      }
    });
    return () => { cancelled = true; };
  }, [logoPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Counter JSON stored in SQLite — kept in a ref so invoice number generation
  // can read/write it synchronously while persistence happens via IPC.
  const counterRef = useRef('');

  // Hydrate persisted defaults from SQLite settings
  useEffect(() => {
    window.api.getInvoiceDefaults().then(async (defaults) => {
      setFromName(defaults.fromName);
      setFromAddress(defaults.fromAddress);
      setNotes(defaults.notes);
      setBankDetails(defaults.bankDetails);
      setLogoPath(defaults.logoPath);
      setAccentMode(defaults.accentMode);
      counterRef.current = defaults.counter;
      // If no local logo file but synced logoData exists, apply it directly
      if (!defaults.logoPath && defaults.logoData) {
        setLogoDataUri(defaults.logoData);
        const color = await extractDominantColor(defaults.logoData);
        setLogoColor(color);
      }
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
        logoData: logoDataUri ?? '',
        counter: counterRef.current,
        accentMode,
      };
      window.api.saveInvoiceDefaults(defaults);
    }, 500);
    return () => clearTimeout(saveTimerRef.current);
  }, [hydrated, fromName, fromAddress, bankDetails, notes, logoPath, logoDataUri, accentMode]);

  // --- Apply prefill from navigation state ---
  useEffect(() => {
    const state = location.state as { invoicePrefill?: InvoicePrefill } | null;
    if (!state?.invoicePrefill) return;
    const prefill = state.invoicePrefill;
    setToName(prefill.toName);
    setLineItems([{ description: prefill.description, quantity: 1, unitPrice: prefill.amount }]);
    setTaxRate(0);
    if (prefill.date) {
      setDueDate(prefill.date);
      setDate(toISODate(new Date()));
    }
    if (prefill.plannedTemplateId) setPlannedTemplateId(prefill.plannedTemplateId);
    setSelectedInvoiceId(null);
    setBuilderActive(true);
    window.history.replaceState({}, '');
    setTimeout(() => toNameRef.current?.focus(), 100);
  }, [location.state]);

  // --- Line items ---
  const subtotal = lineItems.reduce((s, item) => s + item.quantity * item.unitPrice, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const grandTotal = subtotal + taxAmount;

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
    setTaxRate(0);
    setDate(toISODate(new Date()));
    const d = new Date();
    d.setDate(d.getDate() + 30);
    setDueDate(toISODate(d));
    setPlannedTemplateId(null);
    setSelectedInvoiceId(null);
    setInvoiceNumber(peekInvoiceNumber(existingNumbers, counterRef.current));
    setBuilderActive(true);
  }, [existingNumbers]);

  // --- Load invoice into builder ---
  const loadInvoice = useCallback((inv: InvoiceRow) => {
    setBuilderActive(true);
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
    const { items, taxRate: parsedTaxRate, accentMode: invoiceAccent } = parseLineItems(inv.line_items);
    setLineItems(items);
    setTaxRate(parsedTaxRate);
    if (invoiceAccent) setAccentMode(invoiceAccent);
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

  // --- Auto-save existing invoice on edit (debounced) ---
  // Tracks whether the current selectedInvoiceId has been loaded (to skip the
  // initial effect fire right after loadInvoice sets all the fields).
  const autoSaveReadyRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Reset readiness whenever we switch invoices
  useEffect(() => {
    autoSaveReadyRef.current = false;
    // Arm after a tick so the loadInvoice setState batch doesn't trigger a save
    const t = setTimeout(() => { autoSaveReadyRef.current = true; }, 100);
    return () => clearTimeout(t);
  }, [selectedInvoiceId]);

  useEffect(() => {
    if (!selectedInvoiceId || isPaid || !autoSaveReadyRef.current) return;
    const existing = invoices.find((i) => i.id === selectedInvoiceId);
    if (!existing) return;

    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      const invoiceRow: InvoiceRow = {
        id: selectedInvoiceId,
        invoice_number: invoiceNumber,
        date,
        due_date: dueDate,
        from_name: fromName,
        from_address: fromAddress || null,
        to_name: toName,
        to_address: toAddress || null,
        line_items: JSON.stringify({ items: lineItems, taxRate, accentMode } as LineItemsWrapper),
        subtotal: grandTotal.toFixed(2),
        notes: notes.trim() || null,
        bank_details: bankDetails.trim() || null,
        planned_template_id: plannedTemplateId,
        status: existing.status,
        transaction_id: existing.transaction_id,
        paid_at: existing.paid_at,
        planned_template_snapshot: existing.planned_template_snapshot,
        version: existing.version,
        created_at: existing.created_at,
        modified_at: new Date().toISOString(),
        modified_by: null,
      };
      save(invoiceRow);
    }, 800);
    return () => clearTimeout(autoSaveTimerRef.current);
  }, [selectedInvoiceId, isPaid, invoiceNumber, date, dueDate, fromName, fromAddress, toName, toAddress, lineItems, taxRate, grandTotal, notes, bankDetails, plannedTemplateId, invoices, save]);

  // --- Auto-save NEW invoice as draft (debounced) ---
  // Triggers when builderActive with no selectedInvoiceId and toName has content.
  // Once saved, selectedInvoiceId is set and the existing auto-save takes over.
  const newInvoiceTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (selectedInvoiceId || !builderActive || !hydrated || !toName.trim()) {
      clearTimeout(newInvoiceTimerRef.current);
      return;
    }
    clearTimeout(newInvoiceTimerRef.current);
    newInvoiceTimerRef.current = setTimeout(() => {
      // Advance the invoice number counter
      const result = nextInvoiceNumber(existingNumbers, counterRef.current);
      counterRef.current = result.counter;
      setInvoiceNumber(result.invoiceNumber);
      window.api.saveInvoiceDefaults({
        fromName, fromAddress, bankDetails, notes, logoPath,
        logoData: logoDataUri ?? '',
        counter: counterRef.current,
        accentMode,
      });

      const id = crypto.randomUUID();
      const invoiceRow: InvoiceRow = {
        id,
        invoice_number: result.invoiceNumber,
        date,
        due_date: dueDate,
        from_name: fromName,
        from_address: fromAddress || null,
        to_name: toName,
        to_address: toAddress || null,
        line_items: JSON.stringify({ items: lineItems, taxRate, accentMode } as LineItemsWrapper),
        subtotal: grandTotal.toFixed(2),
        notes: notes.trim() || null,
        bank_details: bankDetails.trim() || null,
        planned_template_id: plannedTemplateId,
        status: 'draft',
        transaction_id: null,
        paid_at: null,
        planned_template_snapshot: null,
        version: 1,
        created_at: new Date().toISOString(),
        modified_at: null,
        modified_by: null,
      };
      save(invoiceRow);
      setSelectedInvoiceId(id);
    }, 800);
    return () => clearTimeout(newInvoiceTimerRef.current);
  }, [selectedInvoiceId, builderActive, hydrated, toName, toAddress, date, dueDate, fromName, fromAddress, lineItems, taxRate, grandTotal, notes, bankDetails, plannedTemplateId, existingNumbers, logoPath, save]);

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
    clearTimeout(newInvoiceTimerRef.current);
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
        logoData: logoDataUri ?? '',
        counter: counterRef.current,
        accentMode,
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
        line_items: JSON.stringify({ items: validItems, taxRate, accentMode } as LineItemsWrapper),
        subtotal: grandTotal.toFixed(2),
        notes: notes.trim() || null,
        bank_details: bankDetails.trim() || null,
        planned_template_id: plannedTemplateId,
        status: 'sent',
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
      taxRate,
      accentColor: resolvedAccent,
    });
    await saveInvoicePDF(pdfBytes, finalInvoiceNumber);

    if (!selectedInvoiceId) {
      setInvoiceNumber(peekInvoiceNumber(new Set([...existingNumbers, finalInvoiceNumber]), counterRef.current));
    }
  }, [fromName, fromAddress, toName, toAddress, invoiceNumber, date, dueDate, lineItems, notes, bankDetails, plannedTemplateId, selectedInvoiceId, existingNumbers, invoices, grandTotal, save, isPaid, logoPath, taxRate, resolvedAccent]);

  // --- Mark as paid ---
  const handleMarkAsPaid = useCallback(async (fields: MarkAsPaidFields) => {
    if (!selectedInvoice) return;

    let description = '';
    const { items: parsedItems } = parseLineItems(selectedInvoice.line_items);
    description = parsedItems[0]?.description || selectedInvoice.invoice_number;

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

  // --- Live preview (debounced) ---
  const [previewHtml, setPreviewHtml] = useState('');
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(0.6);

  // Compute preview HTML from current form state, debounced
  const previewData = useMemo(() => ({
    fromName, fromAddress, toName, toAddress,
    invoiceNumber, date, dueDate, lineItems, notes,
    bankDetails, taxRate, resolvedAccent, logoDataUri,
    isOverdue: dueDate < toISODate(new Date()) && !isPaid,
  }), [fromName, fromAddress, toName, toAddress, invoiceNumber, date, dueDate, lineItems, notes, bankDetails, taxRate, isPaid, resolvedAccent, logoDataUri]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const html = renderInvoiceHTML({
        fromName: previewData.fromName,
        fromAddress: previewData.fromAddress,
        toName: previewData.toName,
        toAddress: previewData.toAddress,
        invoiceNumber: previewData.invoiceNumber,
        date: previewData.date,
        dueDate: previewData.dueDate,
        lineItems: previewData.lineItems,
        notes: previewData.notes.trim(),
        bankDetails: previewData.bankDetails.trim(),
        isOverdue: previewData.isOverdue,
        taxRate: previewData.taxRate,
        accentColor: previewData.resolvedAccent,
        logoDataUri: previewData.logoDataUri,
      });
      setPreviewHtml(html);
    }, 300);
    return () => clearTimeout(timer);
  }, [previewData]);

  // Compute scale factor based on available width — center the invoice
  useEffect(() => {
    const container = previewContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const availableWidth = entry.contentRect.width - 48; // 24px padding each side
        const invoiceNaturalWidth = 800; // 680px doc + 120px padding
        const scale = Math.min(1, availableWidth / invoiceNaturalWidth);
        setPreviewScale(Math.max(0.3, scale));
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

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
    if (inv.status === 'sent') {
      return (
        <span className="inline-flex items-center rounded-full border border-fidra-teal/30 bg-fidra-teal/10 text-fidra-teal px-2 py-0.5 text-[10px] font-medium">
          Sent
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

  // --- Accent color toggle button ---
  const AccentButton = ({ mode, label, color }: { mode: AccentMode; label: string; color: string }) => (
    <button
      type="button"
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium transition-fidra border',
        accentMode === mode
          ? 'border-fidra-teal bg-fidra-teal/10 text-foreground'
          : 'border-transparent text-fidra-slate dark:text-fidra-cream/50 hover:bg-fidra-slate/5 dark:hover:bg-fidra-cream/5',
      )}
      onClick={() => setAccentMode(mode)}
    >
      <div className="w-3 h-3 rounded-full border border-border-subtle shrink-0" style={{ backgroundColor: color }} />
      {label}
    </button>
  );

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

        {/* Middle panel: Invoice Form */}
        <div className="w-[440px] shrink-0 overflow-y-auto bg-background border-r border-border-subtle p-5">
          {!builderActive ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <p className="text-sm font-display font-medium text-fidra-slate dark:text-fidra-cream/60">
                  No invoice selected
                </p>
                <button
                  type="button"
                  className="text-sm text-fidra-teal hover:text-fidra-teal/80 font-medium mt-2 transition-fidra"
                  onClick={() => {
                    setBuilderActive(true);
                    setTimeout(() => toNameRef.current?.focus(), 100);
                  }}
                >
                  Start a new invoice
                </button>
              </div>
            </div>
          ) : (
          <div className="bg-[#EEEEE9] dark:bg-[#2A2D32] rounded-xl border border-border-subtle dark:border-[#3a3d42] shadow-sm px-6 py-5">
            {/* Paid banner */}
            {isPaid && selectedInvoice && (
              <div className="mb-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      Invoice Paid
                    </p>
                    <p className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 mt-0.5">
                      {selectedInvoice.paid_at ? formatDate(selectedInvoice.paid_at.split('T')[0]) : 'Unknown date'}
                      {selectedInvoice.transaction_id && ` \u00b7 Txn ${selectedInvoice.transaction_id.slice(0, 8)}\u2026`}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-[11px] h-7 text-emerald-700 dark:text-emerald-300 hover:text-fidra-negative hover:bg-fidra-negative/10"
                  onClick={handleRevertToDraft}
                >
                  <Undo2 className="h-3 w-3" />
                  Revert
                </Button>
              </div>
            )}

            {!selectedInvoiceId && (
              <p className="text-xs text-muted-foreground mb-4">
                Create an invoice PDF. Dotted fields are remembered across sessions.
              </p>
            )}

            {/* === Parties === */}
            <div className="space-y-3 mb-5">
              {/* From card */}
              <div className="rounded-lg border border-border-subtle dark:border-[#3a3d42] bg-surface-inset/50 dark:bg-[#24262a] p-3 space-y-2 focus-within:border-fidra-teal/50 transition-colors">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-fidra-teal" title="Persisted across sessions" />
                  <Label className="text-[10px] uppercase tracking-wider text-fidra-slate dark:text-fidra-cream/50">From</Label>
                </div>
                <input
                  className="w-full h-8 px-2.5 text-sm bg-transparent border-0 focus:outline-none placeholder:text-fidra-slate/40 dark:placeholder:text-fidra-cream/25 disabled:opacity-50 disabled:cursor-not-allowed font-body font-medium"
                  placeholder="Organisation / sender name"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  disabled={isPaid}
                />
                <textarea
                  className="w-full px-2.5 py-1.5 text-xs bg-transparent border-0 focus:outline-none resize-none placeholder:text-fidra-slate/40 dark:placeholder:text-fidra-cream/25 leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
                  rows={2}
                  placeholder={"Address line 1\nCity, Postcode"}
                  value={fromAddress}
                  onChange={(e) => setFromAddress(e.target.value)}
                  disabled={isPaid}
                />
                {/* Logo picker */}
                <div className="flex items-center gap-2 pt-0.5">
                  {logoPath ? (
                    <>
                      <div className="h-6 w-6 rounded border border-border-subtle dark:border-[#3a3d42] bg-background dark:bg-[#222528] flex items-center justify-center overflow-hidden">
                        <Image className="h-3 w-3 text-fidra-slate/40 dark:text-fidra-cream/25" />
                      </div>
                      <span className="text-[10px] text-fidra-slate dark:text-fidra-cream/50 truncate flex-1" title={logoPath}>
                        {logoPath.split('/').pop()}
                      </span>
                      <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px] text-fidra-slate dark:text-fidra-cream/50" onClick={handleChooseLogo} disabled={isPaid}>
                        Change
                      </Button>
                      <button
                        type="button"
                        className="h-5 w-5 flex items-center justify-center text-fidra-slate/50 dark:text-fidra-cream/30 hover:text-fidra-negative rounded transition-fidra"
                        onClick={handleRemoveLogo}
                        disabled={isPaid}
                        title="Remove logo"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </>
                  ) : (
                    <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px] text-fidra-slate dark:text-fidra-cream/50 gap-1" onClick={handleChooseLogo} disabled={isPaid}>
                      <Image className="h-2.5 w-2.5" />
                      Add logo
                    </Button>
                  )}
                </div>
              </div>

              {/* Bill To card */}
              <div className="rounded-lg border border-border-subtle dark:border-[#3a3d42] bg-surface-inset/50 dark:bg-[#24262a] p-3 space-y-2 focus-within:border-fidra-teal/50 transition-colors">
                <Label className="text-[10px] uppercase tracking-wider text-fidra-slate dark:text-fidra-cream/50">Bill To</Label>
                <input
                  ref={toNameRef}
                  className="w-full h-8 px-2.5 text-sm bg-transparent border-0 focus:outline-none placeholder:text-fidra-slate/40 dark:placeholder:text-fidra-cream/25 disabled:opacity-50 disabled:cursor-not-allowed font-body font-medium"
                  placeholder="Recipient name"
                  value={toName}
                  onChange={(e) => setToName(e.target.value)}
                  disabled={isPaid}
                />
                <textarea
                  className="w-full px-2.5 py-1.5 text-xs bg-transparent border-0 focus:outline-none resize-none placeholder:text-fidra-slate/40 dark:placeholder:text-fidra-cream/25 leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
                  rows={2}
                  placeholder={"Address line 1\nCity, Postcode"}
                  value={toAddress}
                  onChange={(e) => setToAddress(e.target.value)}
                  disabled={isPaid}
                />
              </div>
            </div>

            {/* === Invoice Details — stacked for more breathing room === */}
            <div className="space-y-3 mb-5">
              <div>
                <Label className="text-[10px] text-fidra-slate dark:text-fidra-cream/50">Invoice Number</Label>
                <input
                  className={`${INSET_INPUT} mt-1 font-mono tabular-nums`}
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  disabled={isPaid}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <Label className="text-[10px] text-fidra-slate dark:text-fidra-cream/50">Date</Label>
                  <input
                    type="date"
                    className={`${INSET_INPUT} mt-1`}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    disabled={isPaid}
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-[10px] text-fidra-slate dark:text-fidra-cream/50">Due Date</Label>
                  <input
                    type="date"
                    className={`${INSET_INPUT} mt-1`}
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    disabled={isPaid}
                  />
                </div>
              </div>
            </div>

            {/* === Line Items === */}
            <section className="mb-5">
              <p className="text-[10px] font-display font-medium uppercase tracking-[0.06em] text-fidra-slate dark:text-fidra-cream/50 mb-2">
                Line Items
              </p>
              <div className="rounded-lg border border-border-subtle dark:border-[#3a3d42] overflow-hidden shadow-xs">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-raised dark:bg-[#32363B]">
                      <th className="text-left px-3 py-2 font-display text-[10px] font-semibold uppercase tracking-wider text-fidra-slate dark:text-fidra-cream/50">
                        Description
                      </th>
                      <th className="text-center px-2 py-2 font-display text-[10px] font-semibold uppercase tracking-wider text-fidra-slate dark:text-fidra-cream/50 w-[50px]">
                        Qty
                      </th>
                      <th className="text-right px-2 py-2 font-display text-[10px] font-semibold uppercase tracking-wider text-fidra-slate dark:text-fidra-cream/50 w-[80px]">
                        Price
                      </th>
                      <th className="text-right px-3 py-2 font-display text-[10px] font-semibold uppercase tracking-wider text-fidra-slate dark:text-fidra-cream/50 w-[80px]">
                        Total
                      </th>
                      {!isPaid && <th className="w-[28px]" />}
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item, i) => (
                      <tr
                        key={i}
                        className="group border-t border-border-subtle/50 hover:bg-fidra-teal/3 transition-colors"
                      >
                        <td className="px-2 py-0.5">
                          <input
                            className={`${CELL_INPUT} text-xs h-8`}
                            placeholder="Item description"
                            value={item.description}
                            onChange={(e) => updateLineItem(i, 'description', e.target.value)}
                            disabled={isPaid}
                          />
                        </td>
                        <td className="px-1 py-0.5">
                          <input
                            type="number"
                            min={1}
                            className={`${CELL_INPUT} text-center tabular-nums text-xs h-8`}
                            value={item.quantity}
                            onChange={(e) =>
                              updateLineItem(i, 'quantity', Math.max(1, parseInt(e.target.value) || 1))
                            }
                            disabled={isPaid}
                          />
                        </td>
                        <td className="px-1 py-0.5">
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            className={`${CELL_INPUT} text-right font-mono tabular-nums text-xs h-8`}
                            value={item.unitPrice || ''}
                            onChange={(e) =>
                              updateLineItem(i, 'unitPrice', Math.max(0, parseFloat(e.target.value) || 0))
                            }
                            disabled={isPaid}
                          />
                        </td>
                        <td className="px-3 py-1 text-right tabular-nums font-mono text-fidra-slate dark:text-fidra-cream/50 text-xs">
                          {'\u00a3'}{(item.quantity * item.unitPrice).toFixed(2)}
                        </td>
                        {!isPaid && (
                          <td className="px-0.5 py-1">
                            <button
                              type="button"
                              className="w-6 h-6 flex items-center justify-center text-fidra-slate/30 dark:text-fidra-cream/20 group-hover:text-fidra-slate/60 dark:group-hover:text-fidra-cream/40 hover:!text-fidra-negative hover:!bg-fidra-negative/10 rounded transition-fidra disabled:opacity-30"
                              onClick={() => removeLineItem(i)}
                              disabled={lineItems.length <= 1}
                              title="Remove line item"
                            >
                              <Trash2 className="h-2.5 w-2.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Totals area */}
                <div className="border-t-[1.5px] border-border-emphasis px-3 py-2.5">
                  <div className="flex justify-between items-center mb-2">
                    <div>
                      {!isPaid && (
                        <button
                          type="button"
                          className="text-[11px] text-fidra-teal hover:text-fidra-teal/80 font-medium flex items-center gap-1 transition-fidra"
                          onClick={addLineItem}
                        >
                          <Plus className="h-2.5 w-2.5" />
                          Add line item
                        </button>
                      )}
                    </div>
                    {/* Tax rate input */}
                    <div className="flex items-center gap-2">
                      <Label className="text-[10px] text-fidra-slate dark:text-fidra-cream/50 whitespace-nowrap">Tax %</Label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        className={`${INSET_INPUT} w-[60px] h-7 text-xs text-right font-mono tabular-nums px-2`}
                        value={taxRate || ''}
                        onChange={(e) => setTaxRate(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                        placeholder="0"
                        disabled={isPaid}
                      />
                    </div>
                  </div>
                  {/* Totals breakdown */}
                  <div className="flex flex-col items-end gap-1">
                    {taxRate > 0 && (
                      <>
                        <div className="flex items-baseline gap-3 text-xs">
                          <span className="text-fidra-slate dark:text-fidra-cream/50">Subtotal</span>
                          <span className="font-mono tabular-nums text-foreground">{'\u00a3'}{subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex items-baseline gap-3 text-xs">
                          <span className="text-fidra-slate dark:text-fidra-cream/50">Tax ({taxRate}%)</span>
                          <span className="font-mono tabular-nums text-foreground">{'\u00a3'}{taxAmount.toFixed(2)}</span>
                        </div>
                      </>
                    )}
                    <div className="flex items-baseline gap-3">
                      <span className="font-body font-medium text-sm text-foreground">Total</span>
                      <span className="font-mono font-bold text-base tabular-nums text-foreground">
                        {'\u00a3'}{grandTotal.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* === Payment & Notes === */}
            <section className="mb-5">
              <p className="text-[10px] font-display font-medium uppercase tracking-[0.06em] text-fidra-slate dark:text-fidra-cream/50 mb-2">
                Payment & Notes
              </p>
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-fidra-teal" title="Persisted across sessions" />
                    <Label className="text-[10px] text-fidra-slate dark:text-fidra-cream/50">Bank Details</Label>
                  </div>
                  <textarea
                    className={`${INSET_TEXTAREA} font-mono text-[11px] min-h-[80px]`}
                    rows={3}
                    placeholder={"Sort code: 00-00-00\nAccount: 12345678"}
                    value={bankDetails}
                    onChange={(e) => setBankDetails(e.target.value)}
                    disabled={isPaid}
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-fidra-teal" title="Persisted across sessions" />
                    <Label className="text-[10px] text-fidra-slate dark:text-fidra-cream/50">Notes / Terms</Label>
                  </div>
                  <textarea
                    className={`${INSET_TEXTAREA} min-h-[80px] text-xs`}
                    rows={3}
                    placeholder="Payment due within 30 days..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={isPaid}
                  />
                </div>
              </div>
            </section>

            {/* === Accent colour === */}
            <section className="mb-5">
              <p className="text-[10px] font-display font-medium uppercase tracking-[0.06em] text-fidra-slate dark:text-fidra-cream/50 mb-2">
                Accent Colour
              </p>
              <div className="flex items-center gap-1">
                <AccentButton mode="fidra" label="Fidra" color={ACCENT_FIDRA} />
                <AccentButton mode="black" label="Black" color={ACCENT_BLACK} />
                {logoColor && (
                  <AccentButton mode="logo" label="Logo" color={logoColor} />
                )}
              </div>
            </section>

            {/* === Actions === */}
            <div className="flex flex-col gap-2 pt-3">
              <Button
                onClick={handleGenerateInvoice}
                className="w-full gap-2 py-2.5 bg-fidra-teal text-fidra-navy hover:bg-fidra-teal/90 hover:shadow-[0_2px_8px_rgba(137,176,174,0.25)] font-display font-semibold text-sm"
              >
                <FileDown className="h-4 w-4" />
                Generate Invoice PDF
              </Button>
              <div className="flex items-center gap-2">
                {isPaid && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5 text-xs"
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
                    className="flex-1 gap-1.5 text-xs"
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
              </div>
              <p className="text-[10px] text-muted-foreground text-center">
                {isPaid
                  ? 'Re-generate this paid invoice as PDF'
                  : selectedInvoiceId
                    ? 'Re-generate this invoice PDF'
                    : 'Generates a professional A4 PDF invoice'}
              </p>
            </div>
          </div>
          )}
        </div>

        {/* Right panel: Live Preview */}
        <div
          ref={previewContainerRef}
          className="flex-1 overflow-y-auto bg-[#EEEEE9] dark:bg-[#2A2D32] p-6"
        >
          {!builderActive ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm text-fidra-slate/60 dark:text-fidra-cream/35">
                Preview will appear here
              </p>
            </div>
          ) : (
          <div
            className="mx-auto"
            style={{
              width: 800 * previewScale,
              height: 1130 * previewScale,
            }}
          >
            <div
              style={{
                width: 800,
                transform: `scale(${previewScale})`,
                transformOrigin: 'top left',
              }}
            >
              {previewHtml && (
                <iframe
                  srcDoc={previewHtml}
                  className="w-[800px] border-0 bg-white rounded-lg shadow-sm"
                  style={{ height: 1130, pointerEvents: 'none' }}
                  tabIndex={-1}
                  title="Invoice preview"
                />
              )}
            </div>
          </div>
          )}
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
