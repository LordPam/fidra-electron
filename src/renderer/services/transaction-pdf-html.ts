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

/**
 * Estimate description column width based on content.
 * Returns a CSS width string. Maximum is 280px (landscape A4 budget),
 * minimum is 100px. Uses approximate character-width heuristic at 9px font.
 */
function estimateDescWidth(transactions: TransactionRow[]): string {
  const MAX_PX = 280;
  const MIN_PX = 100;
  const CHAR_WIDTH = 4.8; // approximate px per char at 9px DM Sans
  const PADDING = 12;

  let longest = 0;
  for (const t of transactions) {
    const len = (t.description || '').length;
    if (len > longest) longest = len;
  }

  const estimated = Math.round(longest * CHAR_WIDTH + PADDING);
  const clamped = Math.max(MIN_PX, Math.min(MAX_PX, estimated));
  return `${clamped}px`;
}

function renderSheetSection(sheetName: string, transactions: TransactionRow[], sheetIndex: number): string {
  const sorted = sortByDate(transactions);
  const descWidth = estimateDescWidth(sorted);

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
    <div class="sheet-section${sheetIndex > 0 ? ' page-break' : ''}">
      <h2 class="sheet-name">${esc(sheetName)}</h2>
      <table class="tx-table">
        <colgroup>
          <col style="width:70px">
          <col style="width:${descWidth}">
          <col style="width:80px">
          <col style="width:52px">
          <col style="width:58px">
          <col style="width:80px">
          <col style="width:80px">
          <col style="width:80px">
        </colgroup>
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

  // Table of contents entries
  const tocEntries = Array.from(data.sheetData.entries())
    .map(([name, txns]) => {
      let sheetIncome = 0;
      let sheetExpenses = 0;
      for (const t of txns) {
        const amt = parseFloat(t.amount) || 0;
        if (t.type === 'income') sheetIncome += amt;
        else sheetExpenses += amt;
      }
      const sheetNet = sheetIncome - sheetExpenses;
      return `<tr>
        <td class="toc-name">${esc(name)}</td>
        <td class="toc-count">${txns.length}</td>
        <td class="toc-amount positive">\u00a3${fmtNum(sheetIncome)}</td>
        <td class="toc-amount negative">-\u00a3${fmtNum(sheetExpenses)}</td>
        <td class="toc-amount" style="color:var(--accent);font-weight:600">${sheetNet >= 0 ? '' : '-'}\u00a3${fmtNum(Math.abs(sheetNet))}</td>
      </tr>`;
    }).join('');

  const sections = Array.from(data.sheetData.entries())
    .map(([name, txns], i) => renderSheetSection(name, txns, i))
    .join('');

  const orgName = data.orgName || 'Fidra';

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

.positive { color: #16a34a; }
.negative { color: #dc2626; }

/* ── Cover page ─────────────────────────────────────────── */

.cover {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 80vh;
  text-align: center;
  page-break-after: always;
}

.cover-rule {
  width: 80px;
  height: 4px;
  background: var(--accent);
  border: none;
  border-radius: 2px;
  margin: 24px auto;
}

.cover-logo {
  max-height: 96px;
  max-width: 280px;
  object-fit: contain;
  margin-bottom: 8px;
}

.cover-org {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-top: 8px;
}

.cover-title {
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  margin-top: 4px;
}

.cover-date {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 12px;
}

.cover-summary {
  display: flex;
  gap: 32px;
  justify-content: center;
  margin-top: 32px;
  padding: 14px 28px;
  border-top: 1px solid var(--border-muted);
  border-bottom: 1px solid var(--border-muted);
}

.cover-summary .stat {
  text-align: center;
}

.cover-summary .stat-value {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 700;
}

.cover-summary .stat-label {
  font-size: 8px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
  margin-top: 2px;
}

/* ── Table of contents ──────────────────────────────────── */

.toc {
  page-break-after: always;
}

.toc-heading {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  border-bottom: 3px solid var(--accent);
  padding-bottom: 8px;
  margin-bottom: 16px;
}

.toc-table {
  width: 100%;
  border-collapse: collapse;
}

.toc-table th {
  padding: 6px 8px;
  font-size: 8px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
  border-bottom: 1.5px solid var(--border-muted);
  text-align: left;
}

.toc-table td {
  padding: 8px;
  font-size: 11px;
  border-bottom: 0.5px solid var(--border-light);
}

.toc-name { font-weight: 600; }
.toc-count { width: 80px; text-align: center; color: var(--text-secondary); }
.toc-amount {
  width: 100px;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 10px;
}
.toc-table th.toc-amount,
.toc-table th.toc-count { text-align: center; }

.toc-total {
  font-weight: 700;
  border-top: 2px solid var(--border-muted);
}

/* ── Sheet sections ─────────────────────────────────────── */

.page-break { page-break-before: always; }

.sheet-section {
  margin-bottom: 24px;
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
  table-layout: fixed;
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tx-table tr.alt {
  background: var(--row-alt);
}

.tx-table .amount {
  text-align: right;
  font-family: var(--font-mono);
  font-size: 9px;
}
.tx-table th.amount { text-align: right; }
.tx-table .balance {
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

  <!-- Cover page -->
  <div class="cover">
    ${data.logoDataUri ? `<img class="cover-logo" src="${data.logoDataUri}" />` : ''}
    <div class="cover-org">${esc(orgName)}</div>
    <hr class="cover-rule">
    <div class="cover-title">Transaction Report</div>
    <div class="cover-date">${esc(dateStr)}</div>
    <div class="cover-summary">
      <div class="stat">
        <div class="stat-value">${data.sheetData.size}</div>
        <div class="stat-label">Sheet${data.sheetData.size !== 1 ? 's' : ''}</div>
      </div>
      <div class="stat">
        <div class="stat-value">${grandCount}</div>
        <div class="stat-label">Transaction${grandCount !== 1 ? 's' : ''}</div>
      </div>
      <div class="stat">
        <div class="stat-value positive">\u00a3${fmtNum(grandIncome)}</div>
        <div class="stat-label">Income</div>
      </div>
      <div class="stat">
        <div class="stat-value negative">-\u00a3${fmtNum(grandExpenses)}</div>
        <div class="stat-label">Expenses</div>
      </div>
      <div class="stat">
        <div class="stat-value" style="color:var(--accent)">${grandNet >= 0 ? '' : '-'}\u00a3${fmtNum(Math.abs(grandNet))}</div>
        <div class="stat-label">Net</div>
      </div>
    </div>
  </div>

  <!-- Table of Contents -->
  <div class="toc">
    <h2 class="toc-heading">Contents</h2>
    <table class="toc-table">
      <thead>
        <tr>
          <th>Sheet</th>
          <th class="toc-count">Transactions</th>
          <th class="toc-amount">Income</th>
          <th class="toc-amount">Expenses</th>
          <th class="toc-amount">Net</th>
        </tr>
      </thead>
      <tbody>
        ${tocEntries}
        <tr class="toc-total">
          <td class="toc-name">Total</td>
          <td class="toc-count">${grandCount}</td>
          <td class="toc-amount positive">\u00a3${fmtNum(grandIncome)}</td>
          <td class="toc-amount negative">-\u00a3${fmtNum(grandExpenses)}</td>
          <td class="toc-amount" style="color:var(--accent);font-weight:700">${grandNet >= 0 ? '' : '-'}\u00a3${fmtNum(Math.abs(grandNet))}</td>
        </tr>
      </tbody>
    </table>
  </div>

  ${sections}

</body>
</html>`;
}
