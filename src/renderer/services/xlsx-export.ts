import ExcelJS from 'exceljs';
import type { TransactionRow } from '../../shared/ipc-types';
import { toAmount } from '../../shared/money';

function sortByDate(transactions: TransactionRow[]): TransactionRow[] {
  return [...transactions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at),
  );
}

function signedAmount(t: TransactionRow): number {
  const amt = toAmount(t.amount);
  return t.type === 'income' ? amt : -amt;
}

const COLUMNS = [
  { header: 'Date', key: 'date', width: 13 },
  { header: 'Description', key: 'description', width: 32 },
  { header: 'Amount', key: 'amount', width: 15 },
  { header: 'Type', key: 'type', width: 10 },
  { header: 'Status', key: 'status', width: 11 },
  { header: 'Category', key: 'category', width: 16 },
  { header: 'Party', key: 'party', width: 18 },
  { header: 'Reference', key: 'reference', width: 14 },
  { header: 'Activity', key: 'activity', width: 16 },
  { header: 'Notes', key: 'notes', width: 24 },
  { header: 'Balance', key: 'balance', width: 15 },
];

const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8EDEC' },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  size: 11,
  color: { argb: 'FF313E50' },
};

const CURRENCY_FMT = '£#,##0.00;-£#,##0.00';
const DATE_FMT = 'DD/MM/YYYY';

function addSheetWorksheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  transactions: TransactionRow[],
): void {
  const sorted = sortByDate(transactions);
  const ws = workbook.addWorksheet(sheetName);

  ws.columns = COLUMNS.map((c) => ({ ...c }));

  // Header styling
  const headerRow = ws.getRow(1);
  headerRow.font = HEADER_FONT;
  headerRow.fill = HEADER_FILL;
  headerRow.alignment = { vertical: 'middle' };
  headerRow.height = 22;

  // Data rows
  sorted.forEach((t, i) => {
    const rowNum = i + 2;
    const row = ws.getRow(rowNum);

    // Parse date as Excel serial (avoid timezone issues)
    const [y, m, d] = t.date.split('-').map(Number);
    const dateVal = new Date(y, m - 1, d);

    row.getCell('date').value = dateVal;
    row.getCell('date').numFmt = DATE_FMT;
    row.getCell('description').value = t.description || '';
    row.getCell('amount').value = signedAmount(t);
    row.getCell('amount').numFmt = CURRENCY_FMT;
    row.getCell('type').value = t.type;
    row.getCell('status').value = t.status;
    row.getCell('category').value = t.category || '';
    row.getCell('party').value = t.party || '';
    row.getCell('reference').value = t.reference || '';
    row.getCell('activity').value = t.activity || '';
    row.getCell('notes').value = t.notes || '';

    // Balance formula: running sum of Amount column (C)
    if (i === 0) {
      row.getCell('balance').value = { formula: `C${rowNum}` } as ExcelJS.CellFormulaValue;
    } else {
      row.getCell('balance').value = { formula: `K${rowNum - 1}+C${rowNum}` } as ExcelJS.CellFormulaValue;
    }
    row.getCell('balance').numFmt = CURRENCY_FMT;
  });

  // Freeze header row
  ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2', activeCell: 'A2' }];

  // Summary section below data
  const gapRow = sorted.length + 3; // 1 header + N data + 1 gap
  const dataStart = 2;
  const dataEnd = sorted.length + 1;

  if (sorted.length > 0) {
    const incomeRow = gapRow + 1;
    ws.getRow(incomeRow).getCell('B').value = 'Total Income';
    ws.getRow(incomeRow).getCell('B').font = { bold: true };
    ws.getRow(incomeRow).getCell('C').value = {
      formula: `SUMPRODUCT((D${dataStart}:D${dataEnd}="income")*C${dataStart}:C${dataEnd})`,
    } as ExcelJS.CellFormulaValue;
    ws.getRow(incomeRow).getCell('C').numFmt = CURRENCY_FMT;

    const expenseRow = incomeRow + 1;
    ws.getRow(expenseRow).getCell('B').value = 'Total Expenses';
    ws.getRow(expenseRow).getCell('B').font = { bold: true };
    ws.getRow(expenseRow).getCell('C').value = {
      formula: `SUMPRODUCT((D${dataStart}:D${dataEnd}="expense")*C${dataStart}:C${dataEnd})`,
    } as ExcelJS.CellFormulaValue;
    ws.getRow(expenseRow).getCell('C').numFmt = CURRENCY_FMT;

    const netRow = expenseRow + 1;
    ws.getRow(netRow).getCell('B').value = 'Net';
    ws.getRow(netRow).getCell('B').font = { bold: true, size: 12 };
    ws.getRow(netRow).getCell('C').value = {
      formula: `C${incomeRow}+C${expenseRow}`,
    } as ExcelJS.CellFormulaValue;
    ws.getRow(netRow).getCell('C').numFmt = CURRENCY_FMT;
    ws.getRow(netRow).getCell('C').font = { bold: true, size: 12 };
  }
}

export async function exportXLSX(
  sheetData: Map<string, TransactionRow[]>,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Fidra';
  workbook.created = new Date();

  // Summary worksheet first
  const summaryWs = workbook.addWorksheet('Summary');
  const summaryColumns = [
    { header: 'Sheet', key: 'sheet', width: 24 },
    { header: 'Transactions', key: 'count', width: 14 },
    { header: 'Total Income', key: 'income', width: 16 },
    { header: 'Total Expenses', key: 'expenses', width: 16 },
    { header: 'Net', key: 'net', width: 16 },
  ];
  summaryWs.columns = summaryColumns;

  const summaryHeader = summaryWs.getRow(1);
  summaryHeader.font = HEADER_FONT;
  summaryHeader.fill = HEADER_FILL;
  summaryHeader.height = 22;

  let summaryRowNum = 2;
  for (const [sheetName, txns] of sheetData) {
    const row = summaryWs.getRow(summaryRowNum);
    row.getCell('sheet').value = sheetName;
    row.getCell('count').value = txns.length;

    let income = 0;
    let expenses = 0;
    for (const t of txns) {
      const amt = toAmount(t.amount);
      if (t.type === 'income') income += amt;
      else expenses += amt;
    }

    row.getCell('income').value = income;
    row.getCell('income').numFmt = CURRENCY_FMT;
    row.getCell('expenses').value = -expenses;
    row.getCell('expenses').numFmt = CURRENCY_FMT;
    row.getCell('net').value = income - expenses;
    row.getCell('net').numFmt = CURRENCY_FMT;
    summaryRowNum++;
  }

  // Grand totals row
  if (sheetData.size > 0) {
    const totalsRow = summaryWs.getRow(summaryRowNum + 1);
    totalsRow.getCell('sheet').value = 'TOTAL';
    totalsRow.getCell('sheet').font = { bold: true, size: 12 };
    totalsRow.getCell('count').value = { formula: `SUM(B2:B${summaryRowNum - 1})` } as ExcelJS.CellFormulaValue;
    totalsRow.getCell('count').font = { bold: true };
    totalsRow.getCell('income').value = { formula: `SUM(C2:C${summaryRowNum - 1})` } as ExcelJS.CellFormulaValue;
    totalsRow.getCell('income').numFmt = CURRENCY_FMT;
    totalsRow.getCell('income').font = { bold: true };
    totalsRow.getCell('expenses').value = { formula: `SUM(D2:D${summaryRowNum - 1})` } as ExcelJS.CellFormulaValue;
    totalsRow.getCell('expenses').numFmt = CURRENCY_FMT;
    totalsRow.getCell('expenses').font = { bold: true };
    totalsRow.getCell('net').value = { formula: `SUM(E2:E${summaryRowNum - 1})` } as ExcelJS.CellFormulaValue;
    totalsRow.getCell('net').numFmt = CURRENCY_FMT;
    totalsRow.getCell('net').font = { bold: true, size: 12 };
  }

  summaryWs.views = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2', activeCell: 'A2' }];

  // Per-sheet worksheets
  for (const [sheetName, txns] of sheetData) {
    addSheetWorksheet(workbook, sheetName, txns);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
