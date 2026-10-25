import { z } from 'zod';

export const invitationSchema = z.object({
  version: z.literal(1), existingAccount: z.boolean().optional(), id: z.string().uuid(), email: z.email(), name: z.string().min(1).max(200),
  team: z.string().min(1).max(200), groupId: z.string().uuid(), role: z.enum(['admin', 'member']),
  code: z.string().regex(/^[A-F0-9]{64}$/), expiresAt: z.iso.datetime(),
}).strict();
export type FidraInvitation = z.infer<typeof invitationSchema>;
