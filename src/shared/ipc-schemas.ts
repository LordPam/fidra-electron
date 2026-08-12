import { z } from 'zod';
import { isValidAmount } from './money';

// ─── Field schemas ──────────────────────────────────────────────────
//
// These describe the *values* a row may hold, not just its shape. Shape-only
// validation let an empty id, the string "NaN" as an amount, or "2026-02-31" as a
// date through to SQLite, where nothing else would catch them: cr-sqlite forbids
// the UNIQUE and FOREIGN KEY constraints that would normally be the backstop.
//
// Row schemas are also used on undo paths, which replay rows read back out of the
// database. Anything that a current writer can legitimately produce must still
// validate — hence dates accept any real calendar date, and amounts accept "10"
// as readily as "10.00".

/** An identifier that actually identifies something. */
export const idSchema = z.string().min(1, 'must not be empty');

/** A name used as a lookup key — sheets and categories are referenced by name. */
export const nameSchema = z.string().min(1, 'must not be empty');

/** Optional identifier — absent is fine, empty is not. */
const nullableIdSchema = idSchema.nullable();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `new Date('2026-02-31')` silently rolls over to 3 March, so the components have
 * to be compared back against what was asked for.
 */
function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** A calendar date: `YYYY-MM-DD`, and a date that exists. */
const dateSchema = z
  .string()
  .regex(ISO_DATE, 'expected a YYYY-MM-DD date')
  .refine(isRealCalendarDate, 'not a real calendar date');

/** A point in time. Written as a full ISO timestamp; bare dates are tolerated. */
const timestampSchema = z
  .string()
  .refine(
    (value) => ISO_DATE.test(value.slice(0, 10)) && !Number.isNaN(Date.parse(value)),
    'expected an ISO timestamp',
  );

/**
 * A money amount in stored form. Delegates to the money module so the IPC boundary
 * and the arithmetic agree on what a number is — `"12abc"` is not one, even though
 * `parseFloat` would read it as 12.
 */
const amountSchema = z
  .string()
  .refine(isValidAmount, 'expected a decimal amount such as "12.34"');

/**
 * Invoice line items, which have two shapes in the wild: a bare array (legacy) and
 * `{ items, taxRate, accentMode? }` (what the app writes now). `parseLineItems` in
 * InvoicesView reads both, so both have to validate.
 */
const lineItemsSchema = z.string().refine((value) => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return true;
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as { items?: unknown }).items)
    );
  } catch {
    return false;
  }
}, 'expected a JSON array of line items, or an object with an items array');

/** A JSON-encoded array of calendar dates (skipped/fulfilled planned occurrences). */
const jsonDateArraySchema = z.string().refine((value) => {
  try {
    const parsed: unknown = JSON.parse(value);
    return (
      Array.isArray(parsed) &&
      parsed.every((d) => typeof d === 'string' && ISO_DATE.test(d) && isRealCalendarDate(d))
    );
  } catch {
    return false;
  }
}, 'expected a JSON array of YYYY-MM-DD dates');

/**
 * Row version counter. Not required to be positive: it buys nothing, and a stricter
 * rule would block undo from replaying an old row that happens to sit at 0.
 */
const versionSchema = z.number().int().nonnegative();

/** SQLite has no boolean type; these columns hold 0 or 1. */
const sqliteBooleanSchema = z.union([z.literal(0), z.literal(1)]);

// ─── Enum schemas ───────────────────────────────────────────────────
const transactionTypeSchema = z.enum(['income', 'expense']);
const approvalStatusSchema = z.enum(['--', 'pending', 'approved', 'rejected', 'planned']);
const frequencySchema = z.enum(['once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']);
const personnelRoleSchema = z.enum(['admin', 'member']);
const themeModeSchema = z.enum(['system', 'light', 'dark']);
const invoiceStatusSchema = z.enum(['draft', 'sent', 'paid']);

// ─── Row schemas (wire format from SQLite / IPC) ────────────────────

export const transactionRowSchema = z.object({
  id: idSchema,
  date: dateSchema,
  description: z.string(),
  amount: amountSchema,
  type: transactionTypeSchema,
  status: approvalStatusSchema,
  // Sheets are referenced by name; an empty one belongs to no sheet at all
  sheet: z.string().min(1, 'a transaction must belong to a sheet'),
  category: z.string().nullable(),
  party: z.string().nullable(),
  reference: z.string().nullable(),
  activity: z.string().nullable(),
  notes: z.string().nullable(),
  linked_id: nullableIdSchema,
  version: versionSchema,
  created_at: timestampSchema,
  modified_at: timestampSchema.nullable(),
  modified_by: z.string().nullable(),
});

export const plannedTemplateRowSchema = z.object({
  id: idSchema,
  start_date: dateSchema,
  description: z.string(),
  amount: amountSchema,
  type: transactionTypeSchema,
  frequency: frequencySchema,
  target_sheet: z.string().min(1, 'a planned template must target a sheet'),
  category: z.string().nullable(),
  party: z.string().nullable(),
  activity: z.string().nullable(),
  notes: z.string().nullable(),
  end_date: dateSchema.nullable(),
  occurrence_count: z.number().int().positive().nullable(),
  // PlannedView JSON.parses these on every render
  skipped_dates: jsonDateArraySchema,
  fulfilled_dates: jsonDateArraySchema,
  // A transfer's destination sheet, also by name
  transfer_target_sheet: z.string().min(1).nullable(),
  version: versionSchema,
  created_at: timestampSchema,
});

export const sheetRowSchema = z.object({
  id: idSchema,
  name: z.string().min(1, 'a sheet must have a name'),
  is_virtual: sqliteBooleanSchema,
  is_planned: sqliteBooleanSchema,
  sort_order: z.number().int().nonnegative(),
  created_at: timestampSchema,
});

export const attachmentRowSchema = z.object({
  id: idSchema,
  transaction_id: idSchema,
  filename: z.string().min(1),
  // Resolved against the attachment directory, so it must stay a bare filename
  stored_name: z.string().min(1).refine(
    (name) => !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..',
    'must be a filename, not a path',
  ),
  mime_type: z.string().nullable(),
  file_size: z.number().int().nonnegative(),
  created_at: timestampSchema,
});

export const invoiceRowSchema = z.object({
  id: idSchema,
  invoice_number: z.string().min(1),
  date: dateSchema,
  due_date: dateSchema,
  from_name: z.string(),
  from_address: z.string().nullable(),
  to_name: z.string(),
  to_address: z.string().nullable(),
  // invoice-repo and InvoicesView both JSON.parse this
  line_items: lineItemsSchema,
  subtotal: amountSchema,
  notes: z.string().nullable(),
  bank_details: z.string().nullable(),
  planned_template_id: nullableIdSchema,
  status: invoiceStatusSchema,
  transaction_id: nullableIdSchema,
  paid_at: timestampSchema.nullable(),
  planned_template_snapshot: z.string().nullable(),
  version: versionSchema,
  created_at: timestampSchema,
  modified_at: timestampSchema.nullable(),
  modified_by: z.string().nullable(),
});

// ─── Small settings schemas ─────────────────────────────────────────

export const profileSchema = z.object({
  name: z.string(),
  initials: z.string(),
});

export const transactionSettingsSchema = z.object({
  dateOnApprove: z.boolean(),
  dateOnPlannedConversion: z.boolean(),
});

export const invoiceDefaultsSchema = z.object({
  fromName: z.string(),
  fromAddress: z.string(),
  bankDetails: z.string(),
  notes: z.string(),
  logoPath: z.string(),
  logoData: z.string(),
  counter: z.string(),
  accentMode: z.enum(['fidra', 'black', 'logo']),
});

export const uiPreferencesSchema = z.object({
  tableZoom: z.number(),
  plannedTableZoom: z.number(),
  activitiesTableZoom: z.number(),
  showPlanned: z.boolean(),
  filteredBalanceMode: z.boolean(),
  theme: themeModeSchema,
  reportOrgName: z.string().optional(),
});

// ─── Dialog option schemas ──────────────────────────────────────────

const fileFilterSchema = z.object({
  name: z.string(),
  extensions: z.array(z.string()),
});

export const openDialogOptionsSchema = z.object({
  title: z.string().optional(),
  filters: z.array(fileFilterSchema).optional(),
  properties: z.array(z.string()).optional(),
});

export const saveDialogOptionsSchema = z.object({
  title: z.string().optional(),
  defaultPath: z.string().optional(),
  filters: z.array(fileFilterSchema).optional(),
});

export const printToPdfOptionsSchema = z.object({
  footerText: z.string().optional(),
}).optional();

// ─── Re-export enum schemas for handlers accepting enum args ────────

export const plannedTemplateBulkSaveSchema = z.array(plannedTemplateRowSchema);

// ─── Local Sync schemas ─────────────────────────────────────────────

export const localSyncConfigSchema = z.object({
  syncFolder: z.string().min(1),
  passphrase: z.string().min(1),
});

export const localSyncResolutionSchema = z.enum(['keep-local', 'accept-remote', 'manual']);

export const localSyncMigrationOptsSchema = z.object({
  syncFolder: z.string().min(1),
  passphrase: z.string().min(1),
  newDbPath: z.string().min(1),
});

export const localSyncJoinViaInviteSchema = z.object({
  syncFolder: z.string().min(1),
  email: z.string().min(1),
  inviteCode: z.string().min(1),
  password: z.string().min(6),
  newDbPath: z.string().min(1),
});

// ─── Backup schemas ─────────────────────────────────────────────────

export const backupPathSchema = z.string().min(1);

export const backupSettingsSchema = z.object({
  backupDir: z.string().nullable(),
  retentionCount: z.number().int().min(1).max(100),
  autoBackupOnClose: z.boolean(),
});

// ─── Local Auth schemas ──────────────────────────────────────────────

export const localAuthSignInSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

export const localAuthCreateFirstAdminSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(1),
  password: z.string().min(6),
  syncPassphrase: z.string().min(1),
});

export const localAuthInviteMemberSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(1),
  role: personnelRoleSchema,
});

export const localAuthChangePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

export { personnelRoleSchema, transactionTypeSchema };
