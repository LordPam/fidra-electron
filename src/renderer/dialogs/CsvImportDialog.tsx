import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { InlineAutocomplete } from '@/components/InlineAutocomplete';
import { cn } from '@/lib/utils';
import {
  FileUp,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  Save,
  X,
} from 'lucide-react';
import type {
  CsvColumnMapping,
  AmountMode,
  SignConvention,
  CsvParseResponse,
  CsvAnalyzeResponse,
  ImportPreviewRow,
  CsvImportProfile,
  CsvImportResult,
} from '../../shared/csv-import-types';
import type { TransactionRow } from '../../shared/ipc-types';
import { defaultStatusForType } from '../../shared/transaction-rules';

// ─── Field options for column mapping dropdowns ──────────────────────

const FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: 'skip', label: '(Skip)' },
  { value: 'date', label: 'Date' },
  { value: 'description', label: 'Description' },
  { value: 'amount', label: 'Amount' },
  { value: 'debit', label: 'Debit' },
  { value: 'credit', label: 'Credit' },
  { value: 'typeIndicator', label: 'Type Indicator' },
  { value: 'reference', label: 'Reference' },
  { value: 'party', label: 'Party' },
  { value: 'notes', label: 'Notes' },
  { value: 'category', label: 'Category' },
];

const MAPPING_FIELDS = ['date', 'description', 'amount', 'debit', 'credit', 'typeIndicator', 'reference', 'party', 'notes', 'category'] as const;

type Step = 'file' | 'mapping' | 'config' | 'preview' | 'importing' | 'complete';

interface CsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sheets: string[];
  currentSheet: string;
  categories: { income: string[]; expense: string[] };
  descriptionSuggestions: string[];
  partySuggestions: string[];
  onImported: (transactions: TransactionRow[]) => void;
}

export function CsvImportDialog({
  open,
  onOpenChange,
  sheets,
  currentSheet,
  categories,
  descriptionSuggestions,
  partySuggestions,
  onImported,
}: CsvImportDialogProps) {
  const [step, setStep] = useState<Step>('file');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [profiles, setProfiles] = useState<CsvImportProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');

  // Mapping state
  const [parseResponse, setParseResponse] = useState<CsvParseResponse | null>(null);
  const [mapping, setMapping] = useState<CsvColumnMapping | null>(null);
  const [amountMode, setAmountMode] = useState<AmountMode>('signed');
  const [signConvention, setSignConvention] = useState<SignConvention>('positive-expense');

  // Config state
  const [targetSheet, setTargetSheet] = useState(currentSheet);
  const [defaultStatus, setDefaultStatus] = useState<'--' | 'pending' | 'approved'>('pending');
  const [dateFormat, setDateFormat] = useState<string | null>(null);
  const [decimalSeparator, setDecimalSeparator] = useState<'.' | ','>('.');

  // Preview state
  const [analyzeResponse, setAnalyzeResponse] = useState<CsvAnalyzeResponse | null>(null);
  const [previewRows, setPreviewRows] = useState<ImportPreviewRow[]>([]);

  // Result state
  const [importResult, setImportResult] = useState<CsvImportResult | null>(null);
  const [importedTransactions, setImportedTransactions] = useState<TransactionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load profiles on open
  useEffect(() => {
    if (open) {
      window.api.csvImportGetProfiles().then(setProfiles).catch(console.error);
      setStep('file');
      setFilePath(null);
      setFileName('');
      setSelectedProfileId('');
      setParseResponse(null);
      setMapping(null);
      setAnalyzeResponse(null);
      setPreviewRows([]);
      setImportResult(null);
      setImportedTransactions([]);
      setError(null);
      setTargetSheet(currentSheet);
    }
  }, [open, currentSheet]);

  // ─── Step 1: File Selection ──────────────────────────────────────

  const handleSelectFile = useCallback(async () => {
    const result = await window.api.showOpenDialog({
      title: 'Select CSV file',
      filters: [{ name: 'CSV Files', extensions: ['csv', 'tsv', 'txt'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return;

    const path = result.filePaths[0];
    setFilePath(path);
    setFileName(path.split(/[\\/]/).pop() ?? path);
    setError(null);
    setLoading(true);

    try {
      const response = await window.api.csvImportParse({
        filePath: path,
        profileId: selectedProfileId || undefined,
      });
      setParseResponse(response);
      setMapping(response.detectedMapping);
      setAmountMode(response.detectedAmountMode);
      setDateFormat(response.detectedDateFormat);
      setDecimalSeparator(response.detectedDecimalSeparator);
      setStep('mapping');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedProfileId]);

  // ─── Step 2: Column Mapping ──────────────────────────────────────

  const handleMappingChange = useCallback((colIndex: number, field: string) => {
    setMapping((prev) => {
      if (!prev) return prev;
      const updated = { ...prev };
      // Clear any existing assignment of this field
      for (const key of MAPPING_FIELDS) {
        if (updated[key] === colIndex) updated[key] = -1;
      }
      // Assign new field
      if (field !== 'skip') {
        // Clear previous column for this field
        for (const key of MAPPING_FIELDS) {
          if (key === field) updated[key] = -1;
        }
        (updated as Record<string, number>)[field] = colIndex;
      }
      return updated;
    });
  }, []);

  const getFieldForColumn = useCallback((colIndex: number): string => {
    if (!mapping) return 'skip';
    for (const key of MAPPING_FIELDS) {
      if (mapping[key] === colIndex) return key;
    }
    return 'skip';
  }, [mapping]);

  // ─── Step 3 → 4: Analyze ────────────────────────────────────────

  const handleAnalyze = useCallback(async () => {
    if (!filePath || !mapping) return;
    setLoading(true);
    setError(null);

    try {
      const response = await window.api.csvImportAnalyze({
        filePath,
        columnMapping: mapping,
        amountMode,
        signConvention,
        dateFormat,
        decimalSeparator,
        skipRows: 0,
        targetSheet,
        defaultStatus,
      });
      setAnalyzeResponse(response);
      setPreviewRows(response.previewRows);
      setStep('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filePath, mapping, amountMode, signConvention, dateFormat, decimalSeparator, targetSheet, defaultStatus]);

  // ─── Step 4: Preview toggles ─────────────────────────────────────

  const toggleRow = useCallback((index: number) => {
    setPreviewRows((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], include: !updated[index].include };
      return updated;
    });
  }, []);

  const selectAll = useCallback(() => {
    setPreviewRows((prev) => prev.map((r) => ({
      ...r,
      include: r.parsed.parseErrors.length === 0,
    })));
  }, []);

  const deselectAll = useCallback(() => {
    setPreviewRows((prev) => prev.map((r) => ({ ...r, include: false })));
  }, []);

  const deselectDuplicates = useCallback(() => {
    setPreviewRows((prev) => prev.map((r) => ({
      ...r,
      include: r.duplicateMatch.matchType !== 'none' ? false : r.include,
    })));
  }, []);

  const updateRowOverrides = useCallback((index: number, overrides: Partial<ImportPreviewRow['userOverrides']>) => {
    setPreviewRows((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        userOverrides: { ...updated[index].userOverrides, ...overrides },
      };
      return updated;
    });
  }, []);

  const previewSummary = useMemo(() => {
    const included = previewRows.filter((r) => r.include).length;
    const duplicates = previewRows.filter((r) => r.duplicateMatch.matchType !== 'none').length;
    const errors = previewRows.filter((r) => r.parsed.parseErrors.length > 0).length;
    return { included, duplicates, errors, total: previewRows.length };
  }, [previewRows]);

  // ─── Step 5: Commit ──────────────────────────────────────────────

  const handleCommit = useCallback(async () => {
    setStep('importing');
    setError(null);

    try {
      const result = await window.api.csvImportCommit({
        rows: previewRows,
        targetSheet,
        defaultStatus,
      });
      setImportResult(result);

      // Fetch the created transactions for undo support
      const created: TransactionRow[] = [];
      for (const id of result.createdTransactionIds) {
        const tx = await window.api.getTransaction(id);
        if (tx) created.push(tx);
      }
      setImportedTransactions(created);
      setStep('complete');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('preview');
    }
  }, [previewRows, targetSheet, defaultStatus]);

  // ─── Step 6: Complete — save profile ─────────────────────────────

  const [showSaveProfile, setShowSaveProfile] = useState(false);
  const [profileName, setProfileName] = useState('');

  const handleSaveProfile = useCallback(async () => {
    if (!mapping || !profileName.trim()) return;
    const profile: CsvImportProfile = {
      id: crypto.randomUUID(),
      name: profileName.trim(),
      columnMapping: mapping,
      amountMode,
      signConvention,
      dateFormat,
      decimalSeparator,
      skipRows: 0,
      encoding: 'utf-8',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await window.api.csvImportSaveProfile(profile);
    setShowSaveProfile(false);
    setProfileName('');
  }, [mapping, profileName, amountMode, signConvention, dateFormat, decimalSeparator]);

  const handleClose = useCallback(() => {
    if (importedTransactions.length > 0) {
      onImported(importedTransactions);
    }
    onOpenChange(false);
  }, [importedTransactions, onImported, onOpenChange]);

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" />
            Import CSV
            {step !== 'file' && step !== 'complete' && (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                {fileName}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="bg-destructive/10 text-destructive px-3 py-2 rounded-md text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex-1 overflow-hidden">
          {step === 'file' && (
            <StepFile
              profiles={profiles}
              selectedProfileId={selectedProfileId}
              onSelectProfile={setSelectedProfileId}
              onSelectFile={handleSelectFile}
              loading={loading}
            />
          )}

          {step === 'mapping' && parseResponse && mapping && (
            <StepMapping
              headers={parseResponse.headers}
              sampleRows={parseResponse.sampleRows}
              mapping={mapping}
              amountMode={amountMode}
              signConvention={signConvention}
              onMappingChange={handleMappingChange}
              onAmountModeChange={setAmountMode}
              onSignConventionChange={setSignConvention}
              getFieldForColumn={getFieldForColumn}
            />
          )}

          {step === 'config' && (
            <StepConfig
              sheets={sheets}
              targetSheet={targetSheet}
              defaultStatus={defaultStatus}
              dateFormat={dateFormat}
              decimalSeparator={decimalSeparator}
              onTargetSheetChange={setTargetSheet}
              onDefaultStatusChange={setDefaultStatus}
              onDateFormatChange={setDateFormat}
              onDecimalSeparatorChange={setDecimalSeparator}
            />
          )}

          {step === 'preview' && (
            <StepPreview
              previewRows={previewRows}
              summary={previewSummary}
              categories={categories}
              descriptionSuggestions={descriptionSuggestions}
              partySuggestions={partySuggestions}
              onToggleRow={toggleRow}
              onSelectAll={selectAll}
              onDeselectAll={deselectAll}
              onDeselectDuplicates={deselectDuplicates}
              onUpdateRow={updateRowOverrides}
            />
          )}

          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Importing transactions...</p>
            </div>
          )}

          {step === 'complete' && importResult && (
            <StepComplete
              result={importResult}
              showSaveProfile={showSaveProfile}
              profileName={profileName}
              onToggleSaveProfile={() => setShowSaveProfile(!showSaveProfile)}
              onProfileNameChange={setProfileName}
              onSaveProfile={handleSaveProfile}
              selectedProfileId={selectedProfileId}
            />
          )}
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          <div>
            {(step === 'mapping' || step === 'config' || step === 'preview') && (
              <Button
                variant="outline"
                onClick={() => {
                  if (step === 'mapping') setStep('file');
                  else if (step === 'config') setStep('mapping');
                  else if (step === 'preview') setStep('config');
                }}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {step === 'complete' ? (
              <Button onClick={handleClose}>
                Close
              </Button>
            ) : step === 'mapping' ? (
              <Button onClick={() => setStep('config')} disabled={!mapping || mapping.date === -1}>
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : step === 'config' ? (
              <Button onClick={handleAnalyze} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Analyze
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : step === 'preview' ? (
              <Button onClick={handleCommit} disabled={previewSummary.included === 0}>
                Import {previewSummary.included} Transaction{previewSummary.included !== 1 ? 's' : ''}
              </Button>
            ) : step !== 'importing' ? (
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Step Components ─────────────────────────────────────────────────

function StepFile({
  profiles,
  selectedProfileId,
  onSelectProfile,
  onSelectFile,
  loading,
}: {
  profiles: CsvImportProfile[];
  selectedProfileId: string;
  onSelectProfile: (id: string) => void;
  onSelectFile: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-6">
      <div className="text-center space-y-2">
        <FileUp className="h-12 w-12 mx-auto text-muted-foreground" />
        <p className="text-lg font-medium">Select a CSV file to import</p>
        <p className="text-sm text-muted-foreground">
          Bank statements, exports from other apps, or any CSV with transaction data
        </p>
      </div>

      {profiles.length > 0 && (
        <div className="w-64">
          <Label className="text-xs text-muted-foreground mb-1">Saved Profile</Label>
          <Select value={selectedProfileId} onValueChange={onSelectProfile}>
            <SelectTrigger>
              <SelectValue placeholder="Auto-detect columns" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto-detect columns</SelectItem>
              {profiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Button onClick={onSelectFile} disabled={loading} size="lg">
        {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileUp className="h-4 w-4 mr-2" />}
        Choose File
      </Button>
    </div>
  );
}

function StepMapping({
  headers,
  sampleRows,
  mapping,
  amountMode,
  signConvention,
  onMappingChange,
  onAmountModeChange,
  onSignConventionChange,
  getFieldForColumn,
}: {
  headers: string[];
  sampleRows: string[][];
  mapping: CsvColumnMapping;
  amountMode: AmountMode;
  signConvention: SignConvention;
  onMappingChange: (colIndex: number, field: string) => void;
  onAmountModeChange: (mode: AmountMode) => void;
  onSignConventionChange: (conv: SignConvention) => void;
  getFieldForColumn: (colIndex: number) => string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div>
          <Label className="text-xs text-muted-foreground">Amount Mode</Label>
          <Select value={amountMode} onValueChange={(v) => onAmountModeChange(v as AmountMode)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="signed">Single signed column</SelectItem>
              <SelectItem value="debit-credit">Separate debit/credit</SelectItem>
              <SelectItem value="amount-with-indicator">Amount + type column</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {amountMode === 'signed' && (
          <div>
            <Label className="text-xs text-muted-foreground">Sign Convention</Label>
            <Select value={signConvention} onValueChange={(v) => onSignConventionChange(v as SignConvention)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="positive-expense">Positive = expense</SelectItem>
                <SelectItem value="positive-income">Positive = income</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <ScrollArea className="h-[350px] border rounded-md">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface-raised z-10">
              <tr>
                {headers.map((h, i) => (
                  <th key={i} className="px-2 py-1 text-left border-b min-w-[120px]">
                    <Select
                      value={getFieldForColumn(i)}
                      onValueChange={(v) => onMappingChange(i, v)}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FIELD_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value} className="text-xs">
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </th>
                ))}
              </tr>
              <tr className="text-muted-foreground">
                {headers.map((h, i) => (
                  <th key={i} className="px-2 py-1 text-left border-b font-normal truncate max-w-[150px]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sampleRows.map((row, ri) => (
                <tr key={ri} className="border-b border-border/50">
                  {headers.map((_, ci) => (
                    <td key={ci} className="px-2 py-1 truncate max-w-[150px]">
                      {row[ci] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ScrollArea>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex gap-2 items-center flex-wrap">
          <span>Mapped: </span>
          {MAPPING_FIELDS.filter((f) => mapping[f] >= 0).map((f) => (
            <Badge key={f} variant="secondary" className="text-xs">
              {f}: {headers[mapping[f]] ?? `col ${mapping[f]}`}
            </Badge>
          ))}
          {MAPPING_FIELDS.every((f) => mapping[f] === -1) && (
            <span className="text-amber-500">No columns mapped</span>
          )}
        </div>
        <span>{sampleRows.length} row{sampleRows.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}

function StepConfig({
  sheets,
  targetSheet,
  defaultStatus,
  dateFormat,
  decimalSeparator,
  onTargetSheetChange,
  onDefaultStatusChange,
  onDateFormatChange,
  onDecimalSeparatorChange,
}: {
  sheets: string[];
  targetSheet: string;
  defaultStatus: '--' | 'pending' | 'approved';
  dateFormat: string | null;
  decimalSeparator: '.' | ',';
  onTargetSheetChange: (s: string) => void;
  onDefaultStatusChange: (s: '--' | 'pending' | 'approved') => void;
  onDateFormatChange: (f: string | null) => void;
  onDecimalSeparatorChange: (s: '.' | ',') => void;
}) {
  return (
    <div className="space-y-6 py-4">
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label>Target Sheet</Label>
          <Select value={targetSheet} onValueChange={onTargetSheetChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sheets.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Default Status</Label>
          <Select value={defaultStatus} onValueChange={(v) => onDefaultStatusChange(v as '--' | 'pending' | 'approved')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="--">Auto</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Date Format</Label>
          <Input
            value={dateFormat ?? ''}
            onChange={(e) => onDateFormatChange(e.target.value || null)}
            placeholder="Auto-detected"
          />
          <p className="text-xs text-muted-foreground">
            {dateFormat ? `Detected: ${dateFormat}` : 'Will attempt auto-detection'}
          </p>
        </div>

        <div className="space-y-2">
          <Label>Decimal Separator</Label>
          <Select value={decimalSeparator} onValueChange={(v) => onDecimalSeparatorChange(v as '.' | ',')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value=".">Dot (1,234.56)</SelectItem>
              <SelectItem value=",">Comma (1.234,56)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

function StepPreview({
  previewRows,
  summary,
  categories,
  descriptionSuggestions,
  partySuggestions,
  onToggleRow,
  onSelectAll,
  onDeselectAll,
  onDeselectDuplicates,
  onUpdateRow,
}: {
  previewRows: ImportPreviewRow[];
  summary: { included: number; duplicates: number; errors: number; total: number };
  categories: { income: string[]; expense: string[] };
  descriptionSuggestions: string[];
  partySuggestions: string[];
  onToggleRow: (index: number) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDeselectDuplicates: () => void;
  onUpdateRow: (index: number, overrides: Partial<ImportPreviewRow['userOverrides']>) => void;
}) {
  const allCategories = useMemo(() => {
    const set = new Set([...categories.income, ...categories.expense]);
    return Array.from(set).sort();
  }, [categories]);

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm">
          <Badge variant="default">{summary.included} new</Badge>
          {summary.duplicates > 0 && (
            <Badge variant="secondary" className="text-amber-600">
              <Copy className="h-3 w-3 mr-1" />
              {summary.duplicates} duplicate{summary.duplicates !== 1 ? 's' : ''}
            </Badge>
          )}
          {summary.errors > 0 && (
            <Badge variant="destructive">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {summary.errors} error{summary.errors !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onSelectAll} className="text-xs h-7">
            Select All
          </Button>
          <Button variant="ghost" size="sm" onClick={onDeselectAll} className="text-xs h-7">
            Deselect All
          </Button>
          {summary.duplicates > 0 && (
            <Button variant="ghost" size="sm" onClick={onDeselectDuplicates} className="text-xs h-7">
              Deselect Duplicates
            </Button>
          )}
        </div>
      </div>

      {/* Preview table */}
      <ScrollArea className="h-[350px] border rounded-md">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-raised z-10">
            <tr>
              <th className="px-2 py-1.5 text-left w-8 border-b"></th>
              <th className="px-2 py-1.5 text-left border-b">Date</th>
              <th className="px-2 py-1.5 text-left border-b">Description</th>
              <th className="px-2 py-1.5 text-left border-b">Party</th>
              <th className="px-2 py-1.5 text-right border-b">Amount</th>
              <th className="px-2 py-1.5 text-left border-b">Type</th>
              <th className="px-2 py-1.5 text-left border-b">Category</th>
              <th className="px-2 py-1.5 text-center border-b w-8">Status</th>
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, i) => {
              const isDuplicate = row.duplicateMatch.matchType !== 'none';
              const hasError = row.parsed.parseErrors.length > 0;
              const displayDesc = row.userOverrides.description ?? row.parsed.description ?? '';
              const displayParty = row.userOverrides.party !== undefined ? (row.userOverrides.party ?? '') : (row.parsed.party ?? '');
              const displayCategory = row.userOverrides.category !== undefined ? row.userOverrides.category : (row.prediction.category ?? row.parsed.category ?? null);
              const descWasChanged = row.userOverrides.description != null && row.userOverrides.description !== row.parsed.description;
              const partyWasChanged = row.userOverrides.party !== undefined && row.userOverrides.party !== row.parsed.party;

              return (
                <TooltipProvider key={i}>
                  <tr
                    className={cn(
                      'border-b border-border/30 transition-colors',
                      !row.include && 'opacity-40',
                      isDuplicate && 'bg-amber-500/5',
                      hasError && 'bg-destructive/5',
                    )}
                  >
                    <td className="px-2 py-1">
                      <Checkbox
                        checked={row.include}
                        onCheckedChange={() => onToggleRow(i)}
                        disabled={hasError}
                        className="h-3.5 w-3.5"
                      />
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">{row.parsed.date ?? '—'}</td>
                    {/* Editable description with autocomplete */}
                    <td className="px-1 py-0.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div>
                            <InlineAutocomplete
                              value={displayDesc}
                              onChange={(val) => onUpdateRow(i, { description: val })}
                              suggestions={descriptionSuggestions}
                              className={cn(
                                'min-w-[140px] max-w-[200px]',
                                descWasChanged && 'text-blue-600 dark:text-blue-400',
                              )}
                            />
                          </div>
                        </TooltipTrigger>
                        {descWasChanged && (
                          <TooltipContent side="top" className="text-xs">
                            Bank: {row.parsed.description}
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </td>
                    {/* Editable party with autocomplete */}
                    <td className="px-1 py-0.5">
                      <InlineAutocomplete
                        value={displayParty}
                        onChange={(val) => onUpdateRow(i, { party: val || null })}
                        suggestions={partySuggestions}
                        placeholder="—"
                        className={cn(
                          'min-w-[80px] max-w-[130px]',
                          partyWasChanged && 'text-blue-600 dark:text-blue-400',
                        )}
                      />
                    </td>
                    <td className="px-2 py-1 text-right whitespace-nowrap font-mono">
                      {row.parsed.amount != null ? row.parsed.amount.toFixed(2) : '—'}
                    </td>
                    <td className="px-2 py-1">
                      {(row.userOverrides.type ?? row.prediction.type ?? row.parsed.type) ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] px-1.5 py-0 cursor-pointer select-none',
                            (row.userOverrides.type ?? row.prediction.type ?? row.parsed.type) === 'income'
                              ? 'text-green-600 border-green-300' : 'text-red-600 border-red-300',
                          )}
                          onClick={() => {
                            const current = row.userOverrides.type ?? row.prediction.type ?? row.parsed.type ?? 'expense';
                            const newType = current === 'income' ? 'expense' : 'income';
                            onUpdateRow(i, { type: newType, status: defaultStatusForType(newType) });
                          }}
                        >
                          {row.userOverrides.type ?? row.prediction.type ?? row.parsed.type}
                        </Badge>
                      ) : '—'}
                    </td>
                    {/* Editable category with autocomplete */}
                    <td className="px-1 py-0.5">
                      <InlineAutocomplete
                        value={displayCategory ?? ''}
                        onChange={(val) => onUpdateRow(i, { category: val || null })}
                        suggestions={allCategories}
                        placeholder="—"
                        className="min-w-[100px] max-w-[140px]"
                      />
                    </td>
                    <td className="px-2 py-1 text-center">
                      {isDuplicate ? (
                        <Tooltip>
                          <TooltipTrigger>
                            <Copy className="h-3.5 w-3.5 text-amber-500" />
                          </TooltipTrigger>
                          <TooltipContent side="left" className="text-xs max-w-[200px]">
                            {row.duplicateMatch.reason}
                          </TooltipContent>
                        </Tooltip>
                      ) : hasError ? (
                        <Tooltip>
                          <TooltipTrigger>
                            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                          </TooltipTrigger>
                          <TooltipContent side="left" className="text-xs max-w-[200px]">
                            {row.parsed.parseErrors.join(', ')}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                      )}
                    </td>
                  </tr>
                </TooltipProvider>
              );
            })}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

function StepComplete({
  result,
  showSaveProfile,
  profileName,
  onToggleSaveProfile,
  onProfileNameChange,
  onSaveProfile,
  selectedProfileId,
}: {
  result: CsvImportResult;
  showSaveProfile: boolean;
  profileName: string;
  onToggleSaveProfile: () => void;
  onProfileNameChange: (name: string) => void;
  onSaveProfile: () => void;
  selectedProfileId: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-6">
      <CheckCircle2 className="h-12 w-12 text-green-500" />
      <div className="text-center space-y-1">
        <p className="text-lg font-medium">Import Complete</p>
        <p className="text-sm text-muted-foreground">
          Imported {result.importedCount} transaction{result.importedCount !== 1 ? 's' : ''}.
          {result.skippedDuplicates > 0 && ` ${result.skippedDuplicates} duplicates skipped.`}
          {result.skippedErrors > 0 && ` ${result.skippedErrors} errors skipped.`}
        </p>
      </div>

      {!selectedProfileId && (
        <div className="w-72 space-y-2">
          {!showSaveProfile ? (
            <Button variant="outline" onClick={onToggleSaveProfile} className="w-full">
              <Save className="h-4 w-4 mr-2" />
              Save as Profile
            </Button>
          ) : (
            <div className="space-y-2">
              <Input
                value={profileName}
                onChange={(e) => onProfileNameChange(e.target.value)}
                placeholder="Profile name (e.g. Bank of Scotland)"
                autoFocus
              />
              <div className="flex gap-2">
                <Button onClick={onSaveProfile} disabled={!profileName.trim()} className="flex-1">
                  Save
                </Button>
                <Button variant="outline" onClick={onToggleSaveProfile}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
