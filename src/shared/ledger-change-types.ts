import { z } from 'zod';
import { dateSchema, profileSchema, transactionSettingsSchema } from './ipc-schemas';
import { isPositiveAmount } from './money';

const id = z.string().min(1).max(200);
const text = z.string().max(10000);
const name = z.string().trim().min(1).max(200);
const amount = z.string().regex(/^\d+\.\d{2}$/).refine(isPositiveAmount, 'Use a positive amount with two decimal places.');
const type = z.enum(['income', 'expense']);
const version = z.number().int().nonnegative();
const details = {
  description: text, category: name.nullable(), party: name.nullable(), activity: name.nullable(), notes: text.nullable(),
};
const actual = z.object({ date: dateSchema, amount, type, sheetId: id, ...details, reference: text.nullable() }).strict();
const schedule = z.object({ startDate: dateSchema, amount, type, sheetId: id, ...details,
  frequency: z.enum(['once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']),
  endDate: dateSchema.nullable(), occurrenceCount: z.number().int().positive().max(10000).nullable(), transferSheetId: id.nullable(),
}).strict();
const patch = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict().partial().refine((value) => Object.keys(value).length > 0, 'Supply at least one changed field.');
const invoiceItem = z.object({ description: text, quantity: z.number().int().min(1).max(100000), unitPrice: amount }).strict();
const invoice = z.object({ invoiceNumber: name, date: dateSchema, dueDate: dateSchema, fromName: text,
  fromAddress: text.nullable(), toName: text, toAddress: text.nullable(), items: z.array(invoiceItem).min(1).max(200),
  taxRate: z.number().min(0).max(100), accentMode: z.enum(['fidra', 'black', 'logo']), notes: text.nullable(), bankDetails: text.nullable(),
}).strict();
const reason = z.string().trim().min(1).max(1000);
export const ledgerChangeActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create_transaction'), value: actual, reason }).strict(),
  z.object({ kind: z.literal('edit_transaction'), id, version, changes: patch(actual.shape), reason }).strict(),
  z.object({ kind: z.literal('set_transaction_status'), id, version, status: z.enum(['pending', 'approved', 'rejected', '--']), reason }).strict(),
  z.object({ kind: z.literal('split_transaction'), id, version, parts: z.array(z.object({ ...details, reference: text.nullable() }).strict().partial().extend({ amount })).min(2).max(50), reason }).strict(),
  z.object({ kind: z.literal('create_planned'), value: schedule, reason }).strict(),
  z.object({ kind: z.literal('edit_planned'), id, version, changes: patch(schedule.shape), reason }).strict(),
  z.object({ kind: z.literal('edit_planned_occurrence'), id, version, date: dateSchema,
    changes: patch({ date: dateSchema, amount, type, sheetId: id, ...details, transferSheetId: id.nullable() }), reason }).strict(),
  z.object({ kind: z.literal('planned_occurrence'), id, version, date: dateSchema, operation: z.enum(['skip', 'restore', 'fulfil']), actualDate: dateSchema.optional(), reason }).strict(),
  z.object({ kind: z.literal('create_transfer'), fromSheetId: id, toSheetId: id, date: dateSchema, amount, description: text, reference: text.nullable(), notes: text.nullable(), reason }).strict(),
  z.object({ kind: z.literal('edit_transfer'), expenseId: id, expenseVersion: version, incomeId: id, incomeVersion: version,
    changes: patch({ fromSheetId: id, toSheetId: id, date: dateSchema, amount, description: text, reference: text.nullable(), notes: text.nullable() }), reason }).strict(),
  z.object({ kind: z.literal('create_invoice'), value: invoice, reason }).strict(),
  z.object({ kind: z.literal('edit_invoice'), id, version, changes: patch(invoice.shape), reason }).strict(),
  z.object({ kind: z.literal('set_invoice_status'), id, version, status: z.enum(['draft', 'sent']), reason }).strict(),
  z.object({ kind: z.literal('set_categories'), type, expected: z.array(name).max(500), names: z.array(name).max(500), reason }).strict(),
  z.object({ kind: z.literal('rename_activity'), name, newName: name.nullable(), reason }).strict(),
  z.object({ kind: z.literal('set_activity_note'), name, expected: text.nullable(), text: text.nullable(), reason }).strict(),
  z.object({ kind: z.literal('set_profile'), expected: profileSchema.strict(), value: profileSchema.strict(), reason }).strict(),
  z.object({ kind: z.literal('set_transaction_behavior'), expected: transactionSettingsSchema.strict(), value: transactionSettingsSchema.strict(), reason }).strict(),
  z.object({ kind: z.literal('set_financial_year'), expected: z.number().int().min(1).max(12), startMonth: z.number().int().min(1).max(12), reason }).strict(),
  z.object({ kind: z.literal('set_organisation'), expected: text, name: z.string().max(200), reason }).strict(),
  z.object({ kind: z.literal('set_invoice_defaults'), expected: z.object({ fromName: text, fromAddress: text, bankDetails: text, notes: text, accentMode: z.enum(['fidra', 'black', 'logo']) }).strict(),
    value: z.object({ fromName: text, fromAddress: text, bankDetails: text, notes: text, accentMode: z.enum(['fidra', 'black', 'logo']) }).strict(), reason }).strict(),
]);
export const ledgerChangeRequestSchema = z.object({ requestId: z.string().uuid(), label: z.string().trim().min(1).max(200), actions: z.array(ledgerChangeActionSchema).min(1).max(500) }).strict();
export type LedgerChangeAction = z.infer<typeof ledgerChangeActionSchema>;
export type LedgerChangeRequest = z.infer<typeof ledgerChangeRequestSchema>;
