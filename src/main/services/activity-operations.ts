import type { WindowContext } from '../window/window-context';
import { activityChangeSchema, type ActivityChange } from '../../shared/activity-change-types';
import { assertApplicationPermission } from './application-access';
import { transactionsBulkSave } from './transaction-operations';
import { plannedBulkSave } from './planned-operations';
import { activityNotesDelete, activityNotesSave } from './activity-note-operations';

/** Atomic label/note changes. Versions and notes are checked before any write;
 * only the activity field is mutable through this operation. The returned
 * inverse uses the newly saved versions, so Undo/Redo cannot overwrite edits. */
export function activitiesApplyChange(ctx: WindowContext, raw: unknown): ActivityChange {
  assertApplicationPermission(ctx, 'ledgerUse');
  const input = activityChangeSchema.parse(raw);
  return ctx.sqlite.transaction(() => {
    const notes = ctx.repos.activityNotes.getAll();
    const transactions = input.transactions.map((change) => {
      const current = ctx.transactionRepo.getById(change.id);
      if (!current || current.version !== change.version || current.activity !== change.expectedActivity) throw new Error('An activity entry changed. Refresh before continuing.');
      return { ...current, activity: change.activity, version: current.version + 1 };
    });
    const templates = input.templates.map((change) => {
      const current = ctx.plannedRepo.getById(change.id);
      if (!current || current.version !== change.version || current.activity !== change.expectedActivity) throw new Error('An activity plan changed. Refresh before continuing.');
      return { ...current, activity: change.activity, version: current.version + 1 };
    });
    for (const change of input.notes) {
      if ((notes[change.name] ?? null) !== change.expected) throw new Error('An activity note changed or the destination already has a note. Refresh before continuing.');
    }
    if (transactions.length) transactionsBulkSave(ctx, transactions);
    if (templates.length) plannedBulkSave(ctx, templates);
    for (const change of input.notes) {
      if (change.text === null) activityNotesDelete(ctx, change.name);
      else activityNotesSave(ctx, change.name, change.text);
    }
    return {
      transactions: input.transactions.map((change) => ({ ...change, version: change.version + 1, expectedActivity: change.activity, activity: change.expectedActivity })),
      templates: input.templates.map((change) => ({ ...change, version: change.version + 1, expectedActivity: change.activity, activity: change.expectedActivity })),
      notes: input.notes.map((change) => ({ name: change.name, expected: change.text, text: change.expected })),
    };
  })();
}
