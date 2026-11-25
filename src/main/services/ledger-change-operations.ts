import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { WindowContext } from '../window/window-context';
import type { InvoiceRow, PlannedTemplateRow, TransactionRow } from '../../shared/ipc-types';
import type { LedgerChangeRequest } from '../../shared/ledger-change-types';
import { defaultStatusForType, resolveStatus } from '../../shared/transaction-rules';
import { parsePence, penceToAmount, toAmount } from '../../shared/money';
import { expandTemplate } from '../../shared/forecast';
import { assertAiOperationAccess, aiPermittedAccounts, type AiOperationAccess } from './ai-operation-access';
import { transactionsBulkSave, transactionsSaveTransfer } from './transaction-operations';
import { plannedSave } from './planned-operations';
import { invoicesSave, invoicesMarkPaid, invoicesRevertToDraft } from './invoice-operations';
import { categoriesSetAll } from './category-operations';
import { activitiesApplyChange } from './activity-operations';
import { activityNotesSave, activityNotesDelete } from './activity-note-operations';
import * as settings from './settings-operations';

/** Execute only named DB-only application operations. This is also used inside a
 * rolled-back savepoint to preview their exact linked effects. No files, global
 * preferences, passwords or caller-selected storage keys are accepted here. */
export function executeLedgerChanges(ctx: WindowContext, access: AiOperationAccess, input: LedgerChangeRequest, actor: string, seed: string, now: string) {
  const accounts = aiPermittedAccounts(ctx, access);
  const requiredCapabilities = new Set<Parameters<typeof assertAiOperationAccess>[2]>();
  const capability = (name: Parameters<typeof assertAiOperationAccess>[2]) => { assertAiOperationAccess(ctx, access, name); requiredCapabilities.add(name); };
  const requireFields = (value: object, editing = false) => {
    for (const field of ['description', 'party', 'category', 'activity', 'notes', 'reference'] as const) {
      if (field in value && (editing || value[field as keyof typeof value] != null) && !access.policy.fields.includes(field)) throw new Error(`This connection does not permit the ${field} field.`);
    }
  };
  const sheet = (id: string) => {
    const found = accounts.find((row) => row.id === id);
    if (!found) throw new Error('An affected account is missing or outside this connection.');
    return found.name;
  };
  const accountName = (name: string) => {
    if (!accounts.some((row) => row.name === name)) throw new Error('An affected account is outside this connection.');
  };
  const used = new Set<string>();
  const select = (kind: string, id: string) => {
    const key = `${kind}:${id}`;
    if (used.has(key)) throw new Error('Select each record only once in a batch.');
    used.add(key);
    if (used.size > 1000) throw new Error('A batch may affect at most 1,000 existing records.');
  };
  const transaction = (id: string, version: number, allowTransfer = false) => {
    capability('transactions.read'); capability('transactions.manage'); select('transaction', id);
    const row = ctx.transactionRepo.getById(id);
    if (!row || row.version !== version) throw new Error('A transaction changed. Read fresh records and prepare a new batch.');
    accountName(row.sheet);
    if (row.status === 'planned') throw new Error('Use the planned-payment operation for a planned instance.');
    if (row.linked_id && !allowTransfer) throw new Error('Use edit_transfer to change both sides of a linked transfer.');
    return row;
  };
  const template = (id: string, version: number) => {
    capability('planned.read'); capability('planned.manage'); select('planned', id);
    const row = ctx.plannedRepo.getById(id);
    if (!row || row.version !== version) throw new Error('A planned payment changed. Read fresh records and prepare a new batch.');
    accountName(row.target_sheet);
    if (row.transfer_target_sheet) { accountName(row.transfer_target_sheet); capability('transfers.manage'); }
    return row;
  };
  const linkedInvoices = (row: PlannedTemplateRow) => {
    const invoices = ctx.invoiceRepo.getByPlannedTemplateId(row.id);
    if (invoices.length) { capability('invoices.read'); capability('invoices.manage'); }
    return invoices;
  };
  const actualLinks = (row: TransactionRow) => {
    const invoices = ctx.invoiceRepo.getAll().filter((invoice) => invoice.transaction_id === row.id);
    if (invoices.length) throw new Error('This actual is linked to an invoice. Use its native invoice payment workflow to preserve the receipt.');
  };
  const invoice = (id: string, version: number) => {
    capability('invoices.read'); capability('invoices.manage'); select('invoice', id);
    const row = ctx.invoiceRepo.getById(id);
    if (!row || row.version !== version) throw new Error('An invoice changed. Read fresh records and prepare a new batch.');
    if (row.status === 'paid' || row.transaction_id) throw new Error('Use the native invoice payment workflow for a paid invoice.');
    return row;
  };
  const saveActual = (row: TransactionRow) => transactionsBulkSave(ctx, [row]);
  const fresh = (id: string, date: string, type: 'income' | 'expense', amount: string, sheet: string, description: string): TransactionRow => ({
    id, date, type, amount, sheet, description, status: defaultStatusForType(type), category: null, party: null, reference: null,
    activity: null, notes: null, linked_id: null, version: 1, created_at: now, modified_at: null, modified_by: actor,
  });
  const validSchedule = (row: PlannedTemplateRow) => {
    if (row.end_date && row.end_date < row.start_date) throw new Error('A schedule cannot end before it starts.');
    if (row.end_date && row.occurrence_count !== null) throw new Error('Use either an end date or an occurrence count.');
    if (row.transfer_target_sheet === row.target_sheet) throw new Error('A planned transfer needs two different accounts.');
    if (row.transfer_target_sheet && row.type !== 'expense') throw new Error('A planned transfer starts with an expense from its source account.');
  };
  const expectValue = (current: unknown, expected: unknown) => {
    if (!isDeepStrictEqual(current, expected)) throw new Error('The current value changed. Read it again before preparing changes.');
  };
  for (const [index, action] of input.actions.entries()) {
    const id = (part = 'row') => createHash('sha256').update(`${seed}:${index}:${part}`).digest('hex');
    if (action.kind === 'create_transaction') {
      capability('transactions.manage'); requireFields(action.value);
      const { sheetId, ...value } = action.value;
      saveActual({ ...fresh(id(), value.date, value.type, value.amount, sheet(sheetId), value.description), ...value });
    } else if (action.kind === 'edit_transaction' || action.kind === 'set_transaction_status') {
      const row = transaction(action.id, action.version); actualLinks(row);
      const changes = action.kind === 'edit_transaction' ? action.changes : { status: action.status };
      requireFields(changes, true);
      const { sheetId, ...values } = changes as typeof changes & { sheetId?: string };
      const updated = { ...row, ...values, sheet: sheetId ? sheet(sheetId) : row.sheet, version: row.version + 1, modified_at: now, modified_by: actor };
      updated.status = resolveStatus(updated.type, updated.status);
      if (action.kind === 'set_transaction_status' && action.status === 'approved' && row.status !== 'approved' && settings.settingsGetTransactionSettings(ctx).dateOnApprove) updated.date = now.slice(0, 10);
      saveActual(updated);
    } else if (action.kind === 'split_transaction') {
      const row = transaction(action.id, action.version); actualLinks(row);
      if (action.parts.reduce((total, part) => total + (parsePence(part.amount) ?? 0), 0) !== parsePence(row.amount)) throw new Error('Split parts must total the original amount exactly.');
      const rows = action.parts.map((part, partIndex) => {
        requireFields(part, true);
        return { ...row, ...part, id: partIndex === 0 ? row.id : id(`part:${partIndex}`), version: partIndex === 0 ? row.version + 1 : 1,
          created_at: partIndex === 0 ? row.created_at : now, modified_at: now, modified_by: actor };
      });
      // Preserve the first entry ID, attachments and bank evidence. References and
      // notes on every part are explicit user data, never fabricated bank IDs.
      transactionsBulkSave(ctx, rows);
    } else if (action.kind === 'create_planned' || action.kind === 'edit_planned') {
      capability('planned.manage');
      const previous = action.kind === 'edit_planned' ? template(action.id, action.version) : null;
      const value = action.kind === 'create_planned' ? action.value : action.changes;
      requireFields(value, !!previous);
      if (previous) {
        const linked = linkedInvoices(previous);
        if (linked.some((item) => item.status === 'paid')) throw new Error('This plan has a paid invoice. Review its schedule in native Fidra.');
        if (linked.length && ['type', 'sheetId', 'transferSheetId'].some((key) => key in value)) throw new Error('Change the invoice-linked plan account or direction through its native workflow.');
      }
      const base: PlannedTemplateRow = previous ?? { id: id(), start_date: now.slice(0, 10), description: '', amount: '0.00', type: 'expense', frequency: 'once', target_sheet: '',
        category: null, party: null, activity: null, notes: null, end_date: null, occurrence_count: null, skipped_dates: '[]', fulfilled_dates: '[]', transfer_target_sheet: null, version: 0, created_at: now };
      const { startDate, sheetId, transferSheetId, endDate, occurrenceCount, ...values } = value;
      const updated = { ...base, ...values, start_date: startDate ?? base.start_date, target_sheet: sheetId ? sheet(sheetId) : base.target_sheet,
        transfer_target_sheet: transferSheetId === undefined ? base.transfer_target_sheet : transferSheetId === null ? null : sheet(transferSheetId),
        end_date: endDate === undefined ? base.end_date : endDate, occurrence_count: occurrenceCount === undefined ? base.occurrence_count : occurrenceCount,
        version: base.version + 1 };
      if (updated.transfer_target_sheet) capability('transfers.manage');
      validSchedule(updated); plannedSave(ctx, updated);
    } else if (action.kind === 'planned_occurrence' || action.kind === 'edit_planned_occurrence') {
      const row = template(action.id, action.version);
      const skipped = new Set<string>(JSON.parse(row.skipped_dates)); const fulfilled = new Set<string>(JSON.parse(row.fulfilled_dates));
      if (fulfilled.has(action.date)) throw new Error('This occurrence has already been fulfilled.');
      const candidate = { ...row, skipped_dates: JSON.stringify([...skipped].filter((date) => date !== action.date)) };
      if (Date.parse(action.date) - Date.parse(row.start_date) > 366 * 200 * 86400000
        || !expandTemplate(candidate, action.date, true).some((item) => item.instanceDate === action.date)) throw new Error('Choose an exact occurrence of this schedule.');
      const linked = linkedInvoices(row);
      if (action.kind === 'edit_planned_occurrence') {
        if (skipped.has(action.date)) throw new Error('Restore this occurrence before editing it.');
        if (linked.length) throw new Error('Edit an invoice-linked occurrence through its native planned-payment workflow.');
        requireFields(action.changes, true);
        const { date, sheetId, transferSheetId, ...values } = action.changes;
        const replacement: PlannedTemplateRow = { ...row, ...values, id: row.frequency === 'once' ? row.id : id(), start_date: date ?? action.date,
          target_sheet: sheetId ? sheet(sheetId) : row.target_sheet,
          transfer_target_sheet: transferSheetId === undefined ? row.transfer_target_sheet : transferSheetId === null ? null : sheet(transferSheetId),
          frequency: 'once', end_date: null, occurrence_count: null, skipped_dates: '[]', fulfilled_dates: '[]',
          version: row.frequency === 'once' ? row.version + 1 : 1, created_at: row.frequency === 'once' ? row.created_at : now };
        if (replacement.transfer_target_sheet) capability('transfers.manage');
        validSchedule(replacement);
        if (row.frequency !== 'once') {
          skipped.add(action.date);
          // Native recurrence counts non-skipped instances. A replacement must
          // consume one slot, otherwise skip + one-off would add an extra payment.
          const remaining = row.occurrence_count === null ? null : row.occurrence_count - 1;
          const updated = { ...row, skipped_dates: JSON.stringify([...skipped].sort()), version: row.version + 1,
            occurrence_count: remaining === 0 ? null : remaining, end_date: remaining === 0 ? action.date : row.end_date };
          validSchedule(updated); plannedSave(ctx, updated);
        }
        plannedSave(ctx, replacement);
        continue;
      }
      if (action.operation === 'restore') {
        if (!skipped.delete(action.date)) throw new Error('This occurrence is not skipped.');
      } else if (action.operation === 'skip') {
        if (skipped.has(action.date)) throw new Error('This occurrence is already skipped.');
        skipped.add(action.date);
      } else {
        capability('transactions.manage');
        if (skipped.has(action.date)) throw new Error('Restore the skipped occurrence before fulfilling it.');
        const date = action.actualDate ?? (settings.settingsGetTransactionSettings(ctx).dateOnPlannedConversion ? now.slice(0, 10) : action.date);
        const actual = { ...fresh(id(), date, row.type, row.amount, row.target_sheet, row.description), category: row.category, party: row.party, activity: row.activity, notes: row.notes };
        if (row.transfer_target_sheet) {
          if (linked.length) throw new Error('Invoice-linked planned transfers require their native workflow.');
          transactionsSaveTransfer(ctx, { ...actual, type: 'expense', status: 'approved', linked_id: id('link') },
            { ...actual, id: id('income'), type: 'income', status: '--', sheet: row.transfer_target_sheet, linked_id: id('link') });
        } else {
          if (linked.filter((item) => item.status !== 'paid').length > 1 || linked.some((item) => item.status === 'paid')) throw new Error('This plan has competing or paid invoice receipts. Review the exact payment in native Fidra.');
          if (linked[0] && (row.type !== 'income' || parsePence(linked[0].subtotal) !== parsePence(row.amount))) throw new Error('The invoice total differs from this planned receipt. Review the payment amount in native Fidra.');
          saveActual(actual);
          if (linked[0]) invoicesMarkPaid(ctx, linked[0].id, actual.id);
        }
        fulfilled.add(action.date);
      }
      // Keep an exact fulfilment record even for ONCE schedules. This prevents
      // duplicate delivery and preserves linked invoice references for Undo.
      plannedSave(ctx, { ...row, skipped_dates: JSON.stringify([...skipped].sort()), fulfilled_dates: JSON.stringify([...fulfilled].sort()), version: row.version + 1 });
    } else if (action.kind === 'create_transfer' || action.kind === 'edit_transfer') {
      capability('transfers.manage'); capability('transactions.manage');
      let expense: TransactionRow; let income: TransactionRow;
      if (action.kind === 'edit_transfer') {
        expense = transaction(action.expenseId, action.expenseVersion, true); income = transaction(action.incomeId, action.incomeVersion, true);
        actualLinks(expense); actualLinks(income);
        if (!expense.linked_id || expense.linked_id !== income.linked_id || expense.type !== 'expense' || income.type !== 'income'
          || ctx.transactionRepo.getByLinkedId(expense.linked_id).length !== 2) throw new Error('Select both exact sides of one linked transfer.');
        // The paired DB operation below never moves attachment files during the
        // preview. Financial edits remain available for ordinary attached actuals.
        if (ctx.attachmentRepo.getForTransaction(expense.id).length || ctx.attachmentRepo.getForTransaction(income.id).length) throw new Error('Edit an attached transfer through its native workflow.');
        const { fromSheetId, toSheetId, ...values } = action.changes;
        requireFields(values, true);
        expense = { ...expense, ...values, sheet: fromSheetId ? sheet(fromSheetId) : expense.sheet, version: expense.version + 1, modified_at: now, modified_by: actor };
        income = { ...income, ...values, sheet: toSheetId ? sheet(toSheetId) : income.sheet, version: income.version + 1, modified_at: now, modified_by: actor };
      } else {
        requireFields(action);
        expense = { ...fresh(id(), action.date, 'expense', action.amount, sheet(action.fromSheetId), action.description), reference: action.reference, notes: action.notes, linked_id: id('link') };
        income = { ...expense, id: id('income'), type: 'income', status: '--', sheet: sheet(action.toSheetId) };
      }
      transactionsSaveTransfer(ctx, expense, income);
    } else if (action.kind === 'create_invoice' || action.kind === 'edit_invoice') {
      capability('invoices.manage');
      const previous = action.kind === 'edit_invoice' ? invoice(action.id, action.version) : null;
      const value = action.kind === 'create_invoice' ? action.value : action.changes;
      if (['fromName', 'fromAddress', 'toName', 'toAddress', 'bankDetails'].some((key) => key in value) && !access.policy.fields.includes('party')) throw new Error('Billing edits require party-field permission.');
      if ('items' in value && !access.policy.fields.includes('description')) throw new Error('Invoice items require description-field permission.');
      if ('notes' in value && !access.policy.fields.includes('notes')) throw new Error('Invoice notes require notes-field permission.');
      if (previous?.planned_template_id && ['items', 'date', 'dueDate'].some((key) => key in value)) throw new Error('Edit linked invoice amounts and dates through its planned payment.');
      const existingItems: { items: { description: string; quantity: number; unitPrice: number }[]; taxRate?: number; accentMode?: string } | null = previous ? (() => {
        const parsed: unknown = JSON.parse(previous.line_items);
        return Array.isArray(parsed) ? { items: parsed, taxRate: 0, accentMode: 'fidra' } : parsed as { items: { description: string; quantity: number; unitPrice: number }[]; taxRate?: number; accentMode?: string };
      })() : null;
      const items = value.items?.map((item) => ({ ...item, unitPrice: toAmount(item.unitPrice) })) ?? existingItems?.items ?? [];
      const taxRate = value.taxRate ?? existingItems?.taxRate ?? 0;
      let subtotal = 0;
      for (const item of items) {
        const pence = parsePence(item.unitPrice);
        if (pence === null || !Number.isSafeInteger(item.quantity) || item.quantity < 1) throw new Error('The existing invoice items need native review.');
        subtotal += pence * item.quantity;
      }
      const total = Math.round(subtotal * (1 + taxRate / 100));
      if (!Number.isSafeInteger(total)) throw new Error('The invoice total is too large.');
      const number = value.invoiceNumber ?? previous?.invoice_number ?? '';
      if (ctx.invoiceRepo.getAll().some((row) => row.id !== previous?.id && row.invoice_number.toLowerCase() === number.toLowerCase())) throw new Error('That invoice number already exists.');
      const row: InvoiceRow = { id: previous?.id ?? id(), invoice_number: number, date: value.date ?? previous?.date ?? now.slice(0, 10), due_date: value.dueDate ?? previous?.due_date ?? now.slice(0, 10),
        from_name: value.fromName ?? previous?.from_name ?? '', from_address: value.fromAddress === undefined ? previous?.from_address ?? null : value.fromAddress,
        to_name: value.toName ?? previous?.to_name ?? '', to_address: value.toAddress === undefined ? previous?.to_address ?? null : value.toAddress,
        line_items: JSON.stringify({ items, taxRate, accentMode: value.accentMode ?? existingItems?.accentMode ?? 'fidra' }), subtotal: penceToAmount(total),
        notes: value.notes === undefined ? previous?.notes ?? null : value.notes, bank_details: value.bankDetails === undefined ? previous?.bank_details ?? null : value.bankDetails,
        planned_template_id: previous?.planned_template_id ?? null, status: previous?.status ?? 'draft', transaction_id: null, paid_at: null,
        planned_template_snapshot: previous?.planned_template_snapshot ?? null, version: previous?.version ?? 1, created_at: previous?.created_at ?? now, modified_at: now, modified_by: actor };
      invoicesSave(ctx, row);
    } else if (action.kind === 'set_invoice_status') {
      const row = invoice(action.id, action.version);
      if (action.status === 'draft') invoicesRevertToDraft(ctx, row.id);
      else invoicesSave(ctx, { ...row, status: action.status, modified_by: actor });
    } else if (action.kind === 'set_categories') {
      capability('categories.manage'); select('categories', action.type);
      expectValue(ctx.repos.categories.getAll(action.type), action.expected);
      if (new Set(action.names.map((value) => value.toLowerCase())).size !== action.names.length) throw new Error('Category names must be unique.');
      categoriesSetAll(ctx, action.type, action.names);
    } else if (action.kind === 'rename_activity') {
      capability('activities.manage'); select('activity', action.name);
      if (action.name === action.newName) throw new Error('Choose a different activity name.');
      const notes = ctx.repos.activityNotes.getAll();
      if (Object.hasOwn(notes, action.name) && !access.policy.fields.includes('notes')) throw new Error('Changing an activity with notes requires notes-field permission.');
      if (action.newName && Object.hasOwn(notes, action.newName)) throw new Error('The destination activity already has notes. Review how to merge them first.');
      const transactions = ctx.transactionRepo.getAll().filter((row) => row.activity === action.name);
      const templates = ctx.plannedRepo.getAll().filter((row) => row.activity === action.name);
      if (!transactions.length && !templates.length && !Object.hasOwn(notes, action.name)) throw new Error('This activity no longer exists.');
      transactions.forEach((row) => { accountName(row.sheet); select('transaction', row.id); });
      templates.forEach((row) => { accountName(row.target_sheet); if (row.transfer_target_sheet) accountName(row.transfer_target_sheet); select('planned', row.id); });
      activitiesApplyChange(ctx, {
        transactions: transactions.map((row) => ({ id: row.id, version: row.version, expectedActivity: row.activity, activity: action.newName })),
        templates: templates.map((row) => ({ id: row.id, version: row.version, expectedActivity: row.activity, activity: action.newName })),
        notes: Object.hasOwn(notes, action.name) ? [{ name: action.name, expected: notes[action.name], text: null }, ...(action.newName ? [{ name: action.newName, expected: null, text: notes[action.name] }] : [])] : [],
      });
    } else if (action.kind === 'set_activity_note') {
      capability('activities.manage'); if (!access.policy.fields.includes('notes')) throw new Error('Activity notes require notes-field permission.');
      select('activity-note', action.name); expectValue(ctx.repos.activityNotes.getAll()[action.name] ?? null, action.expected);
      if (action.text === null) activityNotesDelete(ctx, action.name); else activityNotesSave(ctx, action.name, action.text);
    } else {
      capability('settings.manage'); capability('settings.read'); select('settings', action.kind);
      if (action.kind === 'set_profile') { expectValue(settings.settingsGetProfile(ctx), action.expected); settings.settingsSaveProfile(ctx, action.value); }
      else if (action.kind === 'set_transaction_behavior') { expectValue(settings.settingsGetTransactionSettings(ctx), action.expected); settings.settingsSaveTransactionSettings(ctx, action.value); }
      else if (action.kind === 'set_financial_year') { expectValue(settings.settingsGetFYStartMonth(ctx), action.expected); settings.settingsSaveFYStartMonth(ctx, action.startMonth); }
      else if (action.kind === 'set_organisation') { expectValue(settings.settingsGetOrgName(ctx), action.expected); settings.settingsSaveOrgName(ctx, action.name); }
      else {
        const current = settings.settingsGetInvoiceDefaults(ctx);
        expectValue(Object.fromEntries(Object.keys(action.expected).map((key) => [key, current[key as keyof typeof current]])), action.expected);
        if (!access.policy.fields.includes('party') || !access.policy.fields.includes('notes')) throw new Error('Invoice defaults require party and notes permission.');
        settings.settingsSaveInvoiceDefaults(ctx, { ...current, ...action.value });
      }
    }
  }
  return [...requiredCapabilities];
}
