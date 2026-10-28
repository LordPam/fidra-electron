import { z } from 'zod';
import { contextFieldSchema } from './reconciliation-types';
import { aiConnectionPermissionsSchema } from './ai-bridge-types';
import { applicationCapabilityDetails } from './application-capabilities';

export const aiAccessPolicySchema = z.object({
  sheetIds: z.array(z.string().min(1).max(200)).max(50),
  fields: z.array(contextFieldSchema).max(6),
  permissions: aiConnectionPermissionsSchema,
}).strict().superRefine((policy, ctx) => {
  if (!policy.sheetIds.length && !policy.permissions.allAccounts) {
    ctx.addIssue({ code: 'custom', path: ['sheetIds'], message: 'Select at least one account or explicitly allow all accounts.' });
  }
  if (new Set(policy.sheetIds).size !== policy.sheetIds.length) {
    ctx.addIssue({ code: 'custom', path: ['sheetIds'], message: 'An account may be selected only once.' });
  }
  if (new Set(policy.permissions.capabilities).size !== policy.permissions.capabilities.length) {
    ctx.addIssue({ code: 'custom', path: ['permissions', 'capabilities'], message: 'Select each capability only once.' });
  }
  if (!policy.permissions.allAccounts && policy.permissions.capabilities.some((capability) => applicationCapabilityDetails[capability].ledgerWide)) {
    ctx.addIssue({ code: 'custom', path: ['permissions', 'allAccounts'], message: 'These operations affect the whole ledger. Explicitly allow all accounts first.' });
  }
});
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
