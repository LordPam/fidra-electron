import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { InvoiceRepo } from '../invoice-repo';
import type { InvoiceRow } from '../../../shared/ipc-types';

const SCHEMA = `
  CREATE TABLE invoices (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    invoice_number TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL DEFAULT '',
    due_date TEXT NOT NULL DEFAULT '',
    from_name TEXT NOT NULL DEFAULT '',
    from_address TEXT,
    to_name TEXT NOT NULL DEFAULT '',
    to_address TEXT,
    line_items TEXT NOT NULL DEFAULT '[]',
    subtotal TEXT NOT NULL DEFAULT '0',
    notes TEXT, bank_details TEXT, planned_template_id TEXT,
    status TEXT DEFAULT 'draft',
    transaction_id TEXT, paid_at TEXT, planned_template_snapshot TEXT,
    version INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT '',
    modified_at TEXT, modified_by TEXT
  );
`;

/** The shape InvoicesView writes today. */
const wrapped = (unitPrice: number, description = 'Membership'): string =>
  JSON.stringify({ items: [{ description, quantity: 1, unitPrice }], taxRate: 0, accentMode: 'fidra' });

/** The older shape, a bare array. */
const legacy = (unitPrice: number, description = 'Membership'): string =>
  JSON.stringify([{ description, quantity: 1, unitPrice }]);

let db: Database.Database;
let repo: InvoiceRepo;

function invoice(overrides: Partial<InvoiceRow> & { id: string }): InvoiceRow {
  return {
    invoice_number: 'INV-001',
    date: '2026-01-15',
    due_date: '2026-02-15',
    from_name: 'The Club',
    from_address: null,
    to_name: 'A Member',
    to_address: null,
    line_items: legacy(25),
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
    ...overrides,
  };
}

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  repo = new InvoiceRepo(db);
});

describe('save', () => {
  it('inserts then updates, bumping the version each time', () => {
    repo.save(invoice({ id: 'i1' }));
    expect(repo.getById('i1')!.version).toBe(1);

    repo.save(invoice({ id: 'i1', to_name: 'Someone Else' }));

    const saved = repo.getById('i1')!;
    expect(saved.version).toBe(2);
    expect(saved.to_name).toBe('Someone Else');
    expect(saved.modified_at).not.toBeNull();
  });

  it('lists newest first', () => {
    repo.save(invoice({ id: 'old', created_at: '2026-01-01T00:00:00.000Z' }));
    repo.save(invoice({ id: 'new', created_at: '2026-02-01T00:00:00.000Z' }));

    expect(repo.getAll().map((i) => i.id)).toEqual(['new', 'old']);
  });
});

describe('markPaid and revertToDraft', () => {
  it('records the linked transaction and the time of payment', () => {
    repo.save(invoice({ id: 'i1' }));

    const paid = repo.markPaid('i1', 'tx-1')!;

    expect(paid.status).toBe('paid');
    expect(paid.transaction_id).toBe('tx-1');
    expect(paid.paid_at).not.toBeNull();
    expect(paid.version).toBe(2);
  });

  it('clears payment details on revert', () => {
    repo.save(invoice({ id: 'i1' }));
    repo.markPaid('i1', 'tx-1');

    const draft = repo.revertToDraft('i1')!;

    expect(draft.status).toBe('draft');
    expect(draft.transaction_id).toBeNull();
    expect(draft.paid_at).toBeNull();
    expect(draft.version).toBe(3);
  });
});

describe('updateLinkedFromPlanned', () => {
  it('does nothing when no invoice is linked', () => {
    repo.save(invoice({ id: 'i1' }));

    expect(repo.updateLinkedFromPlanned('pt-1', '2026-03-01', 'New', '30.00')).toBe(0);
  });

  it('updates a legacy bare-array invoice', () => {
    repo.save(invoice({ id: 'i1', planned_template_id: 'pt-1', line_items: legacy(25) }));

    expect(repo.updateLinkedFromPlanned('pt-1', '2026-03-01', 'Renewed subs', '30.00')).toBe(1);

    const updated = repo.getById('i1')!;
    expect(updated.due_date).toBe('2026-03-01');
    expect(updated.subtotal).toBe('30.00');
    expect(JSON.parse(updated.line_items)[0]).toMatchObject({
      description: 'Renewed subs',
      unitPrice: 30,
    });
  });

  it('updates an invoice in the format the app writes today', () => {
    // Regression: this used to throw `items.reduce is not a function`, because the
    // parsed value is `{ items, taxRate, accentMode }` rather than an array — so
    // editing a planned template with a linked invoice failed outright.
    repo.save(invoice({ id: 'i1', planned_template_id: 'pt-1', line_items: wrapped(25) }));

    expect(repo.updateLinkedFromPlanned('pt-1', '2026-03-01', 'Renewed subs', '30.00')).toBe(1);

    const updated = repo.getById('i1')!;
    expect(updated.due_date).toBe('2026-03-01');
    expect(updated.subtotal).toBe('30.00');

    const parsed = JSON.parse(updated.line_items);
    expect(parsed.items[0]).toMatchObject({ description: 'Renewed subs', unitPrice: 30 });
    // The rest of the wrapper survives the round trip
    expect(parsed.taxRate).toBe(0);
    expect(parsed.accentMode).toBe('fidra');
  });

  it('keeps the existing price when the amount cannot be read', () => {
    repo.save(invoice({ id: 'i1', planned_template_id: 'pt-1', line_items: wrapped(25) }));

    repo.updateLinkedFromPlanned('pt-1', '2026-03-01', 'Renewed subs', 'not a number');

    expect(JSON.parse(repo.getById('i1')!.line_items).items[0].unitPrice).toBe(25);
  });

  it('skips an invoice whose line items are not valid JSON', () => {
    repo.save(invoice({ id: 'i1', planned_template_id: 'pt-1', line_items: 'not json' }));

    expect(repo.updateLinkedFromPlanned('pt-1', '2026-03-01', 'New', '30.00')).toBe(0);
  });

  it('multiplies out quantity when totalling', () => {
    repo.save(invoice({
      id: 'i1',
      planned_template_id: 'pt-1',
      line_items: JSON.stringify({ items: [{ description: 'Subs', quantity: 3, unitPrice: 25 }], taxRate: 0 }),
    }));

    repo.updateLinkedFromPlanned('pt-1', '2026-03-01', 'Subs', '10.00');

    expect(repo.getById('i1')!.subtotal).toBe('30.00');
  });
});

describe('remove', () => {
  it('reports whether anything was deleted', () => {
    repo.save(invoice({ id: 'i1' }));

    expect(repo.remove('i1')).toBe(true);
    expect(repo.remove('i1')).toBe(false);
    expect(repo.getById('i1')).toBeNull();
  });
});
