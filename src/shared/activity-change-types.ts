import { z } from 'zod';
import { idSchema, nameSchema } from './ipc-schemas';

const assignment = z.object({
  id: idSchema, version: z.number().int().min(1),
  expectedActivity: nameSchema.nullable(), activity: nameSchema.nullable(),
}).strict();
const note = z.object({ name: nameSchema, expected: z.string().nullable(), text: z.string().nullable() }).strict();
export const activityChangeSchema = z.object({
  transactions: z.array(assignment).max(10_000), templates: z.array(assignment).max(10_000), notes: z.array(note).max(2),
}).strict().superRefine((input, ctx) => {
  for (const key of ['transactions', 'templates'] as const) {
    if (new Set(input[key].map((row) => row.id)).size !== input[key].length) ctx.addIssue({ code: 'custom', path: [key], message: 'Each entry must appear once.' });
  }
  if (new Set(input.notes.map((row) => row.name)).size !== input.notes.length) ctx.addIssue({ code: 'custom', path: ['notes'], message: 'Each note must appear once.' });
});
export type ActivityChange = z.infer<typeof activityChangeSchema>;
