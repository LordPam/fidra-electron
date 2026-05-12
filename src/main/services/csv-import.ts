import { readCsvFile, detectColumnMapping, detectDateFormat, detectDecimalSeparator, applyMapping } from './csv-parser';
import { DuplicateDetector } from './csv-duplicate-detector';
import { BayesianCategorizer } from './bayesian-categorizer';
import type { WindowContext } from '../window/window-context';
import type { TransactionRow } from '../../shared/ipc-types';
import type {
  CsvParseRequest,
  CsvParseResponse,
  CsvAnalyzeRequest,
  CsvAnalyzeResponse,
  CsvCommitRequest,
  CsvImportResult,
  CsvImportProfile,
  ImportPreviewRow,
} from '../../shared/csv-import-types';
import { loadGlobalSettings, saveGlobalSettings } from '../window/global-settings';
import { resolveStatus } from '../../shared/transaction-rules';

// ─── Parse for Preview ───────────────────────────────────────────────

export function parseForPreview(request: CsvParseRequest): CsvParseResponse {
  const encoding = (request.encoding ?? 'utf-8') as BufferEncoding;
  const { headers, rows } = readCsvFile(request.filePath, encoding);

  // If a profile is specified, use its mapping
  if (request.profileId) {
    const settings = loadGlobalSettings();
    const profile = settings.csvImportProfiles?.find((p) => p.id === request.profileId);
    if (profile) {
      return {
        headers,
        sampleRows: rows,
        totalRowCount: rows.length,
        detectedMapping: profile.columnMapping,
        detectedAmountMode: profile.amountMode,
        detectedDateFormat: profile.dateFormat,
        detectedDecimalSeparator: profile.decimalSeparator,
      };
    }
  }

  const sampleRows = rows.slice(0, 10);
  const { mapping, amountMode } = detectColumnMapping(headers, sampleRows);

  // Detect date format from date column
  const dateValues = mapping.date >= 0
    ? sampleRows.map((r) => r[mapping.date] ?? '').filter(Boolean)
    : [];
  const detectedDateFormat = detectDateFormat(dateValues);

  // Detect decimal separator from amount columns
  const amountValues: string[] = [];
  if (mapping.amount >= 0) amountValues.push(...sampleRows.map((r) => r[mapping.amount] ?? '').filter(Boolean));
  if (mapping.debit >= 0) amountValues.push(...sampleRows.map((r) => r[mapping.debit] ?? '').filter(Boolean));
  if (mapping.credit >= 0) amountValues.push(...sampleRows.map((r) => r[mapping.credit] ?? '').filter(Boolean));
  const detectedDecimalSeparator = detectDecimalSeparator(amountValues);

  return {
    headers,
    sampleRows: rows,
    totalRowCount: rows.length,
    detectedMapping: mapping,
    detectedAmountMode: amountMode,
    detectedDateFormat,
    detectedDecimalSeparator,
  };
}

// ─── Analyze for Import ──────────────────────────────────────────────

export function analyzeForImport(ctx: WindowContext, request: CsvAnalyzeRequest): CsvAnalyzeResponse {
  const encoding = (request.encoding ?? 'utf-8') as BufferEncoding;
  const { rows } = readCsvFile(request.filePath, encoding);

  // Skip configured rows
  const dataRows = rows.slice(request.skipRows);

  // Parse all rows
  const parsedRows = dataRows.map((row, i) =>
    applyMapping(row, i + request.skipRows, request.columnMapping, request.amountMode, request.signConvention, request.dateFormat, request.decimalSeparator),
  );

  // Load existing transactions for duplicate detection (all sheets — a duplicate
  // on a different sheet is still a duplicate)
  const existingTransactions = ctx.repos.transactions.getAll();
  const detector = new DuplicateDetector(existingTransactions);

  // Load or create Bayesian model
  const categorizer = loadCategorizer(ctx);

  // Build preview rows
  const previewRows: ImportPreviewRow[] = parsedRows.map((parsed) => {
    const duplicateMatch = detector.check(parsed);
    const prediction = categorizer.predict(parsed);

    // Pre-populate overrides from description mapping predictions
    const userOverrides: ImportPreviewRow['userOverrides'] = {};
    if (prediction.suggestedDescription) {
      userOverrides.description = prediction.suggestedDescription;
    }
    if (prediction.suggestedParty !== null) {
      userOverrides.party = prediction.suggestedParty;
    }

    return {
      parsed,
      prediction,
      duplicateMatch,
      include: duplicateMatch.matchType === 'none' && parsed.parseErrors.length === 0,
      userOverrides,
    };
  });

  const summary = {
    total: previewRows.length,
    newRows: previewRows.filter((r) => r.duplicateMatch.matchType === 'none' && r.parsed.parseErrors.length === 0).length,
    duplicates: previewRows.filter((r) => r.duplicateMatch.matchType !== 'none').length,
    errors: previewRows.filter((r) => r.parsed.parseErrors.length > 0).length,
  };

  return { previewRows, summary };
}

// ─── Commit Import ───────────────────────────────────────────────────

export function commitImport(ctx: WindowContext, request: CsvCommitRequest): CsvImportResult {
  const includedRows = request.rows.filter((r) => r.include);
  const now = new Date().toISOString();
  const createdIds: string[] = [];

  const transactions: TransactionRow[] = includedRows.map((row) => {
    const id = crypto.randomUUID();
    createdIds.push(id);

    const p = row.parsed;
    const overrides = row.userOverrides;
    const type = overrides.type ?? row.prediction.type ?? p.type ?? 'expense';

    return {
      id,
      date: p.date ?? now.split('T')[0],
      description: overrides.description ?? p.description ?? '',
      amount: (p.amount ?? 0).toFixed(2),
      type,
      status: resolveStatus(type, overrides.status ?? request.defaultStatus),
      sheet: request.targetSheet,
      category: overrides.category !== undefined ? overrides.category : (row.prediction.category ?? p.category ?? null),
      party: overrides.party !== undefined ? overrides.party : (p.party ?? null),
      reference: p.reference ?? null,
      activity: null,
      notes: p.notes ?? null,
      version: 1,
      created_at: now,
      modified_at: null,
      modified_by: null,
    };
  });

  if (transactions.length > 0) {
    ctx.repos.transactions.bulkSave(transactions);
  }

  // Learn description mappings from user edits
  const categorizer = loadCategorizer(ctx);
  let modelDirty = false;

  for (const row of includedRows) {
    const bankDesc = row.parsed.description;
    if (!bankDesc) continue;

    const overrides = row.userOverrides;
    const hasEdits = overrides.description || overrides.party !== undefined || overrides.category !== undefined;
    if (hasEdits) {
      categorizer.learnDescriptionMapping(
        bankDesc,
        overrides.description ?? bankDesc,
        overrides.party !== undefined ? overrides.party : (row.parsed.party ?? null),
        overrides.category !== undefined ? overrides.category : (row.prediction.category ?? row.parsed.category ?? null),
        overrides.type ?? row.prediction.type ?? row.parsed.type ?? 'expense',
      );
      modelDirty = true;
    }
  }

  // Update Bayesian model with newly categorized transactions
  const categorizedTxs = transactions.filter((t) => t.category);
  if (categorizedTxs.length > 0) {
    const allTxs = ctx.repos.transactions.getAll();
    categorizer.train(allTxs);
    modelDirty = true;
  }

  if (modelDirty) {
    saveCategorizer(ctx, categorizer);
  }

  return {
    importedCount: transactions.length,
    skippedDuplicates: request.rows.filter((r) => !r.include && r.duplicateMatch.matchType !== 'none').length,
    skippedErrors: request.rows.filter((r) => !r.include && r.parsed.parseErrors.length > 0).length,
    createdTransactionIds: createdIds,
  };
}

// ─── Profile CRUD ────────────────────────────────────────────────────

export function getProfiles(): CsvImportProfile[] {
  const settings = loadGlobalSettings();
  return settings.csvImportProfiles ?? [];
}

export function saveProfile(profile: CsvImportProfile): void {
  const settings = loadGlobalSettings();
  const profiles = settings.csvImportProfiles ?? [];
  const idx = profiles.findIndex((p) => p.id === profile.id);
  if (idx >= 0) {
    profiles[idx] = profile;
  } else {
    profiles.push(profile);
  }
  settings.csvImportProfiles = profiles;
  saveGlobalSettings(settings);
}

export function deleteProfile(profileId: string): void {
  const settings = loadGlobalSettings();
  settings.csvImportProfiles = (settings.csvImportProfiles ?? []).filter((p) => p.id !== profileId);
  saveGlobalSettings(settings);
}

// ─── Bayesian Model Persistence ──────────────────────────────────────

function loadCategorizer(ctx: WindowContext): BayesianCategorizer {
  const json = ctx.settingsRepo.getSetting('csvImport.bayesianModel');
  const allTxs = ctx.repos.transactions.getAll();

  if (json) {
    const categorizer = BayesianCategorizer.deserialize(json);
    // Always retrain to rebuild the convention index (not serialized) from existing transactions.
    // train() preserves descriptionMap, so user-edited mappings survive.
    if (allTxs.length > 0) {
      categorizer.train(allTxs);
    }
    return categorizer;
  }

  // No saved model — train from scratch
  const categorizer = new BayesianCategorizer();
  if (allTxs.length > 0) {
    categorizer.train(allTxs);
    saveCategorizer(ctx, categorizer);
  }
  return categorizer;
}

function saveCategorizer(ctx: WindowContext, categorizer: BayesianCategorizer): void {
  ctx.settingsRepo.setSetting('csvImport.bayesianModel', categorizer.serialize(), 'device');
}

export function trainModel(ctx: WindowContext): void {
  const categorizer = new BayesianCategorizer();
  const allTxs = ctx.repos.transactions.getAll();
  categorizer.train(allTxs);
  saveCategorizer(ctx, categorizer);
}
