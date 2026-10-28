import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonnelRecord } from '../../../shared/auth-types';
import type { WindowContext } from '../../window/window-context';
import { registerPersonnelHandlers } from '../personnel';

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, callback: (...args: unknown[]) => unknown) => handlers.set(name, callback) } }));
vi.mock('../context-resolver', () => ({ resolveContext: () => ctx }));
vi.mock('../../services/audit-service', () => ({ logPersonnelRemoved: vi.fn(), logPersonnelRoleChanged: vi.fn() }));

let ctx: WindowContext;
let current: PersonnelRecord;
let target: PersonnelRecord;
let save: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;

function person(id: string, role: 'admin' | 'member'): PersonnelRecord {
  return { id, role, name: id, email: `${id}@example.test`, auth_uid: null,
    created_at: '2026-10-26T00:00:00Z', invited_by: null, password_hash: 'synthetic-hash',
    encrypted_passphrase: null, passphrase_salt: null, device_id: null, isActive: true };
}

function invoke(name: string, ...args: unknown[]) {
  const handler = handlers.get(name);
  if (!handler) throw new Error('Missing test handler');
  return handler({}, ...args);
}

beforeEach(() => {
  handlers.clear();
  current = person('admin', 'admin');
  target = person('member', 'member');
  save = vi.fn((value: PersonnelRecord) => { target = value; return value; });
  remove = vi.fn(() => true);
  ctx = { isClosed: false, isLocalSyncAuthEnabled: true, localAuthPersonnel: { ...current },
    personnelRepo: {
      getById: (id: string) => id === current.id ? current : id === target.id ? target : null,
      getAll: () => [current, target], save, remove,
    },
  } as unknown as WindowContext;
  registerPersonnelHandlers();
});

describe('desktop personnel IPC uses shared authority', () => {
  it('preserves the native read-only team roster for signed-in members', () => {
    current = { ...current, role: 'member' };
    expect(invoke('personnel:getAll')).toHaveLength(2);
    expect(invoke('personnel:updateRole', 'member', 'admin')).toMatchObject({ success: false });
    expect(invoke('personnel:remove', 'member')).toMatchObject({ success: false });
  });
  it('rejects a live demotion even when the desktop still caches the admin role', () => {
    current = { ...current, role: 'member' };
    expect(invoke('personnel:updateRole', 'member', 'admin')).toMatchObject({ success: false });
    expect(invoke('personnel:remove', 'member')).toMatchObject({ success: false });
    expect(save).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('validates the native IPC inputs before invoking an operation', () => {
    expect(() => invoke('personnel:updateRole', 'member', 'owner')).toThrow();
    expect(() => invoke('personnel:remove', '')).toThrow();
    expect(save).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('retains successful native role changes and the self-removal guard', () => {
    expect(invoke('personnel:updateRole', 'member', 'admin')).toEqual({ success: true });
    expect(target.role).toBe('admin');
    expect(invoke('personnel:remove', 'admin')).toMatchObject({ success: false, error: expect.stringContaining('own account') });
    expect(remove).not.toHaveBeenCalled();
  });
});
