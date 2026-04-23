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
      <td>${esc(item.description)}</td>
      <td class="num">${item.quantity}</td>
      <td class="num">\u00a3${fmtNum(item.unitPrice)}</td>
      <td class="num">\u00a3${fmtNum(item.quantity * item.unitPrice)}</td>
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
body {
  font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 9.5pt;
  color: #1e293b;
  line-height: 1.5;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 36px;
  padding-bottom: 18px;
  border-bottom: 2px solid #89B0AE;
}
.header-left {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.brand-name {
  font-family: 'DM Sans', sans-serif;
  font-size: 11pt;
  font-weight: 700;
  color: #313E50;
  margin-top: 4px;
}
.invoice-title {
  font-family: 'DM Sans', sans-serif;
  font-size: 28pt;
  font-weight: 700;
  color: #313E50;
  letter-spacing: -0.5px;
}

.addresses {
  display: flex;
  justify-content: space-between;
  margin-bottom: 32px;
}
.address-block {
  flex: 1;
}
.address-block:last-child {
  text-align: right;
}
.address-label {
  font-size: 7pt;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #64748b;
  margin-bottom: 6px;
}
.address-name {
  font-weight: 600;
  font-size: 10pt;
  margin-bottom: 3px;
}
.address-lines {
  color: #475569;
  font-size: 9pt;
  line-height: 1.6;
}

.details {
  display: flex;
  gap: 32px;
  margin-bottom: 32px;
  padding: 14px 18px;
  background: #f8fafc;
  border-radius: 6px;
}
.detail-item {
  flex: 1;
}
.detail-label {
  font-size: 7pt;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #64748b;
  margin-bottom: 3px;
}
.detail-value {
  font-weight: 600;
  font-size: 10pt;
}

.items-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 24px;
}
.items-table thead th {
  font-size: 7.5pt;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: #64748b;
  padding: 8px 12px;
  border-bottom: 2px solid #89B0AE;
  text-align: left;
  background: none;
}
.items-table thead th.r { text-align: right; }
.items-table tbody td {
  padding: 10px 12px;
  border-bottom: 1px solid #f0f0f0;
  font-size: 9.5pt;
}
.items-table td.num {
  font-family: 'IBM Plex Mono', 'Courier New', monospace;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.subtotal-section {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 32px;
}
.subtotal-box {
  width: 240px;
  border-top: 2px solid #313E50;
  padding-top: 10px;
}
.subtotal-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
}
.subtotal-label {
  font-weight: 700;
  font-size: 11pt;
}
.subtotal-value {
  font-family: 'IBM Plex Mono', 'Courier New', monospace;
  font-weight: 700;
  font-size: 11pt;
}

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
.due-date-overdue {
  color: #dc2626;
}

.bottom-section {
  margin-top: 40px;
  padding-top: 16px;
  border-top: 1px solid #e2e8f0;
}
.bottom-block + .bottom-block {
  margin-top: 20px;
}
.bottom-label {
  font-size: 7pt;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #64748b;
  margin-bottom: 6px;
}
.bottom-content {
  color: #475569;
  font-size: 9pt;
  line-height: 1.6;
}

</style>
</head>
<body>
  <header class="header">
    <div class="header-left">
      ${logoDataUri ? `<img src="${logoDataUri}" style="max-height:40px;max-width:120px;object-fit:contain" />` : ''}
      <div class="brand-name">${esc(fromName || 'Fidra')}</div>
    </div>
    <div class="invoice-title">INVOICE</div>
  </header>

  <div class="addresses">
    <div class="address-block">
      <div class="address-label">From</div>
      <div class="address-name">${esc(fromName)}</div>
      <div class="address-lines">${nl2br(fromAddress)}</div>
    </div>
    <div class="address-block">
      <div class="address-label">Bill To</div>
      <div class="address-name">${esc(toName)}</div>
      <div class="address-lines">${nl2br(toAddress)}</div>
    </div>
  </div>

  <div class="details">
    <div class="detail-item">
      <div class="detail-label">Invoice Number</div>
      <div class="detail-value">${esc(invoiceNumber)}</div>
    </div>
    <div class="detail-item">
      <div class="detail-label">Date</div>
      <div class="detail-value">${esc(fmtDate(date))}</div>
    </div>
    <div class="detail-item">
      <div class="detail-label">Due Date</div>
      <div class="detail-value${isOverdue ? ' due-date-overdue' : ''}">${esc(fmtDate(dueDate))}${isOverdue ? '<span class="overdue-badge">Overdue</span>' : ''}</div>
    </div>
  </div>

  <table class="items-table">
    <thead>
      <tr>
        <th>Description</th>
        <th class="r">Qty</th>
        <th class="r">Unit Price</th>
        <th class="r">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <div class="subtotal-section">
    <div class="subtotal-box">
      <div class="subtotal-row">
        <span class="subtotal-label">Total</span>
        <span class="subtotal-value">\u00a3${fmtNum(subtotal)}</span>
      </div>
    </div>
  </div>

  ${(notes.trim() || bankDetails?.trim()) ? `<div class="bottom-section">
    ${bankDetails?.trim() ? `<div class="bottom-block">
      <div class="bottom-label">Payment Details</div>
      <div class="bottom-content">${nl2br(bankDetails)}</div>
    </div>` : ''}
    ${notes.trim() ? `<div class="bottom-block">
      <div class="bottom-label">Notes / Terms</div>
      <div class="bottom-content">${nl2br(notes)}</div>
    </div>` : ''}
  </div>` : ''}

</body>
</html>`;
}
