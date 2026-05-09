import type { PlannedTemplateRow, TransactionRow } from '../../shared/ipc-types';

const NAMESPACE = '6ba7b812-9dad-11d1-80b4-00c04fd430c8';

function deterministicId(templateId: string, dateStr: string): string {
  // Produce a stable ID for a given template + occurrence date
  // Uses a simple hash approach since we can't use uuid5 without a dependency
  const input = `${templateId}_${dateStr}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  // Format as a UUID-like string for consistency
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `planned-${hex}-${templateId.slice(0, 8)}-${dateStr}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toISO(d);
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  return toISO(d);
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayISO(): string {
  return toISO(new Date());
}

function nextOccurrence(current: string, frequency: PlannedTemplateRow['frequency']): string {
  switch (frequency) {
    case 'once':
      return '9999-12-31';
    case 'weekly':
      return addDays(current, 7);
    case 'biweekly':
      return addDays(current, 14);
    case 'monthly':
      return addMonths(current, 1);
    case 'quarterly':
      return addMonths(current, 3);
    case 'yearly':
      return addMonths(current, 12);
  }
}

export interface PlannedInstance {
  transaction: TransactionRow;
  templateId: string;
  instanceDate: string;
}

export function expandTemplate(
  template: PlannedTemplateRow,
  horizonDate: string,
  includePast = false,
): PlannedInstance[] {
  const today = todayISO();
  const skipped: Set<string> = new Set(JSON.parse(template.skipped_dates || '[]'));
  const fulfilled: Set<string> = new Set(JSON.parse(template.fulfilled_dates || '[]'));

  const instances: PlannedInstance[] = [];
  let current = template.start_date;
  let count = 0;

  while (current <= horizonDate) {
    // Check occurrence_count limit
    if (template.occurrence_count !== null && count >= template.occurrence_count) break;
    // Check end_date limit
    if (template.end_date && current > template.end_date) break;

    const isPast = current < today;
    const isSkipped = skipped.has(current);
    const isFulfilled = fulfilled.has(current);

    if (!isSkipped && !isFulfilled && (!isPast || includePast)) {
      instances.push({
        transaction: createInstance(template, current),
        templateId: template.id,
        instanceDate: current,
      });
    }

    // Count all non-skipped occurrences (including fulfilled) toward occurrence_count
    if (!isSkipped) count++;

    if (template.frequency === 'once') break;
    current = nextOccurrence(current, template.frequency);
  }

  return instances;
}

export function createInstance(template: PlannedTemplateRow, occurrenceDate: string): TransactionRow {
  return {
    id: deterministicId(template.id, occurrenceDate),
    date: occurrenceDate,
    description: template.description,
    amount: template.amount,
    type: template.type,
    status: 'planned',
    sheet: template.target_sheet,
    category: template.category,
    party: template.party,
    reference: null,
    activity: template.activity,
    notes: template.notes,
    version: 1,
    created_at: template.created_at,
    modified_at: null,
    modified_by: null,
  };
}

export function projectBalance(
  currentBalance: number,
  instances: PlannedInstance[],
  targetDate: string,
): number {
  let balance = currentBalance;
  for (const inst of instances) {
    if (inst.instanceDate <= targetDate) {
      const amount = parseFloat(inst.transaction.amount);
      balance += inst.transaction.type === 'income' ? amount : -amount;
    }
  }
  return balance;
}

export function getOverdueDate(template: PlannedTemplateRow): string | null {
  const today = todayISO();
  const skipped: Set<string> = new Set(JSON.parse(template.skipped_dates || '[]'));
  const fulfilled: Set<string> = new Set(JSON.parse(template.fulfilled_dates || '[]'));

  let current = template.start_date;
  let count = 0;
  let lastOverdue: string | null = null;

  while (current < today) {
    if (template.occurrence_count !== null && count >= template.occurrence_count) break;
    if (template.end_date && current > template.end_date) break;

    if (!skipped.has(current) && !fulfilled.has(current)) {
      lastOverdue = current;
    }

    if (!skipped.has(current)) count++;
    if (template.frequency === 'once') break;
    current = nextOccurrence(current, template.frequency);
  }

  return lastOverdue;
}

/**
 * Returns today's date if the template has an unfulfilled, unskipped occurrence
 * due today. Returns null otherwise.
 */
export function getDueTodayDate(template: PlannedTemplateRow): string | null {
  const today = todayISO();
  const skipped: Set<string> = new Set(JSON.parse(template.skipped_dates || '[]'));
  const fulfilled: Set<string> = new Set(JSON.parse(template.fulfilled_dates || '[]'));

  let current = template.start_date;
  let count = 0;

  while (current <= today) {
    if (template.occurrence_count !== null && count >= template.occurrence_count) break;
    if (template.end_date && current > template.end_date) break;

    if (current === today && !skipped.has(current) && !fulfilled.has(current)) {
      return today;
    }

    if (!skipped.has(current)) count++;
    if (template.frequency === 'once') break;
    current = nextOccurrence(current, template.frequency);
  }

  return null;
}

export function getNextDueDate(template: PlannedTemplateRow): string | null {
  const today = todayISO();
  const skipped: Set<string> = new Set(JSON.parse(template.skipped_dates || '[]'));
  const fulfilled: Set<string> = new Set(JSON.parse(template.fulfilled_dates || '[]'));

  let current = template.start_date;
  let count = 0;

  // Look ahead up to 5 years
  const limit = addMonths(today, 60);

  while (current <= limit) {
    if (template.occurrence_count !== null && count >= template.occurrence_count) return null;
    if (template.end_date && current > template.end_date) return null;

    if (!skipped.has(current) && !fulfilled.has(current) && current >= today) {
      return current;
    }

    if (!skipped.has(current)) count++;
    if (template.frequency === 'once') break;
    current = nextOccurrence(current, template.frequency);
  }

  return null;
}
