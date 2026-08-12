import { describe, it, expect } from 'vitest';
import {
  transactionRowSchema,
  plannedTemplateRowSchema,
  sheetRowSchema,
  attachmentRowSchema,
  invoiceRowSchema,
  idSchema,
} from '../ipc-schemas';

const transaction = {
  id: 'tx-1',
  date: '2026-01-15',
  description: 'Kit purchase',
  amount: '42.50',
  type: 'expense',
  status: 'approved',
  sheet: 'Main',
  category: 'Equipment',
  party: 'Supplier Ltd',
  reference: null,
  activity: null,
  notes: null,
  linked_id: null,
  version: 1,
  created_at: '2026-01-15T09:00:00.000Z',
  modified_at: null,
  modified_by: null,
};

const planned = {
  id: 'pt-1',
  start_date: '2026-01-01',
  description: 'Monthly subs',
  amount: '10.00',
  type: 'income',
  frequency: 'monthly',
  target_sheet: 'Main',
  category: null,
  party: null,
  activity: null,
  notes: null,
  end_date: null,
  occurrence_count: null,
  skipped_dates: '[]',
  fulfilled_dates: '["2026-01-01"]',
  transfer_target_sheet: null,
  version: 1,
  created_at: '2026-01-01T00:00:00.000Z',
};

const sheet = {
  id: 's-1',
  name: 'Main',
  is_virtual: 0,
  is_planned: 0,
  sort_order: 0,
  created_at: '2026-01-01T00:00:00.000Z',
};

const attachment = {
  id: 'a-1',
  transaction_id: 'tx-1',
  filename: 'receipt.pdf',
  stored_name: '2026-01-15_expense_42.50_supplier.pdf',
  mime_type: 'application/pdf',
  file_size: 1024,
  created_at: '2026-01-15T09:00:00.000Z',
};

const invoice = {
  id: 'inv-1',
  invoice_number: 'INV-001',
  date: '2026-01-15',
  due_date: '2026-02-15',
  from_name: 'The Club',
  from_address: null,
  to_name: 'A Member',
  to_address: null,
  line_items: '[{"description":"Membership","quantity":1,"unitPrice":25}]',
  subtotal: '25.00',
  notes: null,
  bank_details: null,
  planned_template_id: null,
  status: 'draft',
  transaction_id: null,
  paid_at: null,
  planned_template_snapshot: null,
  version: 1,
  created_at: '2026-01-15T09:00:00.000Z',
  modified_at: null,
  modified_by: null,
};

/** Rows the app actually writes must keep validating. */
describe('representative rows', () => {
  it('accepts a normal transaction, template, sheet, attachment and invoice', () => {
    expect(transactionRowSchema.safeParse(transaction).success).toBe(true);
    expect(plannedTemplateRowSchema.safeParse(planned).success).toBe(true);
    expect(sheetRowSchema.safeParse(sheet).success).toBe(true);
    expect(attachmentRowSchema.safeParse(attachment).success).toBe(true);
    expect(invoiceRowSchema.safeParse(invoice).success).toBe(true);
  });

  it('still accepts amounts written without two decimal places', () => {
    // Undo replays rows straight out of the database, including older ones
    expect(transactionRowSchema.safeParse({ ...transaction, amount: '10' }).success).toBe(true);
    expect(transactionRowSchema.safeParse({ ...transaction, amount: '10.5' }).success).toBe(true);
  });

  it('accepts a bare date where a timestamp is expected', () => {
    expect(transactionRowSchema.safeParse({ ...transaction, created_at: '2026-01-15' }).success).toBe(true);
  });
});

describe('identifiers', () => {
  it('rejects empty ids', () => {
    expect(idSchema.safeParse('').success).toBe(false);
    expect(transactionRowSchema.safeParse({ ...transaction, id: '' }).success).toBe(false);
  });

  it('rejects an empty linked_id, which would look like a transfer to nothing', () => {
    expect(transactionRowSchema.safeParse({ ...transaction, linked_id: '' }).success).toBe(false);
    expect(transactionRowSchema.safeParse({ ...transaction, linked_id: null }).success).toBe(true);
  });

  it('rejects a transaction with no sheet', () => {
    expect(transactionRowSchema.safeParse({ ...transaction, sheet: '' }).success).toBe(false);
  });
});

describe('amounts', () => {
  it('rejects what parseFloat would have half-read', () => {
    for (const amount of ['', 'NaN', 'abc', '12abc', '1,234.56', '£12.34', '1e3']) {
      expect(transactionRowSchema.safeParse({ ...transaction, amount }).success).toBe(false);
    }
  });

  it('rejects a NaN subtotal on an invoice', () => {
    // `grandTotal.toFixed(2)` produces the string "NaN" when the form is empty
    expect(invoiceRowSchema.safeParse({ ...invoice, subtotal: 'NaN' }).success).toBe(false);
  });
});

describe('dates', () => {
  it('rejects the wrong shape', () => {
    for (const date of ['', '15/01/2026', '2026-1-5', 'yesterday']) {
      expect(transactionRowSchema.safeParse({ ...transaction, date }).success).toBe(false);
    }
  });

  it('rejects dates that do not exist', () => {
    // `new Date('2026-02-31')` quietly becomes 3 March
    expect(transactionRowSchema.safeParse({ ...transaction, date: '2026-02-31' }).success).toBe(false);
    expect(transactionRowSchema.safeParse({ ...transaction, date: '2026-13-01' }).success).toBe(false);
    // ...but real leap days are fine
    expect(transactionRowSchema.safeParse({ ...transaction, date: '2028-02-29' }).success).toBe(true);
    expect(transactionRowSchema.safeParse({ ...transaction, date: '2026-02-29' }).success).toBe(false);
  });
});

describe('JSON string columns', () => {
  it('rejects skipped/fulfilled dates that JSON.parse would choke on', () => {
    expect(plannedTemplateRowSchema.safeParse({ ...planned, skipped_dates: 'not json' }).success).toBe(false);
    expect(plannedTemplateRowSchema.safeParse({ ...planned, skipped_dates: '{}' }).success).toBe(false);
    expect(plannedTemplateRowSchema.safeParse({ ...planned, fulfilled_dates: '["nope"]' }).success).toBe(false);
  });

  it('accepts both invoice line-item formats', () => {
    // What the app writes today
    expect(invoiceRowSchema.safeParse({
      ...invoice,
      line_items: '{"items":[{"description":"Subs","quantity":1,"unitPrice":25}],"taxRate":0}',
    }).success).toBe(true);
    // The legacy bare array
    expect(invoiceRowSchema.safeParse({ ...invoice, line_items: '[]' }).success).toBe(true);
  });

  it('rejects invoice line items that are neither', () => {
    expect(invoiceRowSchema.safeParse({ ...invoice, line_items: 'not json' }).success).toBe(false);
    expect(invoiceRowSchema.safeParse({ ...invoice, line_items: '{}' }).success).toBe(false);
    expect(invoiceRowSchema.safeParse({ ...invoice, line_items: '"a string"' }).success).toBe(false);
  });
});

describe('attachments', () => {
  it('rejects a stored_name that is a path rather than a filename', () => {
    // stored_name is resolved against the attachment directory
    for (const stored_name of ['../escape.pdf', 'nested/file.pdf', 'a\\b.pdf', '..']) {
      expect(attachmentRowSchema.safeParse({ ...attachment, stored_name }).success).toBe(false);
    }
  });

  it('rejects a negative file size', () => {
    expect(attachmentRowSchema.safeParse({ ...attachment, file_size: -1 }).success).toBe(false);
  });
});

describe('sheets', () => {
  it('rejects an unnamed sheet', () => {
    expect(sheetRowSchema.safeParse({ ...sheet, name: '' }).success).toBe(false);
  });

  it('rejects flags that are not 0 or 1', () => {
    expect(sheetRowSchema.safeParse({ ...sheet, is_virtual: 2 }).success).toBe(false);
    expect(sheetRowSchema.safeParse({ ...sheet, is_planned: 1 }).success).toBe(true);
  });
});
