import { z } from 'zod';
import { contextFieldSchema } from './reconciliation-types';
import { aiConnectionPermissionsSchema } from './ai-bridge-types';

export const aiAccessPolicySchema = z.object({
  sheetIds: z.array(z.string().min(1).max(200)).min(1).max(50),
  fields: z.array(contextFieldSchema).max(6),
  permissions: aiConnectionPermissionsSchema,
}).strict();
export type AiAccessPolicy = z.infer<typeof aiAccessPolicySchema>;
export interface AiAccessRequest { id: string; client: 'chatgpt' | 'claude'; code: string; fingerprint: string; expiresAt: string }
export interface AiAuthorizationInfo {
  id: string; client: 'chatgpt' | 'claude'; approvedAt: string; approvedBy: string;
  policy: AiAccessPolicy; active: boolean;
}
export interface AiAccessState {
  requests: AiAccessRequest[]; authorizations: AiAuthorizationInfo[];
  owner: 'admin' | 'setup' | 'locked' | 'unavailable'; secureStorageAvailable: boolean;
}
