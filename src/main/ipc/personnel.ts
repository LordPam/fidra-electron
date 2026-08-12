import { ipcMain } from 'electron';
import { z } from 'zod';
import { resolveContext } from './context-resolver';
import { personnelRoleSchema } from '../../shared/ipc-schemas';
import { logPersonnelRemoved, logPersonnelRoleChanged } from '../services/audit-service';

export function registerPersonnelHandlers(): void {
  ipcMain.handle('personnel:getAll', (event) => {
    return resolveContext(event).personnelRepo.getAll();
  });

  ipcMain.handle('personnel:remove', (event, id: unknown) => {
    const validId = z.string().min(1).parse(id);
    const ctx = resolveContext(event);

    if (!ctx.localAuthPersonnel || ctx.localAuthPersonnel.role !== 'admin') {
      return { success: false, error: 'Only admins can remove personnel.' };
    }
    const target = ctx.personnelRepo.getById(validId);
    if (!target) {
      return { success: false, error: 'Person not found.' };
    }
    // Removing yourself would leave this window signed in against a deleted
    // record. Sign out instead.
    if (target.id === ctx.localAuthPersonnel.id) {
      return { success: false, error: 'You cannot remove your own account. Sign out instead.' };
    }
    if (target.role === 'admin' && countAdmins(ctx) <= 1) {
      return { success: false, error: 'Cannot remove the last admin.' };
    }

    ctx.personnelRepo.remove(validId);
    logPersonnelRemoved(ctx, target);
    return { success: true };
  });

  ipcMain.handle('personnel:updateRole', (event, id: unknown, role: unknown) => {
    const validId = z.string().min(1).parse(id);
    const validRole = personnelRoleSchema.parse(role);
    const ctx = resolveContext(event);

    if (!ctx.localAuthPersonnel || ctx.localAuthPersonnel.role !== 'admin') {
      return { success: false, error: 'Only admins can change roles.' };
    }
    const target = ctx.personnelRepo.getById(validId);
    if (!target) {
      return { success: false, error: 'Person not found.' };
    }
    if (target.role === validRole) {
      return { success: true };
    }
    if (target.role === 'admin' && countAdmins(ctx) <= 1) {
      return { success: false, error: 'Cannot demote the last admin.' };
    }

    ctx.personnelRepo.save({ ...target, role: validRole });
    logPersonnelRoleChanged(ctx, target, validRole);
    return { success: true };
  });
}

function countAdmins(ctx: import('../window/window-context').WindowContext): number {
  return ctx.personnelRepo.getAll().filter((p) => p.role === 'admin').length;
}
