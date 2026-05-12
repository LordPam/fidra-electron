import { ipcMain } from 'electron';
import { z } from 'zod';
import { resolveContext } from './context-resolver';
import {
  parseForPreview,
  analyzeForImport,
  commitImport,
  getProfiles,
  saveProfile,
  deleteProfile,
  trainModel,
} from '../services/csv-import';

// ─── Zod Schemas ─────────────────────────────────────────────────────

const csvColumnMappingSchema = z.object({
  date: z.number().int(),
  description: z.number().int(),
  amount: z.number().int(),
  debit: z.number().int(),
  credit: z.number().int(),
  typeIndicator: z.number().int(),
  reference: z.number().int(),
  party: z.number().int(),
  notes: z.number().int(),
  category: z.number().int(),
});

const amountModeSchema = z.enum(['signed', 'debit-credit', 'amount-with-indicator']);
const signConventionSchema = z.enum(['positive-income', 'positive-expense']);
const decimalSeparatorSchema = z.enum(['.', ',']);
const defaultStatusSchema = z.enum(['--', 'pending', 'approved']);

const csvParseRequestSchema = z.object({
  filePath: z.string().min(1),
  profileId: z.string().optional(),
  encoding: z.string().optional(),
});

const csvAnalyzeRequestSchema = z.object({
  filePath: z.string().min(1),
  columnMapping: csvColumnMappingSchema,
  amountMode: amountModeSchema,
  signConvention: signConventionSchema,
  dateFormat: z.string().nullable(),
  decimalSeparator: decimalSeparatorSchema,
  skipRows: z.number().int().min(0),
  encoding: z.string().optional(),
  targetSheet: z.string().min(1),
  defaultStatus: defaultStatusSchema,
});

const parsedCsvRowSchema = z.object({
  rowIndex: z.number().int(),
  rawValues: z.array(z.string()),
  date: z.string().nullable(),
  description: z.string().nullable(),
  amount: z.number().nullable(),
  type: z.enum(['income', 'expense']).nullable(),
  reference: z.string().nullable(),
  party: z.string().nullable(),
  notes: z.string().nullable(),
  category: z.string().nullable(),
  parseErrors: z.array(z.string()),
});

const csvCommitRequestSchema = z.object({
  rows: z.array(z.object({
    parsed: parsedCsvRowSchema,
    prediction: z.object({
      category: z.string().nullable(),
      type: z.enum(['income', 'expense']).nullable(),
      confidence: z.number(),
      source: z.enum(['bayesian', 'party-mapping', 'description-mapping', 'none']),
      suggestedDescription: z.string().nullable(),
      suggestedParty: z.string().nullable(),
    }),
    duplicateMatch: z.object({
      matchType: z.enum(['exact', 'content', 'fuzzy', 'none']),
      matchedTransactionIds: z.array(z.string()),
      confidence: z.number(),
      reason: z.string(),
    }),
    include: z.boolean(),
    userOverrides: z.object({
      category: z.string().nullable().optional(),
      type: z.enum(['income', 'expense']).optional(),
      description: z.string().optional(),
      party: z.string().nullable().optional(),
      status: defaultStatusSchema.optional(),
    }),
  })),
  targetSheet: z.string().min(1),
  defaultStatus: defaultStatusSchema,
});

const csvImportProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  columnMapping: csvColumnMappingSchema,
  amountMode: amountModeSchema,
  signConvention: signConventionSchema,
  dateFormat: z.string().nullable(),
  decimalSeparator: decimalSeparatorSchema,
  skipRows: z.number().int().min(0),
  encoding: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ─── Handlers ────────────────────────────────────────────────────────

export function registerCsvImportHandlers(): void {
  ipcMain.handle('csvImport:parse', (_event, request: unknown) => {
    const validated = csvParseRequestSchema.parse(request);
    return parseForPreview(validated);
  });

  ipcMain.handle('csvImport:analyze', (event, request: unknown) => {
    const validated = csvAnalyzeRequestSchema.parse(request);
    const ctx = resolveContext(event);
    return analyzeForImport(ctx, validated);
  });

  ipcMain.handle('csvImport:commit', (event, request: unknown) => {
    const validated = csvCommitRequestSchema.parse(request);
    const ctx = resolveContext(event);
    return commitImport(ctx, validated);
  });

  ipcMain.handle('csvImport:getProfiles', () => {
    return getProfiles();
  });

  ipcMain.handle('csvImport:saveProfile', (_event, profile: unknown) => {
    const validated = csvImportProfileSchema.parse(profile);
    saveProfile(validated);
  });

  ipcMain.handle('csvImport:deleteProfile', (_event, profileId: unknown) => {
    const validId = z.string().min(1).parse(profileId);
    deleteProfile(validId);
  });

  ipcMain.handle('csvImport:trainModel', (event) => {
    const ctx = resolveContext(event);
    trainModel(ctx);
  });
}
