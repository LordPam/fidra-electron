import { ipcMain } from 'electron';
import { resolveContext } from './context-resolver';
import * as operations from '../services/activity-note-operations';
import { activitiesApplyChange } from '../services/activity-operations';

export function registerActivityNotesHandlers(): void {
  ipcMain.handle('activities:applyChange', (event, raw: unknown) => activitiesApplyChange(resolveContext(event), raw));
  ipcMain.handle('activityNotes:getAll', (event) => {
    return operations.activityNotesGetAll(resolveContext(event));
  });

  ipcMain.handle('activityNotes:save', (event, activity: unknown, notes: unknown) => {
    return operations.activityNotesSave(resolveContext(event), activity, notes);
  });

  ipcMain.handle('activityNotes:delete', (event, activity: unknown) => {
    return operations.activityNotesDelete(resolveContext(event), activity);
  });
}
