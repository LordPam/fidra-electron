import type { TransactionRow, PlannedTemplateRow } from '../../shared/ipc-types';
import type { ActivityRow, MonthViewRow } from '@/domain/models';
import type { DatePrecision } from '@/lib/activity-parser';
import { parseActivityDate } from '@/lib/activity-parser';
import { expandTemplate } from '@/services/forecast';

export function lastDayOfMonth(year: number, month: number): string {
  const days = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(days).padStart(2, '0')}`;
}

export function monthStartStr(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** Does the activity's parsed date belong to the given year/month? */
export function activityBelongsToMonth(
  parsedDate: string | null,
  parsedEndDate: string | null,
  precision: DatePrecision,
  monthPrefix: string,
  monthStart: string,
  monthEnd: string,
  year: number,
): boolean {
  if (precision === 'day' && parsedDate) {
    const end = parsedEndDate ?? parsedDate;
    return parsedDate <= monthEnd && end >= monthStart;
  }
  if (precision === 'month' && parsedDate) {
    return parsedDate === monthPrefix;
  }
  if (precision === 'year' && parsedDate) {
    return parsedDate === String(year);
  }
  // undated → belongs to every month
  return true;
}

interface AggregateResult {
  allRows: ActivityRow[];
  allTotals: { count: number; income: number; expenses: number; net: number };
}

/**
 * Aggregates all transactions by activity name (no month filter).
 * Includes activities from planned templates and activity notes.
 */
export function aggregateActivities(
  transactions: TransactionRow[],
  templates: PlannedTemplateRow[],
  currentSheet: string,
  activityNotes: Record<string, string>,
): AggregateResult {
  const map = new Map<string, { count: number; income: number; expenses: number }>();

  for (const t of transactions) {
    if (!t.activity?.trim()) continue;
    const key = t.activity.trim();
    let entry = map.get(key);
    if (!entry) {
      entry = { count: 0, income: 0, expenses: 0 };
      map.set(key, entry);
    }
    entry.count++;
    const amount = parseFloat(t.amount) || 0;
    if (t.type === 'income') entry.income += amount;
    else entry.expenses += amount;
  }

  // Include activities that only exist as planned templates
  const filteredTemplates =
    currentSheet === 'All Sheets'
      ? templates
      : templates.filter((t) => t.target_sheet === currentSheet);
  const plannedActivities = new Set<string>();
  for (const tmpl of filteredTemplates) {
    if (tmpl.activity?.trim()) plannedActivities.add(tmpl.activity.trim());
  }
  for (const pa of plannedActivities) {
    if (!map.has(pa)) {
      map.set(pa, { count: 0, income: 0, expenses: 0 });
    }
  }

  // Include activities that only exist as notes (user-created empty activities)
  for (const noteKey of Object.keys(activityNotes)) {
    if (!map.has(noteKey)) {
      map.set(noteKey, { count: 0, income: 0, expenses: 0 });
    }
  }

  const rows: ActivityRow[] = [...map.entries()]
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(([activity, d]) => {
      const parsed = parseActivityDate(activity);
      const net = d.income - d.expenses;
      const hasActual = d.count > 0;
      const hasPlanned = plannedActivities.has(activity);

      let status: 'Planned' | 'Active' | 'Complete';
      if (hasActual && hasPlanned) status = 'Active';
      else if (hasActual) status = 'Complete';
      else status = 'Planned';

      return {
        rawActivity: activity,
        displayTitle: parsed.displayTitle,
        parsedDate: parsed.parsedDatePrefix,
        parsedEndDate: parsed.parsedEndDate,
        datePrecision: parsed.datePrecision,
        count: d.count,
        income: d.income,
        expenses: d.expenses,
        net,
        status,
      };
    });

  const totals = rows.reduce(
    (acc, r) => ({
      count: acc.count + r.count,
      income: acc.income + r.income,
      expenses: acc.expenses + r.expenses,
      net: acc.net + r.net,
    }),
    { count: 0, income: 0, expenses: 0, net: 0 },
  );

  return { allRows: rows, allTotals: totals };
}

interface MonthViewResult {
  monthViewRows: MonthViewRow[];
  monthViewTotals: {
    count: number;
    income: number;
    expenses: number;
    net: number;
    plannedNet: number;
    projectedNet: number;
  };
}

/**
 * Filters allRows by activity date for a specific month, overlaying planned template data.
 */
export function computeMonthView(
  allRows: ActivityRow[],
  templates: PlannedTemplateRow[],
  currentSheet: string,
  selectedMonth: { year: number; month: number },
): MonthViewResult {
  const { year, month } = selectedMonth;
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const mStart = monthStartStr(year, month);
  const mEnd = lastDayOfMonth(year, month);

  // Filter activities by their parsed date
  const filtered = allRows.filter((r) =>
    activityBelongsToMonth(r.parsedDate, r.parsedEndDate, r.datePrecision, monthPrefix, mStart, mEnd, year),
  );

  // Compute planned data for the month (by expanding templates)
  const plannedMap = new Map<string, { plannedIncome: number; plannedExpenses: number }>();
  const filteredTemplates =
    currentSheet === 'All Sheets'
      ? templates
      : templates.filter((t) => t.target_sheet === currentSheet);

  for (const tmpl of filteredTemplates) {
    if (!tmpl.activity?.trim()) continue;
    const instances = expandTemplate(tmpl, mEnd, true);
    for (const inst of instances) {
      if (inst.instanceDate < mStart || inst.instanceDate > mEnd) continue;
      const key = tmpl.activity.trim();
      let entry = plannedMap.get(key);
      if (!entry) {
        entry = { plannedIncome: 0, plannedExpenses: 0 };
        plannedMap.set(key, entry);
      }
      const amount = parseFloat(inst.transaction.amount) || 0;
      if (inst.transaction.type === 'income') entry.plannedIncome += amount;
      else entry.plannedExpenses += amount;
    }
  }

  // Merge: activity financials (all-time) + planned overlay
  const rows: MonthViewRow[] = filtered.map((r) => {
    const planned = plannedMap.get(r.rawActivity);
    const plannedIncome = planned?.plannedIncome ?? 0;
    const plannedExpenses = planned?.plannedExpenses ?? 0;
    const plannedNet = plannedIncome - plannedExpenses;

    let { status } = r;
    if (r.count > 0 && (plannedIncome > 0 || plannedExpenses > 0)) status = 'Active';

    return {
      ...r,
      plannedIncome,
      plannedExpenses,
      plannedNet,
      projectedNet: r.net + plannedNet,
      status,
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      count: acc.count + r.count,
      income: acc.income + r.income,
      expenses: acc.expenses + r.expenses,
      net: acc.net + r.net,
      plannedNet: acc.plannedNet + r.plannedNet,
      projectedNet: acc.projectedNet + r.projectedNet,
    }),
    { count: 0, income: 0, expenses: 0, net: 0, plannedNet: 0, projectedNet: 0 },
  );

  return { monthViewRows: rows, monthViewTotals: totals };
}
