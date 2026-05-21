import type { TransactionRow } from '../../shared/ipc-types';

export interface TransactionPDFData {
  sheetData: Map<string, TransactionRow[]>;
  orgName?: string;
  logoDataUri?: string;
  accentColor?: string;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtNum(n: number): string {
  return Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

function sortByDate(transactions: TransactionRow[]): TransactionRow[] {
  return [...transactions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at),
  );
}

function signedAmount(t: TransactionRow): number {
  const amt = parseFloat(t.amount) || 0;
  return t.type === 'income' ? amt : -amt;
}

function renderSheetSection(sheetName: string, transactions: TransactionRow[]): string {
  const sorted = sortByDate(transactions);

  let income = 0;
  let expenses = 0;
  let runningBalance = 0;

  const rows = sorted.map((t, i) => {
    const amt = parseFloat(t.amount) || 0;
    if (t.type === 'income') income += amt;
    else expenses += amt;

    const signed = signedAmount(t);
    runningBalance += signed;

    return `<tr class="${i % 2 === 1 ? 'alt' : ''}">
      <td class="date">${esc(fmtDate(t.date))}</td>
      <td class="desc">${esc(t.description || '')}</td>
      <td class="amount ${signed >= 0 ? 'positive' : 'negative'}">${signed >= 0 ? '' : '-'}\u00a3${fmtNum(Math.abs(signed))}</td>
      <td class="type">${esc(t.type)}</td>
      <td class="status">${esc(t.status)}</td>
      <td class="cat">${esc(t.category || '')}</td>
      <td class="party">${esc(t.party || '')}</td>
      <td class="balance">\u00a3${fmtNum(Math.abs(runningBalance))}${runningBalance < 0 ? ' DR' : ''}</td>
    </tr>`;
  }).join('');

  const net = income - expenses;

  return `
    <div class="sheet-section">
      <h2 class="sheet-name">${esc(sheetName)}</h2>
      <table class="tx-table">
        <thead>
          <tr>
            <th class="date">Date</th>
            <th class="desc">Description</th>
            <th class="amount">Amount</th>
            <th class="type">Type</th>
            <th class="status">Status</th>
            <th class="cat">Category</th>
            <th class="party">Party</th>
            <th class="balance">Balance</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="sheet-summary">
        <div class="summary-item"><span class="label">Income</span><span class="value positive">\u00a3${fmtNum(income)}</span></div>
        <div class="summary-item"><span class="label">Expenses</span><span class="value negative">-\u00a3${fmtNum(expenses)}</span></div>
        <div class="summary-item net"><span class="label">Net</span><span class="value">${net >= 0 ? '' : '-'}\u00a3${fmtNum(Math.abs(net))}</span></div>
      </div>
    </div>`;
}

export function renderTransactionsPDFHTML(data: TransactionPDFData): string {
  const accent = data.accentColor || '#89b0ae';
  const today = new Date();
  const dateStr = `${today.getDate()} ${today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`;

  // Grand totals
  let grandIncome = 0;
  let grandExpenses = 0;
  let grandCount = 0;
  for (const txns of data.sheetData.values()) {
    grandCount += txns.length;
    for (const t of txns) {
      const amt = parseFloat(t.amount) || 0;
      if (t.type === 'income') grandIncome += amt;
      else grandExpenses += amt;
    }
  }
  const grandNet = grandIncome - grandExpenses;

  const sections = Array.from(data.sheetData.entries())
    .map(([name, txns]) => renderSheetSection(name, txns))
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
@page { size: A4 landscape; margin: 14mm 16mm 20mm; }
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --accent: ${accent};
  --text-primary: #313e50;
  --text-secondary: #455561;
  --border-muted: #e5e5de;
  --border-light: #eef0eb;
  --row-alt: rgba(242, 242, 236, 0.5);
  --font-sans: 'DM Sans', system-ui, -apple-system, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;
}

body {
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 10px;
  line-height: 1.4;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.report-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-top: 4px solid var(--accent);
  padding-top: 16px;
  margin-bottom: 20px;
}

.report-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.report-logo {
  max-height: 40px;
  max-width: 120px;
  object-fit: contain;
}

.report-title {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--accent);
  text-transform: uppercase;
}

.report-subtitle {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.report-meta {
  text-align: right;
  font-size: 10px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.grand-summary {
  display: flex;
  gap: 24px;
  padding: 10px 16px;
  background: var(--row-alt);
  border: 1px solid var(--border-light);
  border-radius: 4px;
  margin-bottom: 20px;
}

.grand-summary .summary-item {
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.grand-summary .label {
  font-size: 8px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.grand-summary .value {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
}

.positive { color: #16a34a; }
.negative { color: #dc2626; }

/* Sheet sections */
.sheet-section {
  margin-bottom: 24px;
  page-break-inside: avoid;
}

.sheet-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: -0.01em;
  padding-bottom: 6px;
  border-bottom: 2px solid var(--accent);
  margin-bottom: 8px;
}

/* Transaction table */
.tx-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 8px;
}

.tx-table th {
  padding: 5px 6px;
  font-size: 7px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
  border-bottom: 1.5px solid var(--border-muted);
  text-align: left;
}

.tx-table td {
  padding: 4px 6px;
  font-size: 9px;
  color: var(--text-primary);
  border-bottom: 0.5px solid var(--border-light);
}

.tx-table tr.alt {
  background: var(--row-alt);
}

.tx-table .date { width: 70px; }
.tx-table .desc { }
.tx-table .amount {
  width: 80px;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 9px;
}
.tx-table th.amount { text-align: right; }
.tx-table .type { width: 52px; }
.tx-table .status { width: 58px; }
.tx-table .cat { width: 80px; }
.tx-table .party { width: 80px; }
.tx-table .balance {
  width: 80px;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 9px;
}
.tx-table th.balance { text-align: right; }

/* Sheet summary */
.sheet-summary {
  display: flex;
  justify-content: flex-end;
  gap: 20px;
  padding: 6px 0;
}

.sheet-summary .summary-item {
  display: flex;
  gap: 6px;
  align-items: baseline;
}

.sheet-summary .label {
  font-size: 8px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
}

.sheet-summary .value {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
}

.sheet-summary .net .value {
  font-weight: 700;
  font-size: 11px;
  color: var(--accent);
}

</style>
</head>
<body>
  <div class="report-header">
    <div class="report-brand">
      ${data.logoDataUri ? `<img class="report-logo" src="${data.logoDataUri}" />` : ''}
      <div>
        <div class="report-title">Transaction Report</div>
        <div class="report-subtitle">${esc(data.orgName || 'Fidra')}</div>
      </div>
    </div>
    <div class="report-meta">
      <strong>Generated:</strong> ${esc(dateStr)}<br>
      <strong>Sheets:</strong> ${data.sheetData.size}<br>
      <strong>Transactions:</strong> ${grandCount}
    </div>
  </div>

  <div class="grand-summary">
    <div class="summary-item"><span class="label">Total Income</span><span class="value positive">\u00a3${fmtNum(grandIncome)}</span></div>
    <div class="summary-item"><span class="label">Total Expenses</span><span class="value negative">-\u00a3${fmtNum(grandExpenses)}</span></div>
    <div class="summary-item"><span class="label">Net</span><span class="value" style="color:var(--accent);font-size:13px">${grandNet >= 0 ? '' : '-'}\u00a3${fmtNum(Math.abs(grandNet))}</span></div>
  </div>

  ${sections}

</body>
</html>`;
}
