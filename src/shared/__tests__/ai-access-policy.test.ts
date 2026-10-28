import { describe, expect, it } from 'vitest';
import { aiAccessPolicySchema } from '../ai-access-types';
import { applicationCapabilitySchema, applicationCapabilityDetails } from '../application-capabilities';

const legacy = { sheetIds: ['main'], fields: ['description'], permissions: { allowAdd: true, allowStatementUploads: true } };
describe('native capability consent', () => {
  it('migrates old permissions without granting any new capability or future account', () => {
    expect(aiAccessPolicySchema.parse(legacy).permissions).toEqual({ ...legacy.permissions, capabilities: [], allAccounts: false });
  });
  it.each(applicationCapabilitySchema.options.filter((capability) => applicationCapabilityDetails[capability].ledgerWide))('%s requires explicit ledger-wide consent', (capability) => {
    const policy = { ...legacy, permissions: { capabilities: [capability] } };
    expect(aiAccessPolicySchema.safeParse(policy).success).toBe(false);
    expect(aiAccessPolicySchema.safeParse({ ...policy, sheetIds: [], permissions: { ...policy.permissions, allAccounts: true } }).success).toBe(true);
  });
  it('rejects duplicate, unknown and caller-defined privileges', () => {
    for (const permissions of [{ capabilities: ['transactions.read', 'transactions.read'] }, { capabilities: ['sql.execute'] }, { administrator: true }]) {
      expect(aiAccessPolicySchema.safeParse({ ...legacy, permissions }).success).toBe(false);
    }
    expect(aiAccessPolicySchema.safeParse({ ...legacy, sheetIds: ['main', 'main'] }).success).toBe(false);
    expect(aiAccessPolicySchema.safeParse({ ...legacy, sheetIds: [] }).success).toBe(false);
  });
});
