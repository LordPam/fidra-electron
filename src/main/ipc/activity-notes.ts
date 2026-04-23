import { ipcMain } from 'electron';
import { z } from 'zod';
import { resolveContext } from './context-resolver';

export function registerActivityNotesHandlers(): void {
  ipcMain.handle('activityNotes:getAll', (event) => {
    return resolveContext(event).repos.activityNotes.getAll();
  });

  ipcMain.handle('activityNotes:save', (event, activity: unknown, notes: unknown) => {
    const validActivity = z.string().parse(activity);
    const validNotes = z.string().parse(notes);
    resolveContext(event).repos.activityNotes.save(validActivity, validNotes);
  });

  ipcMain.handle('activityNotes:delete', (event, activity: unknown) => {
    const validActivity = z.string().parse(activity);
    resolveContext(event).repos.activityNotes.remove(validActivity);
  });
}
