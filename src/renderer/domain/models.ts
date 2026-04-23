// Branded ID types
export type TransactionId = string & { __brand: 'TransactionId' };
export type PlannedTemplateId = string & { __brand: 'PlannedTemplateId' };
export type SheetId = string & { __brand: 'SheetId' };
export type CategoryId = number & { __brand: 'CategoryId' };
export type AttachmentId = string & { __brand: 'AttachmentId' };
export type AuditEntryId = string & { __brand: 'AuditEntryId' };

// Enums as const objects
export const TransactionType = {
  INCOME: 'income',
  EXPENSE: 'expense',
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];

export const ApprovalStatus = {
  AUTO: '--',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PLANNED: 'planned',
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const Frequency = {
  ONCE: 'once',
  WEEKLY: 'weekly',
  BIWEEKLY: 'biweekly',
  MONTHLY: 'monthly',
  QUARTERLY: 'quarterly',
  YEARLY: 'yearly',
} as const;
export type Frequency = (typeof Frequency)[keyof typeof Frequency];

export const AuditAction = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

// Domain interfaces
export interface Transaction {
  readonly id: TransactionId;
  readonly date: string; // ISO date string YYYY-MM-DD
  readonly description: string;
  readonly amount: string; // Decimal stored as text
  readonly type: TransactionType;
  readonly status: ApprovalStatus;
  readonly sheet: string;
  readonly category: string | null;
  readonly party: string | null;
  readonly reference: string | null;
  readonly activity: string | null;
  readonly notes: string | null;
  readonly version: number;
  readonly created_at: string; // ISO datetime
  readonly modified_at: string | null;
  readonly modified_by: string | null;
}

export interface PlannedTemplate {
  readonly id: PlannedTemplateId;
  readonly start_date: string;
  readonly description: string;
  readonly amount: string;
  readonly type: TransactionType;
  readonly frequency: Frequency;
  readonly target_sheet: string;
  readonly category: string | null;
  readonly party: string | null;
  readonly activity: string | null;
  readonly end_date: string | null;
  readonly occurrence_count: number | null;
  readonly skipped_dates: string; // JSON array of date strings
  readonly fulfilled_dates: string; // JSON array of date strings
  readonly version: number;
  readonly created_at: string;
}

export interface Sheet {
  readonly id: SheetId;
  readonly name: string;
  readonly is_virtual: number;
  readonly is_planned: number;
  readonly created_at: string;
}

export interface Category {
  readonly id: CategoryId;
  readonly type: TransactionType;
  readonly name: string;
  readonly sort_order: number;
}

export interface Attachment {
  readonly id: AttachmentId;
  readonly transaction_id: TransactionId;
  readonly filename: string;
  readonly stored_name: string;
  readonly mime_type: string | null;
  readonly file_size: number;
  readonly created_at: string;
}

export interface AuditEntry {
  readonly id: AuditEntryId;
  readonly timestamp: string;
  readonly action: AuditAction;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly user: string;
  readonly summary: string;
  readonly details: string | null;
}

export interface ActivityNote {
  readonly activity: string;
  readonly notes: string;
}

// Activity aggregation types (used by ActivitiesView and activity-aggregation service)
export interface ActivityRow {
  rawActivity: string;
  displayTitle: string;
  parsedDate: string | null;
  parsedEndDate: string | null;
  datePrecision: import('@/lib/activity-parser').DatePrecision;
  count: number;
  income: number;
  expenses: number;
  net: number;
  status: 'Planned' | 'Active' | 'Complete';
}

export interface MonthViewRow extends ActivityRow {
  plannedIncome: number;
  plannedExpenses: number;
  plannedNet: number;
  projectedNet: number;
}

// Planned view types
export interface ExpandedTemplate {
  template: import('../../shared/ipc-types').PlannedTemplateRow;
  instances: import('@/services/forecast').PlannedInstance[];
  nextDue: string | null;
  overdueDate: string | null;
}
