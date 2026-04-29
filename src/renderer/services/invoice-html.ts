export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface InvoiceData {
  fromName: string;
  fromAddress: string;
  toName: string;
  toAddress: string;
  invoiceNumber: string;
  date: string;
  dueDate: string;
  lineItems: InvoiceLineItem[];
  notes: string;
  bankDetails?: string;
  isOverdue?: boolean;
  logoDataUri?: string;
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
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function nl2br(s: string): string {
  return esc(s).replace(/\n/g, '<br>');
}

export function renderInvoiceHTML(data: InvoiceData): string {
  const {
    fromName,
    fromAddress,
    toName,
    toAddress,
    invoiceNumber,
    date,
    dueDate,
    lineItems,
    notes,
    bankDetails,
    isOverdue,
    logoDataUri,
  } = data;

  const subtotal = lineItems.reduce((s, item) => s + item.quantity * item.unitPrice, 0);

  const itemRows = lineItems
    .map(
      (item) => `<tr>
      <td class="description">${esc(item.description)}</td>
      <td class="qty">${item.quantity}</td>
      <td class="rate">\u00a3${fmtNum(item.unitPrice)}</td>
      <td class="amount">\u00a3${fmtNum(item.quantity * item.unitPrice)}</td>
    </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
@page { size: A4; margin: 20mm 18mm 24mm; }
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --invoice-bg: #ffffff;
  --text-primary: #313e50;
  --text-secondary: #455561;
  --accent: #89b0ae;
  --border-muted: #e5e5de;
  --border-light: #eef0eb;
  --row-alt: rgba(242, 242, 236, 0.5);
  --font-sans: 'DM Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

body {
  background: var(--invoice-bg);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.5;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.invoice-document {
  width: 680px;
  min-height: 960px;
  border-top: 4px solid var(--accent);
  padding: 52px 60px;
}

.invoice-section-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--accent);
  margin-bottom: 8px;
}

/* Header */
.invoice-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 36px;
}
.invoice-logo {
  max-height: 52px;
  max-width: 140px;
  object-fit: contain;
  display: block;
}
.invoice-brand-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}
.invoice-title-block { text-align: right; }
.invoice-title {
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--accent);
  line-height: 1;
  text-transform: uppercase;
}
.invoice-number {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-top: 6px;
}
.invoice-date-block {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 10px;
  line-height: 1.7;
}
.invoice-date-block strong {
  color: var(--text-primary);
  font-weight: 700;
}

/* Overdue */
.overdue-badge {
  display: inline-block;
  background: #dc2626;
  color: #fff;
  font-size: 7pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  padding: 2px 8px;
  border-radius: 3px;
  margin-left: 8px;
  vertical-align: middle;
}
.due-date-overdue { color: #dc2626; }

/* Party grid */
.invoice-divider {
  height: 1px;
  background: var(--border-muted);
  border: none;
  margin: 28px 0;
}
.invoice-party-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 28px;
  margin-bottom: 8px;
}
.invoice-party-name {
  font-weight: 600;
  margin-bottom: 2px;
}
.invoice-address {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.7;
  white-space: pre-line;
}

/* Items table */
.invoice-items-table {
  width: 100%;
  border-collapse: collapse;
}
.invoice-items-table thead tr {
  border-bottom: 2px solid var(--border-muted);
}
.invoice-items-table th {
  padding: 10px 8px;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}
.invoice-items-table td {
  padding: 12px 8px;
  font-size: 13px;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-light);
}
.invoice-items-table tbody tr:nth-child(even) {
  background: var(--row-alt);
}
.invoice-items-table .description { text-align: left; }
.invoice-items-table .qty {
  width: 56px;
  text-align: center;
  color: var(--text-secondary);
}
.invoice-items-table .rate {
  width: 110px;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 12px;
}
.invoice-items-table .amount {
  width: 120px;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 12px;
}
.invoice-items-table th.qty { text-align: center; }
.invoice-items-table th.rate,
.invoice-items-table th.amount { text-align: right; }

/* Totals */
.invoice-totals-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
  margin-bottom: 36px;
}
.invoice-totals { width: 288px; }
.invoice-total-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.invoice-total-row-label {
  font-size: 12px;
  color: var(--text-secondary);
}
.invoice-total-row-value {
  font-size: 12px;
  color: var(--text-primary);
  font-family: var(--font-mono);
}
.invoice-total-divider {
  height: 1px;
  background: var(--border-muted);
  margin: 12px 0;
}
.invoice-grand-total {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.invoice-grand-total-label {
  font-size: 13px;
  font-weight: 700;
}
.invoice-grand-total-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--accent);
  font-family: var(--font-mono);
}

/* Footer */
.invoice-footer-divider {
  height: 1px;
  background: var(--border-muted);
  margin-bottom: 24px;
}
.invoice-footer-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 28px;
}
.invoice-payment-detail {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.invoice-terms {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.65;
}

</style>
</head>
<body>
  <div class="invoice-document">
    <header class="invoice-header">
      <div>
        ${logoDataUri ? `<img class="invoice-logo" src="${logoDataUri}" />` : ''}
        <div class="invoice-brand-name">${esc(fromName || 'Fidra')}</div>
      </div>
      <div class="invoice-title-block">
        <div class="invoice-title">Invoice</div>
        <div class="invoice-number">${esc(invoiceNumber)}</div>
        <div class="invoice-date-block">
          <strong>Date:</strong> ${esc(fmtDate(date))}<br>
          <span${isOverdue ? ' class="due-date-overdue"' : ''}><strong>Due:</strong> ${esc(fmtDate(dueDate))}${isOverdue ? '<span class="overdue-badge">Overdue</span>' : ''}</span>
        </div>
      </div>
    </header>

    <hr class="invoice-divider">

    <div class="invoice-party-grid">
      <div>
        <div class="invoice-section-label">From</div>
        <div class="invoice-party-name">${esc(fromName)}</div>
        <div class="invoice-address">${nl2br(fromAddress)}</div>
      </div>
      <div>
        <div class="invoice-section-label">Bill To</div>
        <div class="invoice-party-name">${esc(toName)}</div>
        <div class="invoice-address">${nl2br(toAddress)}</div>
      </div>
    </div>

    <hr class="invoice-divider">

    <table class="invoice-items-table">
      <thead>
        <tr>
          <th class="description">Description</th>
          <th class="qty">Qty</th>
          <th class="rate">Rate</th>
          <th class="amount">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>

    <div class="invoice-totals-wrapper">
      <div class="invoice-totals">
        <div class="invoice-total-row">
          <span class="invoice-total-row-label">Subtotal</span>
          <span class="invoice-total-row-value">\u00a3${fmtNum(subtotal)}</span>
        </div>
        <!-- VAT placeholder: uncomment when InvoiceData gains a tax field
        <div class="invoice-total-row">
          <span class="invoice-total-row-label">Tax</span>
          <span class="invoice-total-row-value">\u00a30.00</span>
        </div>
        -->
        <div class="invoice-total-divider"></div>
        <div class="invoice-grand-total">
          <span class="invoice-grand-total-label">Total</span>
          <span class="invoice-grand-total-value">\u00a3${fmtNum(subtotal)}</span>
        </div>
      </div>
    </div>

    ${(notes.trim() || bankDetails?.trim()) ? `
    <div class="invoice-footer-divider"></div>
    <div class="invoice-footer-grid">
      ${bankDetails?.trim() ? `<div>
        <div class="invoice-section-label">Payment Details</div>
        <div class="invoice-payment-detail">${nl2br(bankDetails)}</div>
      </div>` : '<div></div>'}
      ${notes.trim() ? `<div>
        <div class="invoice-section-label">Notes / Terms</div>
        <div class="invoice-terms">${nl2br(notes)}</div>
      </div>` : ''}
    </div>` : ''}
  </div>

</body>
</html>`;
}
