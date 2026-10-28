import type { ReconciliationScope, ReconciliationProposal } from './reconciliation-types';
import { z } from 'zod';
import { applicationCapabilitySchema } from './application-capabilities';
export type AiClient = 'claude' | 'chatgpt';
export const aiConnectionPermissionsSchema = z.object({
  allowAdd: z.boolean().default(false),
  allowStatementUploads: z.boolean().default(false),
  capabilities: z.array(applicationCapabilitySchema).max(applicationCapabilitySchema.options.length).default([]),
  allAccounts: z.boolean().default(false),
}).strict();
export type AiConnectionPermissions = z.infer<typeof aiConnectionPermissionsSchema>;
export interface AiConnection {
  id: string; client: AiClient; lastUsedAt: string | null; lastTool: string | null; scope: ReconciliationScope;
  permissions: AiConnectionPermissions;
}
export interface AiBridgeState { access: import('./ai-access-types').AiAccessState; proposals: ReconciliationProposal[] }
