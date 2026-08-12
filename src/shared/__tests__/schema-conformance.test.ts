import { describe, it, expect } from 'vitest';
import { createDemoDataState } from '../../renderer/demo/fixtures';
import {
  transactionRowSchema,
  plannedTemplateRowSchema,
  sheetRowSchema,
  invoiceRowSchema,
} from '../ipc-schemas';
import type { ZodTypeAny } from 'zod';

/**
 * The demo dataset is the closest thing to a corpus of realistic rows, so it doubles
 * as a check that tightening the IPC schemas has not locked out data the app itself
 * produces. It caught exactly that: `line_items` is written as
 * `{ items, taxRate, accentMode }`, not the bare array an earlier draft required.
 */
describe('demo data satisfies the IPC schemas', () => {
  const state = createDemoDataState();

  const cases: [string, ZodTypeAny, unknown[]][] = [
    ['transactions', transactionRowSchema, state.transactions],
    ['planned templates', plannedTemplateRowSchema, state.plannedTemplates],
    ['sheets', sheetRowSchema, state.sheets],
    ['invoices', invoiceRowSchema, state.invoices],
  ];

  for (const [label, schema, rows] of cases) {
    it(`accepts every one of the demo ${label}`, () => {
      expect(rows.length).toBeGreaterThan(0);

      const failures = rows.flatMap((row, index) => {
        const result = schema.safeParse(row);
        return result.success
          ? []
          : [`${label}[${index}]: ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`];
      });

      expect(failures).toEqual([]);
    });
  }
});
