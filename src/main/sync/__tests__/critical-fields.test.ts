import { describe, test, expect } from 'vitest';
import {
  isCriticalField,
  getCriticalFields,
  isTrackedTable,
} from '../critical-fields';

describe('critical-fields', () => {
  describe('isCriticalField', () => {
    test('transactions critical fields', () => {
      expect(isCriticalField('transactions', 'amount')).toBe(true);
      expect(isCriticalField('transactions', 'date')).toBe(true);
      expect(isCriticalField('transactions', 'type')).toBe(true);
      expect(isCriticalField('transactions', 'status')).toBe(true);
      expect(isCriticalField('transactions', 'sheet')).toBe(true);
      expect(isCriticalField('transactions', 'party')).toBe(true);
    });

    test('transactions non-critical fields', () => {
      expect(isCriticalField('transactions', 'description')).toBe(false);
      expect(isCriticalField('transactions', 'category')).toBe(false);
      expect(isCriticalField('transactions', 'reference')).toBe(false);
      expect(isCriticalField('transactions', 'notes')).toBe(false);
      expect(isCriticalField('transactions', 'version')).toBe(false);
    });

    test('planned_templates critical fields', () => {
      expect(isCriticalField('planned_templates', 'amount')).toBe(true);
      expect(isCriticalField('planned_templates', 'start_date')).toBe(true);
      expect(isCriticalField('planned_templates', 'type')).toBe(true);
      expect(isCriticalField('planned_templates', 'frequency')).toBe(true);
      expect(isCriticalField('planned_templates', 'target_sheet')).toBe(true);
    });

    test('planned_templates non-critical fields', () => {
      expect(isCriticalField('planned_templates', 'description')).toBe(false);
      expect(isCriticalField('planned_templates', 'end_date')).toBe(false);
    });

    test('invoices critical fields', () => {
      expect(isCriticalField('invoices', 'subtotal')).toBe(true);
      expect(isCriticalField('invoices', 'date')).toBe(true);
      expect(isCriticalField('invoices', 'due_date')).toBe(true);
      expect(isCriticalField('invoices', 'status')).toBe(true);
      expect(isCriticalField('invoices', 'to_name')).toBe(true);
    });

    test('invoices non-critical fields', () => {
      expect(isCriticalField('invoices', 'notes')).toBe(false);
      expect(isCriticalField('invoices', 'invoice_number')).toBe(false);
    });

    test('sheets critical fields', () => {
      expect(isCriticalField('sheets', 'name')).toBe(true);
    });

    test('sheets non-critical fields', () => {
      expect(isCriticalField('sheets', 'is_virtual')).toBe(false);
    });

    test('unknown table returns false', () => {
      expect(isCriticalField('unknown_table', 'amount')).toBe(false);
      expect(isCriticalField('categories', 'name')).toBe(false);
    });
  });

  describe('getCriticalFields', () => {
    test('returns set for tracked table', () => {
      const fields = getCriticalFields('transactions');
      expect(fields).not.toBeNull();
      expect(fields!.size).toBe(6);
      expect(fields!.has('amount')).toBe(true);
    });

    test('returns null for untracked table', () => {
      expect(getCriticalFields('unknown_table')).toBeNull();
      expect(getCriticalFields('categories')).toBeNull();
    });
  });

  describe('isTrackedTable', () => {
    test('tracked tables', () => {
      expect(isTrackedTable('transactions')).toBe(true);
      expect(isTrackedTable('planned_templates')).toBe(true);
      expect(isTrackedTable('invoices')).toBe(true);
      expect(isTrackedTable('sheets')).toBe(true);
    });

    test('untracked tables', () => {
      expect(isTrackedTable('categories')).toBe(false);
      expect(isTrackedTable('attachments')).toBe(false);
      expect(isTrackedTable('audit_log')).toBe(false);
      expect(isTrackedTable('')).toBe(false);
    });
  });
});
