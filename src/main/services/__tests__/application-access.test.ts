import { describe, expect, it } from 'vitest';
import type { PersonnelRecord } from '../../../shared/auth-types';
import { checkApplicationPermission, type ApplicationAccessContext } from '../application-access';

function person(role: 'admin' | 'member' = 'admin'): PersonnelRecord {
  return {
    id: 'person', name: 'Current name', email: 'person@example.test', role,
    auth_uid: null, created_at: '2026-10-26T00:00:00Z', invited_by: null,
    password_hash: 'synthetic-hash', encrypted_passphrase: null,
    passphrase_salt: null, device_id: null, isActive: true,
  };
}

function context(current: PersonnelRecord | null, cached: PersonnelRecord | null = current): ApplicationAccessContext {
  return {
    isClosed: false, isLocalSyncAuthEnabled: true, localAuthPersonnel: cached,
    personnelRepo: { getById: () => current },
  };
}

describe('shared application authority', () => {
  it('uses the current role when a cached admin was demoted', () => {
    const ctx = context(person('member'), person('admin'));
    expect(checkApplicationPermission(ctx, 'teamAdministration').allowed).toBe(false);
    expect(checkApplicationPermission(ctx, 'ledgerAdministration').allowed).toBe(false);
    expect(checkApplicationPermission(ctx, 'ledgerUse').allowed).toBe(true);
  });

  it('uses the current role when an existing signed-in member was promoted', () => {
    expect(checkApplicationPermission(context(person('admin'), person('member')), 'teamAdministration').allowed).toBe(true);
  });

  it('rejects removed and deactivated signed-in identities', () => {
    expect(checkApplicationPermission(context(null, person()), 'ledgerUse').allowed).toBe(false);
    expect(checkApplicationPermission(context({ ...person(), password_hash: null }), 'teamAdministration').allowed).toBe(false);
  });

  it('does not turn a stale removed team identity into a standalone owner', () => {
    const ctx = { ...context(null, person()), isLocalSyncAuthEnabled: false };
    expect(checkApplicationPermission(ctx, 'ledgerAdministration').allowed).toBe(false);
  });

  it('requires sign-in for an authenticated team ledger', () => {
    expect(checkApplicationPermission(context(null), 'ledgerUse').allowed).toBe(false);
  });

  it('preserves standalone UI authority without inventing a team administrator', () => {
    const ctx = { ...context(null), isLocalSyncAuthEnabled: false };
    expect(checkApplicationPermission(ctx, 'ledgerUse')).toEqual({ allowed: true, actor: { kind: 'standalone' } });
    expect(checkApplicationPermission(ctx, 'ledgerAdministration').allowed).toBe(true);
    expect(checkApplicationPermission(ctx, 'teamAdministration').allowed).toBe(false);
  });

  it('rejects closed ledgers for every operation', () => {
    const ctx = { ...context(person()), isClosed: true };
    for (const permission of ['ledgerUse', 'ledgerAdministration', 'teamAdministration'] as const) {
      expect(checkApplicationPermission(ctx, permission).allowed).toBe(false);
    }
  });

  it('returns a current actor without credential material', () => {
    const result = checkApplicationPermission(context(person(), { ...person(), name: 'Old name' }), 'ledgerUse');
    expect(result).toEqual({ allowed: true, actor: { kind: 'team', id: 'person', name: 'Current name', role: 'admin' } });
    expect(JSON.stringify(result)).not.toContain('synthetic-hash');
  });
});
