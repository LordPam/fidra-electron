import type { TransactionRow } from '../../shared/ipc-types';

// --- Types ---

export interface ReportData {
  title?: string;
  startDate: string;
  endDate: string;
  generatedDate: string;
  sheetName?: string;
  openingBalance?: number;
  transactions: TransactionRow[];
  balanceData?: { date: string; balance: number }[];
  monthlyData?: { month: string; income: number; expense: number }[];
  plannedData?: { description: string; date: string; amount: string; type: string }[];
  includeSummary?: boolean;
  includeCategories?: boolean;
  includeActivities?: boolean;
  includeTransactions?: boolean;
  /** @deprecated Use subItemFilter instead */
  subItemThreshold?: number;
  subItemFilter?: {
    countThreshold: number;
    amountThreshold: number;
    mode: 'or' | 'and';
  };
}

interface CategoryRow {
  category: string;
  count: number;
  total: number;
  pct: number;
  subItems: { description: string; count: number; amount: number }[];
}

interface ActivityRow {
  activity: string;
  income: number;
  expense: number;
  net: number;
  count: number;
}

// --- Helpers ---

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtNum(n: number): string {
  return Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function fmtPeriod(start: string, end: string): string {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const endStr = new Date(ey, em - 1, ed).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  if (sm === em && sy === ey) return `${sd} \u2013 ${endStr}`;
  const startOpts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
  if (sy !== ey) startOpts.year = 'numeric';
  const startStr = new Date(sy, sm - 1, sd).toLocaleDateString('en-GB', startOpts);
  return `${startStr} \u2013 ${endStr}`;
}

function getFY(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  const s = m >= 9 ? y : y - 1;
  return `${s}/${String(s + 1).slice(2)}`;
}

function isCountable(t: TransactionRow): boolean {
  if (t.type === 'income') return t.status === '--' || t.status === 'approved';
  if (t.type === 'expense') return t.status === 'approved';
  return false;
}

function statusLabel(s: string): string {
  if (s === '--') return 'Auto';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function sortAsc(txns: TransactionRow[]): TransactionRow[] {
  return [...txns].sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

function buildBreakdown(
  txns: TransactionRow[],
  grandTotal: number,
  filter: { countThreshold: number; amountThreshold: number; mode: 'or' | 'and' },
): CategoryRow[] {
  const byCat = new Map<string, TransactionRow[]>();
  for (const t of txns) {
    const cat = t.category || 'Other';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push(t);
  }
  const result: CategoryRow[] = [];
  for (const [category, items] of byCat) {
    const total = items.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
    const pct = grandTotal > 0 ? (total / grandTotal) * 100 : 0;
    // Group by description and count occurrences
    const byDesc = new Map<string, { count: number; amount: number }>();
    for (const t of items) {
      const desc = t.description || 'Other';
      const existing = byDesc.get(desc) || { count: 0, amount: 0 };
      existing.count++;
      existing.amount += parseFloat(t.amount) || 0;
      byDesc.set(desc, existing);
    }
    const subItems = [...byDesc.entries()]
      .filter(([, v]) => {
        const meetsCount = v.count >= filter.countThreshold;
        const meetsAmount = filter.amountThreshold > 0 && v.amount >= filter.amountThreshold;
        if (filter.amountThreshold <= 0) return meetsCount;
        return filter.mode === 'or' ? meetsCount || meetsAmount : meetsCount && meetsAmount;
      })
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([d, v]) => ({ description: d, count: v.count, amount: v.amount }));
    result.push({ category, count: items.length, total, pct, subItems });
  }
  return result.sort((a, b) => b.total - a.total);
}

function buildActivityBreakdown(txns: TransactionRow[]): ActivityRow[] {
  const byActivity = new Map<string, { income: number; expense: number; count: number }>();
  for (const t of txns) {
    const activity = t.activity || 'General';
    const existing = byActivity.get(activity) || { income: 0, expense: 0, count: 0 };
    const amt = parseFloat(t.amount) || 0;
    if (t.type === 'income') existing.income += amt;
    else existing.expense += amt;
    existing.count++;
    byActivity.set(activity, existing);
  }
  return [...byActivity.entries()]
    .map(([activity, v]) => ({
      activity,
      income: v.income,
      expense: v.expense,
      net: v.income - v.expense,
      count: v.count,
    }))
    .sort((a, b) => a.activity.localeCompare(b.activity));
}

// Fidra light-mode logo (navy/teal on transparent) — inline for PDF
const LOGO_SVG = `<svg width="38" height="38" viewBox="0 0 121.938 121.938" xmlns="http://www.w3.org/2000/svg"><g transform="translate(-44.031,-87.531)"><path fill="#89b0ae" d="m 150.907,87.593 c 0,0 0.555,2.782 0.326,5.82 -0.276,3.659 -1.667,7.685 -1.677,7.685 l -31.193,-0.413 c -7.355,-0.097 -12.409,0.903 -14.879,5.537 -3.048,5.719 -2.552,14.252 -2.552,14.252 l 0.053,19.541 c 0,0 4.281,-3.483 9.096,-3.482 l 26,0.006 c 0,0 -0.115,3.465 -0.481,6.189 -0.321,2.389 -2.344,6.959 -2.344,6.959 0,0 -18.275,-0.402 -22.384,0.217 -2.009,0.303 -4.238,2.608 -5.65,4.346 -1.413,1.739 -12.17,13.257 -12.17,13.257 0,0 7.715,6.302 7.824,15.864 0.965,7.422 -3.318,17.067 -10.648,22.144 -4.712,3.263 -13.474,3.934 -13.474,3.934 0.019,0.006 2.192,-1.627 4.077,-4.219 1.661,-2.283 3.086,-5.965 3.094,-8.277 0.017,-4.412 0.185,-17.184 0.185,-17.184 0,0 -0.066,-2.755 -2.358,-4.982 -2.423,-2.354 -14.778,-14.017 -14.778,-14.017 l 9.019,-9.779 7.497,7.171 13.039,-14.343 -12.713,-11.735 c 0.001,-11.855 -0.369,-25.396 5.9,-33.532 3.812,-4.948 10.821,-10.977 19.609,-11 23.347,-0.064 41.581,0.042 41.581,0.042 z"/><path fill="#313e50" d="m 59.433,113.56 v 95.909 l 16.98,-0.558 v -95.351 z"/><path fill="#313e50" d="m 85.864,87.531 c 0,0 -26.431,-0.172 -26.431,26.029 0,0 6.247,22.108 6.62,22.491 l 21.56,17.577 8.918,-9.809 -12.713,-11.735 -5.385,-5.385 c 0,0 -2.117,-1.429 -2.117,-4.247 l -0.093,-6.819 c 0.663,-12.098 8.022,-14.054 11.851,-14.568 0.49,-0.884 1.035,-1.725 1.643,-2.514 3.683,-4.78 10.35,-10.569 18.721,-10.978 z"/><path fill="#313e50" d="m 120.115,149.561 c -0.023,0.011 -3.016,1.434 -5.403,2.011 -2.695,0.652 -7.411,0.451 -7.432,0.45 l -2.145,2.334 c -1.719,2.054 -12.066,13.133 -12.082,13.15 0.021,0.017 7.715,6.315 7.823,15.864 0.061,0.472 0.102,0.952 0.121,1.44 v -19.908 h 9.485 c 0,0 13.233,1.003 22.775,-15.216 0,0 -6.877,-0.151 -13.142,-0.125 z"/><path fill="#313e50" d="m 143.709,101.021 c -0.004,0.003 -5.882,4.027 -8.801,4.986 -5.174,1.701 -9.579,1.426 -9.579,1.426 0,0 -14.264,0.096 -22.518,0.229 -2.298,5.606 -1.879,12.812 -1.879,12.812 0,0 23.541,-0.057 23.725,-0.074 6.075,-0.561 12.788,-3.436 17.695,-8.007 5.593,-5.211 7.203,-11.288 7.204,-11.295 z"/></g></svg>`;

// --- Balance chart SVG ---

function renderBalanceChart(points: { date: string; balance: number }[]): string {
  if (points.length < 2) return '';

  const W = 300;
  const H = 160;
  const PAD_L = 48;
  const PAD_R = 8;
  const PAD_T = 12;
  const PAD_B = 28;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const balances = points.map((p) => p.balance);
  const minBal = Math.min(...balances);
  const maxBal = Math.max(...balances);
  const range = maxBal - minBal || 1;

  const toX = (i: number) => PAD_L + (i / (points.length - 1)) * plotW;
  const toY = (v: number) => PAD_T + plotH - ((v - minBal) / range) * plotH;

  // Build polyline
  const linePoints = points.map((p, i) => `${toX(i).toFixed(1)},${toY(p.balance).toFixed(1)}`).join(' ');

  // Area polygon (line + close to bottom)
  const areaPoints =
    linePoints +
    ` ${toX(points.length - 1).toFixed(1)},${(PAD_T + plotH).toFixed(1)}` +
    ` ${PAD_L.toFixed(1)},${(PAD_T + plotH).toFixed(1)}`;

  // Y-axis labels (5 ticks)
  const yTicks = 5;
  const yLabels: string[] = [];
  for (let i = 0; i <= yTicks; i++) {
    const val = minBal + (range * i) / yTicks;
    const y = toY(val);
    yLabels.push(
      `<text x="${PAD_L - 4}" y="${y.toFixed(1)}" text-anchor="end" font-size="6.5" fill="#64748b" dominant-baseline="middle">\u00a3${fmtNum(val)}</text>`,
    );
    yLabels.push(
      `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${(W - PAD_R).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="0.5"/>`,
    );
  }

  // X-axis labels (sample ~5 dates)
  const xLabels: string[] = [];
  const step = Math.max(1, Math.floor(points.length / 5));
  for (let i = 0; i < points.length; i += step) {
    const x = toX(i);
    xLabels.push(
      `<text x="${x.toFixed(1)}" y="${(H - 4).toFixed(1)}" text-anchor="middle" font-size="6.5" fill="#64748b">${esc(points[i].date)}</text>`,
    );
  }
  // Always include last label
  if ((points.length - 1) % step !== 0) {
    const x = toX(points.length - 1);
    xLabels.push(
      `<text x="${x.toFixed(1)}" y="${(H - 4).toFixed(1)}" text-anchor="middle" font-size="6.5" fill="#64748b">${esc(points[points.length - 1].date)}</text>`,
    );
  }

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:'IBM Plex Sans',sans-serif">
    ${yLabels.join('\n    ')}
    ${xLabels.join('\n    ')}
    <polygon points="${areaPoints}" fill="#89B0AE" opacity="0.15"/>
    <polyline points="${linePoints}" fill="none" stroke="#89B0AE" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
}

// --- Income vs Expense monthly bar chart SVG ---

function renderMonthlyChart(months: { month: string; income: number; expense: number }[]): string {
  if (months.length === 0) return '';

  const W = 300;
  const H = 160;
  const PAD_L = 48;
  const PAD_R = 8;
  const PAD_T = 12;
  const PAD_B = 28;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const maxVal = Math.max(...months.flatMap((m) => [m.income, m.expense]), 1);

  const groupW = plotW / months.length;
  const barW = Math.min(groupW * 0.35, 16);
  const gap = 2;

  const toY = (v: number) => PAD_T + plotH - (v / maxVal) * plotH;

  // Y-axis labels (4 ticks)
  const yTicks = 4;
  const yLabels: string[] = [];
  for (let i = 0; i <= yTicks; i++) {
    const val = (maxVal * i) / yTicks;
    const y = toY(val);
    yLabels.push(
      `<text x="${PAD_L - 4}" y="${y.toFixed(1)}" text-anchor="end" font-size="6.5" fill="#64748b" dominant-baseline="middle">\u00a3${fmtNum(val)}</text>`,
    );
    yLabels.push(
      `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${(W - PAD_R).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="0.5"/>`,
    );
  }

  // Bars + X labels
  const bars: string[] = [];
  const xLabels: string[] = [];
  for (let i = 0; i < months.length; i++) {
    const m = months[i];
    const cx = PAD_L + groupW * (i + 0.5);
    const x1 = cx - barW - gap / 2;
    const x2 = cx + gap / 2;
    const incH = (m.income / maxVal) * plotH;
    const expH = (m.expense / maxVal) * plotH;

    bars.push(
      `<rect x="${x1.toFixed(1)}" y="${(PAD_T + plotH - incH).toFixed(1)}" width="${barW.toFixed(1)}" height="${incH.toFixed(1)}" fill="#89B0AE" rx="1.5"/>`,
    );
    bars.push(
      `<rect x="${x2.toFixed(1)}" y="${(PAD_T + plotH - expH).toFixed(1)}" width="${barW.toFixed(1)}" height="${expH.toFixed(1)}" fill="#C07A72" rx="1.5"/>`,
    );
    xLabels.push(
      `<text x="${cx.toFixed(1)}" y="${(H - 4).toFixed(1)}" text-anchor="middle" font-size="6.5" fill="#64748b">${esc(m.month)}</text>`,
    );
  }

  // Legend
  const legend = `
    <rect x="${PAD_L}" y="2" width="8" height="6" rx="1" fill="#89B0AE"/>
    <text x="${PAD_L + 11}" y="7.5" font-size="6" fill="#64748b">Income</text>
    <rect x="${PAD_L + 48}" y="2" width="8" height="6" rx="1" fill="#C07A72"/>
    <text x="${PAD_L + 59}" y="7.5" font-size="6" fill="#64748b">Expense</text>`;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:'IBM Plex Sans',sans-serif">
    ${legend}
    ${yLabels.join('\n    ')}
    ${bars.join('\n    ')}
    ${xLabels.join('\n    ')}
  </svg>`;
}

// --- Main ---

export function renderReportHTML(data: ReportData): string {
  const {
    title,
    startDate,
    endDate,
    generatedDate,
    sheetName,
    openingBalance = 0,
    transactions,
    balanceData,
    monthlyData,
    plannedData,
    includeSummary = true,
    includeCategories = true,
    includeActivities = false,
    includeTransactions = true,
    subItemThreshold = 5,
    subItemFilter,
  } = data;

  const resolvedFilter = subItemFilter ?? {
    countThreshold: subItemThreshold,
    amountThreshold: 0,
    mode: 'or' as const,
  };

  const countable = sortAsc(transactions.filter((t) => isCountable(t)));
  const income = countable.filter((t) => t.type === 'income');
  const expenses = countable.filter((t) => t.type === 'expense');

  const totalIncome = income.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
  const totalExpenses = expenses.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
  const net = totalIncome - totalExpenses;
  const closingBalance = openingBalance + net;

  // Running balances offset by opening balance
  let running = openingBalance;
  const balanceMap = new Map<string, number>();
  for (const t of countable) {
    const amt = parseFloat(t.amount) || 0;
    if (t.type === 'income') running += amt;
    else running -= amt;
    balanceMap.set(t.id, running);
  }

  const incomeBreakdown = buildBreakdown(income, totalIncome, resolvedFilter);
  const expenseBreakdown = buildBreakdown(expenses, totalExpenses, resolvedFilter);
  const activityBreakdown = buildActivityBreakdown(countable);
  const period = fmtPeriod(startDate, endDate);
  const fy = getFY(endDate);

  const sections: string[] = [];
  let sectionNum = 0;

  // --- Summary band ---
  if (includeSummary) {
    const netSign = net >= 0 ? '+' : '\u2013';
    const netClass = net >= 0 ? ' positive' : ' negative';
    const netLabel = net >= 0 ? 'Surplus for period' : 'Deficit for period';
    sections.push(`
  <div class="summary-band">
    <div class="metric">
      <div class="metric-label">Closing balance</div>
      <div class="metric-value">\u00a3${fmtNum(closingBalance)}</div>
      <div class="metric-sub">Opening: \u00a3${fmtNum(openingBalance)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Net movement</div>
      <div class="metric-value${netClass}">${netSign}\u00a3${fmtNum(net)}</div>
      <div class="metric-sub">${esc(netLabel)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Income</div>
      <div class="metric-value">\u00a3${fmtNum(totalIncome)}</div>
      <div class="metric-sub">${income.length} transactions</div>
    </div>
    <div class="metric">
      <div class="metric-label">Expenditure</div>
      <div class="metric-value">\u00a3${fmtNum(totalExpenses)}</div>
      <div class="metric-sub">${expenses.length} transactions</div>
    </div>
  </div>`);
  }

  // --- Income & Expenditure side-by-side ---
  if (includeCategories) {
    sectionNum++;
    const incomeNum = sectionNum;
    sectionNum++;
    const expenseNum = sectionNum;

    // Income rows (teal bars)
    const incomeRows = incomeBreakdown
      .map((r) => {
        let html = `<tr>
      <td class="cat-name">${esc(r.category)}</td>
      <td class="num">${r.count}</td>
      <td class="num">${fmtNum(r.total)}</td>
      <td class="share"><span class="bar income-bar" style="width:${Math.max(3, Math.round(r.pct * 0.4))}px"></span>${Math.round(r.pct)}%</td>
    </tr>`;
        for (const sub of r.subItems) {
          html += `<tr class="sub-item">
      <td>${esc(sub.description)} <span class="sub-count">(${sub.count})</span></td>
      <td></td>
      <td class="num">${fmtNum(sub.amount)}</td>
      <td></td>
    </tr>`;
        }
        return html;
      })
      .join('');

    // Expenditure rows (red bars)
    const expenseRows = expenseBreakdown
      .map((r) => {
        let html = `<tr>
      <td class="cat-name">${esc(r.category)}</td>
      <td class="num">${r.count}</td>
      <td class="num">(${fmtNum(r.total)})</td>
      <td class="share"><span class="bar expense-bar" style="width:${Math.max(3, Math.round(r.pct * 0.4))}px"></span>${Math.round(r.pct)}%</td>
    </tr>`;
        for (const sub of r.subItems) {
          html += `<tr class="sub-item">
      <td>${esc(sub.description)} <span class="sub-count">(${sub.count})</span></td>
      <td></td>
      <td class="num">(${fmtNum(sub.amount)})</td>
      <td></td>
    </tr>`;
        }
        return html;
      })
      .join('');

    sections.push(`
  <div class="two-col">
    <div class="col">
      <div class="section-header">
        <span class="section-num">${incomeNum}</span>
        <span class="section-name">Income by category</span>
        <span class="section-line"></span>
      </div>
      <table class="breakdown">
        <thead><tr>
          <th>Category</th>
          <th class="r">Count</th>
          <th class="r">Amount (\u00a3)</th>
          <th class="r">Share</th>
        </tr></thead>
        <tbody>
          ${incomeRows}
          <tr class="total-row">
            <td><strong>Total income</strong></td>
            <td class="num"><strong>${income.length}</strong></td>
            <td class="num"><strong>${fmtNum(totalIncome)}</strong></td>
            <td class="share"><strong>100%</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="col">
      <div class="section-header">
        <span class="section-num">${expenseNum}</span>
        <span class="section-name">Expenditure by category</span>
        <span class="section-line"></span>
      </div>
      <table class="breakdown">
        <thead><tr>
          <th>Category</th>
          <th class="r">Count</th>
          <th class="r">Amount (\u00a3)</th>
          <th class="r">Share</th>
        </tr></thead>
        <tbody>
          ${expenseRows}
          <tr class="total-row">
            <td><strong>Total expenditure</strong></td>
            <td class="num"><strong>${expenses.length}</strong></td>
            <td class="num"><strong>(${fmtNum(totalExpenses)})</strong></td>
            <td class="share"><strong>100%</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>`);
  }

  // --- Charts row: Income vs Expense by month | Balance over time ---
  const hasMonthlyChart = monthlyData && monthlyData.length > 0;
  const hasBalanceChart = balanceData && balanceData.length >= 2;

  if (hasMonthlyChart || hasBalanceChart) {
    let monthlyHTML = '';
    if (hasMonthlyChart) {
      sectionNum++;
      monthlyHTML = `
      <div>
        <div class="section-header">
          <span class="section-num">${sectionNum}</span>
          <span class="section-name">Income vs expense by month</span>
          <span class="section-line"></span>
        </div>
        <div style="margin-top:8px">
          ${renderMonthlyChart(monthlyData!)}
        </div>
      </div>`;
    }

    let balanceHTML = '';
    if (hasBalanceChart) {
      sectionNum++;
      const chartPoints = balanceData!.map((p) => ({ date: fmtShortDate(p.date), balance: p.balance }));
      balanceHTML = `
      <div>
        <div class="section-header">
          <span class="section-num">${sectionNum}</span>
          <span class="section-name">Balance over time</span>
          <span class="section-line"></span>
        </div>
        <div style="margin-top:8px">
          ${renderBalanceChart(chartPoints)}
        </div>
      </div>`;
    }

    if (hasMonthlyChart && hasBalanceChart) {
      sections.push(`
  <div class="two-col" style="margin-top:18px;align-items:flex-start">
    <div class="col">${monthlyHTML}</div>
    <div class="col">${balanceHTML}</div>
  </div>`);
    } else {
      sections.push(`<div style="margin-top:18px">${monthlyHTML || balanceHTML}</div>`);
    }
  }

  // --- Income & Expenditure by activity (full width) ---
  if (includeActivities && activityBreakdown.length > 0) {
    sectionNum++;
    const totalNet = activityBreakdown.reduce((s, r) => s + r.net, 0);
    const activityRows = activityBreakdown
      .map((r) => {
        const netSign = r.net >= 0 ? '' : '\u2013';
        const netCls = r.net >= 0 ? 'positive' : 'negative';
        return `<tr>
      <td class="cat-name">${esc(r.activity)}</td>
      <td class="num">${r.count}</td>
      <td class="num">${fmtNum(r.income)}</td>
      <td class="num">(${fmtNum(r.expense)})</td>
      <td class="num ${netCls}">${netSign}${fmtNum(r.net)}</td>
    </tr>`;
      })
      .join('');

    const totalNetSign = totalNet >= 0 ? '' : '\u2013';
    sections.push(`
  <div class="section-header" style="margin-top:18px">
    <span class="section-num">${sectionNum}</span>
    <span class="section-name">Income &amp; expenditure by activity</span>
    <span class="section-line"></span>
  </div>
  <table class="activity-table">
    <thead><tr>
      <th>Activity</th>
      <th class="r">Count</th>
      <th class="r">Income (\u00a3)</th>
      <th class="r">Expenditure (\u00a3)</th>
      <th class="r">Net (\u00a3)</th>
    </tr></thead>
    <tbody>
      ${activityRows}
      <tr class="total-row">
        <td><strong>Total</strong></td>
        <td class="num"><strong>${countable.length}</strong></td>
        <td class="num"><strong>${fmtNum(totalIncome)}</strong></td>
        <td class="num"><strong>(${fmtNum(totalExpenses)})</strong></td>
        <td class="num"><strong>${totalNetSign}${fmtNum(totalNet)}</strong></td>
      </tr>
    </tbody>
  </table>`);
  }

  // --- Pending & Planned side-by-side ---
  const pending = sortAsc(transactions.filter((t) => t.status === 'pending'));
  const hasPlanned = plannedData && plannedData.length > 0;

  if (pending.length > 0 || hasPlanned) {
    let pendingHTML = '';
    if (pending.length > 0) {
      sectionNum++;
      const pendingTotal = pending.reduce((s, t) => {
        const amt = parseFloat(t.amount) || 0;
        return s + (t.type === 'income' ? amt : -amt);
      }, 0);
      const pendingRows = pending
        .map((t) => {
          const amt = parseFloat(t.amount) || 0;
          const isExp = t.type === 'expense';
          return `<tr>
        <td>${esc(fmtShortDate(t.date))}</td>
        <td>${esc(t.description)}</td>
        <td class="num">${isExp ? `(${fmtNum(amt)})` : fmtNum(amt)}</td>
      </tr>`;
        })
        .join('');

      const totalSign = pendingTotal >= 0 ? '' : '\u2013';
      pendingHTML = `
      <div class="section-header">
        <span class="section-num">${sectionNum}</span>
        <span class="section-name">Pending transactions</span>
        <span class="section-line"></span>
      </div>
      <table class="mini-table">
        <thead><tr>
          <th>Date</th>
          <th>Description</th>
          <th class="r">Amount (\u00a3)</th>
        </tr></thead>
        <tbody>
          ${pendingRows}
          <tr class="total-row">
            <td colspan="2"><strong>Net pending</strong></td>
            <td class="num"><strong>${totalSign}${fmtNum(Math.abs(pendingTotal))}</strong></td>
          </tr>
        </tbody>
      </table>
      <p class="mini-note">${pending.length} transaction${pending.length !== 1 ? 's' : ''} awaiting approval</p>`;
    }

    let plannedHTML = '';
    if (hasPlanned) {
      sectionNum++;
      const plannedIncome = plannedData!.filter((p) => p.type === 'income').reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
      const plannedExpense = plannedData!.filter((p) => p.type === 'expense').reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
      const plannedNet = plannedIncome - plannedExpense;
      const plannedRows = plannedData!
        .map((p) => {
          const amt = parseFloat(p.amount) || 0;
          const isExp = p.type === 'expense';
          return `<tr>
        <td>${esc(fmtShortDate(p.date))}</td>
        <td>${esc(p.description)}</td>
        <td class="num">${isExp ? `(${fmtNum(amt)})` : fmtNum(amt)}</td>
      </tr>`;
        })
        .join('');

      const netSign = plannedNet >= 0 ? '' : '\u2013';
      plannedHTML = `
      <div class="section-header">
        <span class="section-num">${sectionNum}</span>
        <span class="section-name">Upcoming planned</span>
        <span class="section-line"></span>
      </div>
      <table class="mini-table">
        <thead><tr>
          <th>Due</th>
          <th>Description</th>
          <th class="r">Amount (\u00a3)</th>
        </tr></thead>
        <tbody>
          ${plannedRows}
          <tr class="total-row">
            <td colspan="2"><strong>Net planned</strong></td>
            <td class="num"><strong>${netSign}${fmtNum(Math.abs(plannedNet))}</strong></td>
          </tr>
        </tbody>
      </table>
      <p class="mini-note">${plannedData!.length} upcoming transaction${plannedData!.length !== 1 ? 's' : ''}</p>`;
    }

    if (pending.length > 0 && hasPlanned) {
      sections.push(`
  <div class="two-col" style="margin-top:18px;align-items:flex-start">
    <div class="col">${pendingHTML}</div>
    <div class="col">${plannedHTML}</div>
  </div>`);
    } else {
      sections.push(`<div style="margin-top:18px">${pendingHTML || plannedHTML}</div>`);
    }
  }

  // --- Footnotes (end of page 1) ---
  sections.push(`
  <div class="footnotes">
    <hr class="sep">
    <p class="disclaimer">Outflows shown in parentheses. Share percentages are of their respective totals and may not sum to 100% due to rounding. Report includes transactions with status <em>Approved</em> or <em>Auto</em> only. <em>Pending</em> and <em>Rejected</em> transactions are excluded.</p>
  </div>`);

  // --- Transaction register (forced to page 2) ---
  if (includeTransactions && countable.length > 0) {
    sectionNum++;
    const descending = [...countable].reverse();
    const registerRows = descending
      .map((t) => {
        const amt = parseFloat(t.amount) || 0;
        const isExpense = t.type === 'expense';
        const bal = balanceMap.get(t.id) ?? 0;
        return `<tr>
      <td class="date">${esc(fmtShortDate(t.date))}</td>
      <td>${esc(t.description)}</td>
      <td>${esc(t.category || '\u2014')}</td>
      <td>${esc(t.party || '\u2014')}</td>
      <td>${esc(statusLabel(t.status))}</td>
      <td class="num">${isExpense ? `(${fmtNum(amt)})` : fmtNum(amt)}</td>
      <td class="num">${fmtNum(bal)}</td>
    </tr>`;
      })
      .join('');

    sections.push(`
  <div class="page-break"></div>
  <div class="section-header">
    <span class="section-num">${sectionNum}</span>
    <span class="section-name">Transaction register</span>
    <span class="section-line"></span>
  </div>
  <table class="register">
    <thead><tr>
      <th>Date</th>
      <th>Description</th>
      <th>Category</th>
      <th>Party</th>
      <th>Status</th>
      <th class="r">Amount (\u00a3)</th>
      <th class="r">Balance (\u00a3)</th>
    </tr></thead>
    <tbody>${registerRows}</tbody>
  </table>`);
  }

  // --- Header metadata ---
  const orgLine = title ? `<div class="org-name">${esc(title.toUpperCase())}</div>` : '';
  const sheetLine = sheetName ? `<div><span class="meta-label">Sheet</span> ${esc(sheetName)}</div>` : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
@page { size: A4; margin: 18mm 15mm 22mm; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 9pt;
  color: #1e293b;
  line-height: 1.5;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  padding-bottom: 14mm;
}

/* --- Page break --- */
.page-break {
  page-break-before: always;
  break-before: page;
  height: 0;
  margin: 0;
  padding: 0;
}

/* --- Header --- */
.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}
.header-left {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.logo-img {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  margin-top: 2px;
}
.org-name {
  font-family: 'DM Sans', sans-serif;
  font-size: 8pt;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 1px;
}
.report-title {
  font-family: 'DM Sans', sans-serif;
  font-size: 20pt;
  font-weight: 700;
  color: #1e293b;
  line-height: 1.15;
}
.header-right {
  text-align: right;
  font-size: 8.5pt;
  color: #64748b;
  line-height: 1.7;
  padding-top: 2px;
}
.meta-label {
  font-weight: 600;
  color: #1e293b;
}

/* --- Summary band --- */
.summary-band {
  background: #f5f6f8;
  border-radius: 8px;
  padding: 18px 24px;
  display: flex;
  gap: 24px;
  margin-bottom: 22px;
}
.metric { flex: 1; }
.metric-label {
  font-size: 7pt;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #64748b;
  margin-bottom: 4px;
}
.metric-value {
  font-family: 'IBM Plex Mono', 'Courier New', monospace;
  font-size: 15pt;
  font-weight: 600;
  color: #1e293b;
  line-height: 1.2;
  white-space: nowrap;
}
.metric-value.positive { color: #2D8A6E; }
.metric-value.negative { color: #C0392B; }
.metric-sub {
  font-size: 8pt;
  color: #94a3b8;
  margin-top: 3px;
}

/* --- Section headers --- */
.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.section-num {
  font-family: 'DM Sans', sans-serif;
  font-size: 13pt;
  font-weight: 700;
  color: #1e293b;
}
.section-name {
  font-family: 'DM Sans', sans-serif;
  font-size: 13pt;
  font-weight: 700;
  color: #1e293b;
  white-space: nowrap;
}
.section-line {
  flex: 1;
  height: 1px;
  background: #d1d5db;
}

/* --- Page-break avoidance for sections --- */
.two-col,
.activity-table,
.mini-table {
  break-inside: avoid;
  page-break-inside: avoid;
}
.section-header {
  break-after: avoid;
  page-break-after: avoid;
}

/* --- Two-column layout --- */
.two-col {
  display: flex;
  gap: 20px;
  margin-bottom: 4px;
}
.two-col .col { flex: 1; }

/* --- Breakdown tables (Income / Expenditure) --- */
.breakdown {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 8px;
}
.breakdown thead th {
  font-size: 7pt;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: #64748b;
  padding: 0 6px 6px;
  border-bottom: 1.5px solid #d1d5db;
  text-align: left;
  background: none;
}
.breakdown thead th:first-child { padding-left: 0; }
.breakdown thead th.r { text-align: right; }
.breakdown tbody td {
  padding: 5px 6px;
  border-bottom: 1px solid #f0f0f0;
  font-size: 8.5pt;
}
.breakdown tbody td:first-child { padding-left: 0; }
.breakdown .cat-name { font-weight: 600; }
.breakdown .sub-item td:first-child { padding-left: 16px; }
.breakdown .sub-item td {
  color: #64748b;
  font-size: 8pt;
  border-bottom-color: #f8f8f8;
  padding-top: 3px;
  padding-bottom: 3px;
}
.sub-count {
  font-size: 7pt;
  color: #94a3b8;
}
.breakdown .total-row td {
  border-top: 1.5px solid #d1d5db;
  border-bottom: none;
  padding-top: 7px;
  font-weight: 600;
  background: none;
}
.breakdown td.num,
.breakdown .total-row td.num {
  font-family: 'IBM Plex Mono', 'Courier New', monospace;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.share {
  text-align: right;
  white-space: nowrap;
  font-size: 8pt;
  color: #64748b;
}
.bar {
  display: inline-block;
  height: 9px;
  border-radius: 4.5px;
  vertical-align: middle;
  margin-right: 4px;
}
.income-bar { background: #89B0AE; }
.expense-bar { background: #C07A72; }

/* --- Activity table --- */
.activity-table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 8px;
}
.activity-table thead th {
  font-size: 7pt;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: #64748b;
  padding: 0 6px 6px;
  border-bottom: 1.5px solid #d1d5db;
  text-align: left;
  background: none;
}
.activity-table thead th:first-child { padding-left: 0; }
.activity-table thead th.r { text-align: right; }
.activity-table tbody td {
  padding: 5px 6px;
  border-bottom: 1px solid #f0f0f0;
  font-size: 8.5pt;
}
.activity-table tbody td:first-child { padding-left: 0; }
.activity-table .cat-name { font-weight: 600; }
.activity-table td.num {
  font-family: 'IBM Plex Mono', 'Courier New', monospace;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.activity-table td.positive { color: #2D8A6E; }
.activity-table td.negative { color: #C0392B; }
.activity-table .total-row td {
  border-top: 1.5px solid #d1d5db;
  border-bottom: none;
  padding-top: 7px;
  font-weight: 600;
  background: none;
}

/* --- Transaction register --- */
.register {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 6px;
}
.register thead th {
  font-size: 7pt;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: #64748b;
  padding: 6px 8px;
  border-bottom: 2px solid #89B0AE;
  text-align: left;
  background: none;
}
.register thead th.r { text-align: right; }
.register tbody td {
  padding: 7px 8px;
  border-bottom: 1px solid #f0f0f0;
  font-size: 8.5pt;
  vertical-align: top;
}
.register td.date { white-space: nowrap; color: #64748b; }
.register td.num {
  font-family: 'IBM Plex Mono', 'Courier New', monospace;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* --- Footnotes --- */
.sep {
  border: none;
  border-top: 1px solid #e2e8f0;
  margin: 20px 0 10px;
}
.disclaimer {
  font-size: 7.5pt;
  color: #64748b;
  line-height: 1.55;
}

/* --- Mini tables (Pending / Planned) --- */
.mini-table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 6px;
}
.mini-table thead th {
  font-size: 7pt;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: #64748b;
  padding: 0 6px 6px;
  border-bottom: 1.5px solid #d1d5db;
  text-align: left;
  background: none;
}
.mini-table thead th:first-child { padding-left: 0; }
.mini-table thead th.r { text-align: right; }
.mini-table tbody td {
  padding: 4px 6px;
  border-bottom: 1px solid #f0f0f0;
  font-size: 8.5pt;
}
.mini-table tbody td:first-child { padding-left: 0; }
.mini-table td.num {
  font-family: 'IBM Plex Mono', 'Courier New', monospace;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.mini-table .total-row td {
  border-top: 1.5px solid #d1d5db;
  border-bottom: none;
  padding-top: 6px;
  font-weight: 600;
  background: none;
}
.mini-note {
  font-size: 7.5pt;
  color: #94a3b8;
  margin-top: 4px;
  font-style: italic;
}

</style>
</head>
<body>
  <header class="header">
    <div class="header-left">
      <div class="logo-img">${LOGO_SVG}</div>
      <div>
        ${orgLine}
        <div class="report-title">Financial summary</div>
      </div>
    </div>
    <div class="header-right">
      <div><span class="meta-label">Period</span> ${esc(period)}</div>
      ${sheetLine}
      <div><span class="meta-label">FY</span> ${esc(fy)}</div>
    </div>
  </header>
  ${sections.join('\n')}
</body>
</html>`;
}
