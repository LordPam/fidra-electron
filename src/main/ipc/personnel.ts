import { ipcMain } from 'electron';
import { z } from 'zod';
import { resolveContext } from './context-resolver';
import { personnelRoleSchema } from '../../shared/ipc-schemas';
import { listPersonnel, removePersonnel, updatePersonnelRole } from '../services/personnel-administration';

export function registerPersonnelHandlers(): void {
  ipcMain.handle('personnel:getAll', (event) => {
    return listPersonnel(resolveContext(event));
  });

  ipcMain.handle('personnel:remove', (event, id: unknown) => {
    const validId = z.string().min(1).parse(id);
    return removePersonnel(resolveContext(event), validId);
  });

  ipcMain.handle('personnel:updateRole', (event, id: unknown, role: unknown) => {
    const validId = z.string().min(1).parse(id);
    const validRole = personnelRoleSchema.parse(role);
    return updatePersonnelRole(resolveContext(event), validId, validRole);
  });
}
