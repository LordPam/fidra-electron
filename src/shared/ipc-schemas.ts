import { z } from 'zod';

// ─── Enum schemas ───────────────────────────────────────────────────
const transactionTypeSchema = z.enum(['income', 'expense']);
const approvalStatusSchema = z.enum(['--', 'pending', 'approved', 'rejected', 'planned']);
const frequencySchema = z.enum(['once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']);
const authModeSchema = z.enum(['admin', 'member', 'localSync']);
const personnelRoleSchema = z.enum(['admin', 'member']);
const oauthProviderSchema = z.enum(['google', 'azure']);
const themeModeSchema = z.enum(['system', 'light', 'dark']);
const invoiceStatusSchema = z.enum(['draft', 'paid']);

// ─── Row schemas (wire format from SQLite / IPC) ────────────────────

export const transactionRowSchema = z.object({
  id: z.string(),
  date: z.string(),
  description: z.string(),
  amount: z.string(),
  type: transactionTypeSchema,
  status: approvalStatusSchema,
  sheet: z.string(),
  category: z.string().nullable(),
  party: z.string().nullable(),
  reference: z.string().nullable(),
  activity: z.string().nullable(),
  notes: z.string().nullable(),
  version: z.number().int(),
  created_at: z.string(),
  modified_at: z.string().nullable(),
  modified_by: z.string().nullable(),
});

export const plannedTemplateRowSchema = z.object({
  id: z.string(),
  start_date: z.string(),
  description: z.string(),
  amount: z.string(),
  type: transactionTypeSchema,
  frequency: frequencySchema,
  target_sheet: z.string(),
  category: z.string().nullable(),
  party: z.string().nullable(),
  activity: z.string().nullable(),
  end_date: z.string().nullable(),
  occurrence_count: z.number().int().nullable(),
  skipped_dates: z.string(),
  fulfilled_dates: z.string(),
  version: z.number().int(),
  created_at: z.string(),
});

export const sheetRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  is_virtual: z.number(),
  is_planned: z.number(),
  sort_order: z.number(),
  created_at: z.string(),
});

export const attachmentRowSchema = z.object({
  id: z.string(),
  transaction_id: z.string(),
  filename: z.string(),
  stored_name: z.string(),
  mime_type: z.string().nullable(),
  file_size: z.number().int(),
  created_at: z.string(),
});

export const invoiceRowSchema = z.object({
  id: z.string(),
  invoice_number: z.string(),
  date: z.string(),
  due_date: z.string(),
  from_name: z.string(),
  from_address: z.string().nullable(),
  to_name: z.string(),
  to_address: z.string().nullable(),
  line_items: z.string(),
  subtotal: z.string(),
  notes: z.string().nullable(),
  bank_details: z.string().nullable(),
  planned_template_id: z.string().nullable(),
  status: invoiceStatusSchema,
  transaction_id: z.string().nullable(),
  paid_at: z.string().nullable(),
  planned_template_snapshot: z.string().nullable(),
  version: z.number().int(),
  created_at: z.string(),
  modified_at: z.string().nullable(),
  modified_by: z.string().nullable(),
});

export const cloudServerConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  connectionString: z.string(),
  poolMin: z.number().int(),
  poolMax: z.number().int(),
  storageUrl: z.string().optional(),
  storageKey: z.string().optional(),
  storageBucket: z.string().optional(),
  createdAt: z.string(),
  authMode: authModeSchema.optional(),
  projectUrl: z.string().optional(),
  anonKey: z.string().optional(),
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
  counter: z.string(),
});

export const uiPreferencesSchema = z.object({
  tableZoom: z.number(),
  plannedTableZoom: z.number(),
  activitiesTableZoom: z.number(),
  showPlanned: z.boolean(),
  filteredBalanceMode: z.boolean(),
  theme: themeModeSchema,
  reportOrgName: z.string(),
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

export { personnelRoleSchema, oauthProviderSchema, transactionTypeSchema };
