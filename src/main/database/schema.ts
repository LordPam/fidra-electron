import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  description: text('description').notNull(),
  amount: text('amount').notNull(),
  type: text('type', { enum: ['income', 'expense'] }).notNull(),
  status: text('status', { enum: ['--', 'pending', 'approved', 'rejected', 'planned'] }).notNull(),
  sheet: text('sheet').notNull(),
  category: text('category'),
  party: text('party'),
  reference: text('reference'),
  activity: text('activity'),
  notes: text('notes'),
  version: integer('version').default(1),
  created_at: text('created_at').notNull(),
  modified_at: text('modified_at'),
  modified_by: text('modified_by'),
}, (table) => [
  index('idx_transactions_date').on(table.date),
  index('idx_transactions_sheet').on(table.sheet),
  index('idx_transactions_type').on(table.type),
  index('idx_transactions_status').on(table.status),
]);

export const plannedTemplates = sqliteTable('planned_templates', {
  id: text('id').primaryKey(),
  start_date: text('start_date').notNull(),
  description: text('description').notNull(),
  amount: text('amount').notNull(),
  type: text('type', { enum: ['income', 'expense'] }).notNull(),
  frequency: text('frequency', { enum: ['once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'] }).notNull(),
  target_sheet: text('target_sheet').notNull(),
  category: text('category'),
  party: text('party'),
  activity: text('activity'),
  end_date: text('end_date'),
  occurrence_count: integer('occurrence_count'),
  skipped_dates: text('skipped_dates').default('[]'),
  fulfilled_dates: text('fulfilled_dates').default('[]'),
  version: integer('version').default(1),
  created_at: text('created_at').notNull(),
}, (table) => [
  index('idx_planned_start').on(table.start_date),
  index('idx_planned_target').on(table.target_sheet),
]);

export const sheets = sqliteTable('sheets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  is_virtual: integer('is_virtual', { mode: 'boolean' }).default(false),
  is_planned: integer('is_planned', { mode: 'boolean' }).default(false),
  sort_order: integer('sort_order').default(0),
  created_at: text('created_at').notNull(),
}, (table) => [
  index('idx_sheets_name').on(table.name),
]);

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type', { enum: ['income', 'expense'] }).notNull(),
  name: text('name').notNull(),
  sort_order: integer('sort_order').default(0),
}, (table) => [
  index('idx_categories_type').on(table.type),
]);

export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  transaction_id: text('transaction_id').notNull(),
  filename: text('filename').notNull(),
  stored_name: text('stored_name').notNull(),
  mime_type: text('mime_type'),
  file_size: integer('file_size').default(0),
  created_at: text('created_at').notNull(),
}, (table) => [
  index('idx_attachments_transaction').on(table.transaction_id),
]);

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  timestamp: text('timestamp').notNull(),
  action: text('action', { enum: ['create', 'update', 'delete'] }).notNull(),
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id').notNull(),
  user: text('user').notNull(),
  summary: text('summary').notNull(),
  details: text('details'),
}, (table) => [
  index('idx_audit_timestamp').on(table.timestamp),
  index('idx_audit_entity').on(table.entity_type, table.entity_id),
]);

export const activityNotes = sqliteTable('activity_notes', {
  activity: text('activity').primaryKey(),
  notes: text('notes').notNull(),
});

export const invoices = sqliteTable('invoices', {
  id: text('id').primaryKey(),
  invoice_number: text('invoice_number').notNull(),
  date: text('date').notNull(),
  due_date: text('due_date').notNull(),
  from_name: text('from_name').notNull(),
  from_address: text('from_address'),
  to_name: text('to_name').notNull(),
  to_address: text('to_address'),
  line_items: text('line_items').notNull(),
  subtotal: text('subtotal').notNull(),
  notes: text('notes'),
  bank_details: text('bank_details'),
  planned_template_id: text('planned_template_id'),
  status: text('status').default('draft'),
  transaction_id: text('transaction_id'),
  paid_at: text('paid_at'),
  planned_template_snapshot: text('planned_template_snapshot'),
  version: integer('version').default(1),
  created_at: text('created_at').notNull(),
  modified_at: text('modified_at'),
  modified_by: text('modified_by'),
}, (table) => [
  index('idx_invoices_date').on(table.date),
  index('idx_invoices_planned').on(table.planned_template_id),
]);
