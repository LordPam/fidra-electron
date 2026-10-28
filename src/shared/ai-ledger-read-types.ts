import { z } from 'zod';
import { dateSchema, idSchema } from './ipc-schemas';

const page = {
  offset: z.number().int().min(0).max(1_000_000).default(0),
  limit: z.number().int().min(1).max(200).default(100),
};
export const aiTransactionQuerySchema = z.object({
  from: dateSchema, to: dateSchema,
  sheetIds: z.array(idSchema).min(1).max(50).optional(),
  ...page,
}).strict().refine((query) => query.from <= query.to, 'Start date must precede end date.');
export const aiPlannedQuerySchema = z.object({
  sheetIds: z.array(idSchema).min(1).max(50).optional(), ...page,
}).strict();
export const aiInvoiceQuerySchema = z.object({
  from: dateSchema, to: dateSchema, ...page,
}).strict().refine((query) => query.from <= query.to, 'Start date must precede end date.');
export const aiEmptyQuerySchema = z.object({}).strict();
export const aiSettingsQuerySchema = z.object({
  groups: z.array(z.enum(['profile', 'transactionBehavior', 'financialYear', 'organisation', 'invoiceDefaults', 'appearance'])).min(1).max(6),
}).strict();
