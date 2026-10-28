import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonnelRecord } from '../../../shared/auth-types';
import type { WindowContext } from '../../window/window-context';
import { removePersonnel, updatePersonnelRole } from '../personnel-administration';
import { logPersonnelRemoved, logPersonnelRoleChanged } from '../audit-service';

vi.mock('../audit-service', () => ({ logPersonnelRemoved: vi.fn(), logPersonnelRoleChanged: vi.fn() }));

function person(id: string, role: 'admin' | 'member'): PersonnelRecord {
  return {
    id, role, name: id, email: `${id}@example.test`, auth_uid: null,
    created_at: '2026-10-26T00:00:00Z', invited_by: null,
    password_hash: 'synthetic-hash', encrypted_passphrase: null,
    passphrase_salt: null, device_id: null, isActive: true,
  };
}

let rows: Map<string, PersonnelRecord>;
let ctx: WindowContext;
let save: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  rows = new Map([['admin', person('admin', 'admin')], ['member', person('member', 'member')]]);
  save = vi.fn((value: PersonnelRecord) => { rows.set(value.id, value); return value; });
  remove = vi.fn((id: string) => rows.delete(id));
  ctx = {
    isClosed: false, isLocalSyncAuthEnabled: true, localAuthPersonnel: rows.get('admin'),
    personnelRepo: { getById: (id: string) => rows.get(id) ?? null, getAll: () => [...rows.values()], save, remove },
  } as unknown as WindowContext;
});

describe('shared personnel administration operations', () => {
  it('rejects role escalation by a demoted cached administrator without writes or audit', () => {
    rows.set('admin', person('admin', 'member'));
    expect(updatePersonnelRole(ctx, 'member', 'admin').success).toBe(false);
    expect(removePersonnel(ctx, 'member').success).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(logPersonnelRemoved).not.toHaveBeenCalled();
    expect(logPersonnelRoleChanged).not.toHaveBeenCalled();
  });

  it('rejects a removed actor, an unsigned team user and a standalone owner', () => {
    rows.delete('admin');
    expect(removePersonnel(ctx, 'member').success).toBe(false);
    ctx.localAuthPersonnel = null;
    expect(updatePersonnelRole(ctx, 'member', 'admin').success).toBe(false);
    Object.assign(ctx, { isLocalSyncAuthEnabled: false });
    expect(removePersonnel(ctx, 'member').success).toBe(false);
  });

  it('does not allow self-removal or last-admin demotion', () => {
    expect(removePersonnel(ctx, 'admin')).toMatchObject({ success: false, error: expect.stringContaining('own account') });
    expect(updatePersonnelRole(ctx, 'admin', 'member')).toEqual({ success: false, error: 'Cannot demote the last admin.' });
    expect(remove).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('validates inputs at the application boundary without changing personnel', () => {
    expect(removePersonnel(ctx, '')).toMatchObject({ success: false });
    expect(updatePersonnelRole(ctx, 'member', 'owner')).toMatchObject({ success: false });
    expect(remove).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('reports a missing target and leaves a same-role request unchanged', () => {
    expect(removePersonnel(ctx, 'missing')).toEqual({ success: false, error: 'Person not found.' });
    expect(updatePersonnelRole(ctx, 'missing', 'admin')).toEqual({ success: false, error: 'Person not found.' });
    expect(updatePersonnelRole(ctx, 'member', 'member')).toEqual({ success: true });
    expect(save).not.toHaveBeenCalled();
    expect(logPersonnelRoleChanged).not.toHaveBeenCalled();
  });

  it('removes another member through the repository and records the existing audit event', () => {
    const target = rows.get('member');
    expect(removePersonnel(ctx, 'member')).toEqual({ success: true });
    expect(rows.has('member')).toBe(false);
    expect(logPersonnelRemoved).toHaveBeenCalledExactlyOnceWith(ctx, target);
  });

  it('changes another role and permits self-demotion when a second admin remains', () => {
    const target = rows.get('member');
    expect(updatePersonnelRole(ctx, 'member', 'admin')).toEqual({ success: true });
    expect(rows.get('member')?.role).toBe('admin');
    expect(logPersonnelRoleChanged).toHaveBeenCalledExactlyOnceWith(ctx, target, 'admin');
    expect(updatePersonnelRole(ctx, 'admin', 'member')).toEqual({ success: true });
    expect(rows.get('admin')?.role).toBe('member');
    expect(updatePersonnelRole(ctx, 'member', 'member').success).toBe(false);
  });
});
