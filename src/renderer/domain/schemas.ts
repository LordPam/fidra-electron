import { z } from 'zod';

const transactionTypeSchema = z.enum(['income', 'expense']);
const approvalStatusSchema = z.enum(['--', 'pending', 'approved', 'rejected', 'planned']);
const frequencySchema = z.enum(['once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']);
const auditActionSchema = z.enum(['create', 'update', 'delete']);

// Full model schemas (for data coming from the database)
export const transactionSchema = z.object({
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

export const plannedTemplateSchema = z.object({
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

export const sheetSchema = z.object({
  id: z.string(),
  name: z.string(),
  is_virtual: z.number(),
  is_planned: z.number(),
  created_at: z.string(),
});

export const categorySchema = z.object({
  id: z.number().int(),
  type: transactionTypeSchema,
  name: z.string(),
  sort_order: z.number().int(),
});

export const attachmentSchema = z.object({
  id: z.string(),
  transaction_id: z.string(),
  filename: z.string(),
  stored_name: z.string(),
  mime_type: z.string().nullable(),
  file_size: z.number().int(),
  created_at: z.string(),
});

export const auditEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  action: auditActionSchema,
  entity_type: z.string(),
  entity_id: z.string(),
  user: z.string(),
  summary: z.string(),
  details: z.string().nullable(),
});

export const activityNoteSchema = z.object({
  activity: z.string(),
  notes: z.string(),
});

// Creation payload schemas (for new records)
export const newTransactionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  type: transactionTypeSchema,
  sheet: z.string().min(1),
  category: z.string().nullable().optional(),
  party: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
  activity: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: approvalStatusSchema.optional(),
});

export const newPlannedTemplateSchema = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  type: transactionTypeSchema,
  target_sheet: z.string().min(1),
  frequency: frequencySchema,
  category: z.string().nullable().optional(),
  party: z.string().nullable().optional(),
  activity: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  occurrence_count: z.number().int().positive().nullable().optional(),
});

export const newSheetSchema = z.object({
  name: z.string().min(1),
  is_virtual: z.number().optional(),
  is_planned: z.number().optional(),
});

export const newCategorySchema = z.object({
  type: transactionTypeSchema,
  name: z.string().min(1),
  sort_order: z.number().int().optional(),
});

export type NewTransaction = z.infer<typeof newTransactionSchema>;
export type NewPlannedTemplate = z.infer<typeof newPlannedTemplateSchema>;
export type NewSheet = z.infer<typeof newSheetSchema>;
export type NewCategory = z.infer<typeof newCategorySchema>;
