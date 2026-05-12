// ─── CSV Import Types ────────────────────────────────────────────────

/** Maps CSV column indices to Fidra fields. -1 means unmapped. */
export interface CsvColumnMapping {
  date: number;
  description: number;
  amount: number;
  debit: number;
  credit: number;
  typeIndicator: number;
  reference: number;
  party: number;
  notes: number;
  category: number;
}

export type AmountMode = 'signed' | 'debit-credit' | 'amount-with-indicator';
export type SignConvention = 'positive-income' | 'positive-expense';

export interface CsvImportProfile {
  id: string;
  name: string;
  columnMapping: CsvColumnMapping;
  amountMode: AmountMode;
  signConvention: SignConvention;
  dateFormat: string | null;
  decimalSeparator: '.' | ',';
  skipRows: number;
  encoding: string;
  createdAt: string;
  updatedAt: string;
}

export interface ParsedCsvRow {
  rowIndex: number;
  rawValues: string[];
  date: string | null;
  description: string | null;
  amount: number | null;
  type: 'income' | 'expense' | null;
  reference: string | null;
  party: string | null;
  notes: string | null;
  category: string | null;
  parseErrors: string[];
}

export interface DuplicateMatch {
  matchType: 'exact' | 'content' | 'fuzzy' | 'none';
  matchedTransactionIds: string[];
  confidence: number;
  reason: string;
}

export interface CategoryPrediction {
  category: string | null;
  type: 'income' | 'expense' | null;
  confidence: number;
  source: 'bayesian' | 'party-mapping' | 'description-mapping' | 'none';
  /** Suggested description based on past imports/edits */
  suggestedDescription: string | null;
  /** Suggested party based on past imports/edits */
  suggestedParty: string | null;
}

export interface ImportPreviewRow {
  parsed: ParsedCsvRow;
  prediction: CategoryPrediction;
  duplicateMatch: DuplicateMatch;
  include: boolean;
  userOverrides: {
    category?: string | null;
    type?: 'income' | 'expense';
    description?: string;
    party?: string | null;
    status?: '--' | 'pending' | 'approved';
  };
}

export interface CsvImportResult {
  importedCount: number;
  skippedDuplicates: number;
  skippedErrors: number;
  createdTransactionIds: string[];
}

// ─── IPC request / response types ────────────────────────────────────

export interface CsvParseRequest {
  filePath: string;
  profileId?: string;
  encoding?: string;
}

export interface CsvParseResponse {
  headers: string[];
  sampleRows: string[][];
  totalRowCount: number;
  detectedMapping: CsvColumnMapping;
  detectedAmountMode: AmountMode;
  detectedDateFormat: string | null;
  detectedDecimalSeparator: '.' | ',';
}

export interface CsvAnalyzeRequest {
  filePath: string;
  columnMapping: CsvColumnMapping;
  amountMode: AmountMode;
  signConvention: SignConvention;
  dateFormat: string | null;
  decimalSeparator: '.' | ',';
  skipRows: number;
  encoding?: string;
  targetSheet: string;
  defaultStatus: '--' | 'pending' | 'approved';
}

export interface CsvAnalyzeResponse {
  previewRows: ImportPreviewRow[];
  summary: {
    total: number;
    newRows: number;
    duplicates: number;
    errors: number;
  };
}

export interface CsvCommitRequest {
  rows: ImportPreviewRow[];
  targetSheet: string;
  defaultStatus: '--' | 'pending' | 'approved';
}
