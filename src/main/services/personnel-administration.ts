import { idSchema, personnelRoleSchema } from '../../shared/ipc-schemas';
import type { WindowContext } from '../window/window-context';
import { assertApplicationPermission, checkApplicationPermission } from './application-access';
import { logPersonnelRemoved, logPersonnelRoleChanged } from './audit-service';

type AdministrationResult = { success: true } | { success: false; error: string };

export function listPersonnel(context: WindowContext) {
  // Native members have a read-only roster in Settings. Administration and
  // external consent still have their separate, stronger authority checks.
  assertApplicationPermission(context, 'ledgerUse');
  return context.personnelRepo.getAll();
}

/** Shared application operation, independent of the IPC or external transport. */
export function removePersonnel(context: WindowContext, rawId: unknown): AdministrationResult {
  const input = idSchema.safeParse(rawId);
  if (!input.success) return { success: false, error: 'Choose a valid personnel ID.' };
  const access = checkApplicationPermission(context, 'teamAdministration');
  if (!access.allowed) return { success: false, error: access.error };
  const target = context.personnelRepo.getById(input.data);
  if (!target) return { success: false, error: 'Person not found.' };
  if (access.actor.kind === 'team' && target.id === access.actor.id) {
    return { success: false, error: 'You cannot remove your own account. Sign out instead.' };
  }
  if (target.role === 'admin' && countAdmins(context) <= 1) {
    return { success: false, error: 'Cannot remove the last admin.' };
  }
  context.personnelRepo.remove(target.id);
  logPersonnelRemoved(context, target);
  return { success: true };
}

export function updatePersonnelRole(
  context: WindowContext,
  rawId: unknown,
  rawRole: unknown,
): AdministrationResult {
  const id = idSchema.safeParse(rawId);
  const role = personnelRoleSchema.safeParse(rawRole);
  if (!id.success || !role.success) return { success: false, error: 'Choose a valid person and role.' };
  const access = checkApplicationPermission(context, 'teamAdministration');
  if (!access.allowed) return { success: false, error: access.error };
  const target = context.personnelRepo.getById(id.data);
  if (!target) return { success: false, error: 'Person not found.' };
  if (target.role === role.data) return { success: true };
  if (target.role === 'admin' && countAdmins(context) <= 1) {
    return { success: false, error: 'Cannot demote the last admin.' };
  }
  context.personnelRepo.save({ ...target, role: role.data });
  logPersonnelRoleChanged(context, target, role.data);
  return { success: true };
}

function countAdmins(context: WindowContext): number {
  return context.personnelRepo.getAll().filter((person) => person.role === 'admin').length;
}
