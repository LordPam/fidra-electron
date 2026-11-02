import { z } from 'zod';

/** Same name rules as Manage Sheets, enforced at the application boundary. */
export const sheetNameSchema = z.string().trim().min(1, 'Name is required')
  .refine((name) => name.toLowerCase() !== 'all sheets', 'Cannot use "All Sheets"');
