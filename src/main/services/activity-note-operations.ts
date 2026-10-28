import { z } from 'zod';
import type { WindowContext } from '../window/window-context';
import { assertApplicationPermission } from './application-access';

/** Shared desktop/external application operations. Each entry validates before repository access. */
export function activityNotesGetAll(ctx: WindowContext) {
  assertApplicationPermission(ctx, 'ledgerUse');
  return ctx.repos.activityNotes.getAll();
}

export function activityNotesSave(ctx: WindowContext, activity: unknown, notes: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validActivity = z.string().parse(activity);
  const validNotes = z.string().parse(notes);
  ctx.repos.activityNotes.save(validActivity, validNotes);
}

export function activityNotesDelete(ctx: WindowContext, activity: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validActivity = z.string().parse(activity);
  ctx.repos.activityNotes.remove(validActivity);
}
