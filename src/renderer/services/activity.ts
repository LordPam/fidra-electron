/**
 * Activity domain operations: rename, delete, note persistence.
 * These handle data snapshots, undo command creation, and IPC calls.
 * UI orchestration (selection, animation) remains in the view.
 */

import type { TransactionRow, PlannedTemplateRow } from '../../shared/ipc-types';
import { useUndoStore } from '@/stores/undo-store';
import {
  createRenameActivityCommand,
  createDeleteActivityCommand,
  createEditActivityNoteCommand,
} from '@/services/undo';

interface RenameParams {
  oldName: string;
  newName: string;
  transactions: TransactionRow[];
  templates: PlannedTemplateRow[];
  activityNotes: Record<string, string>;
  refreshNotes: () => Promise<void>;
}

/**
 * Rename an activity across all transactions, templates, and notes.
 * Snapshots before/after state and executes via undo system.
 */
export async function renameActivity(params: RenameParams): Promise<void> {
  const { oldName, newName, transactions, templates, activityNotes, refreshNotes } = params;

  const oldTxns = transactions.filter((t) => t.activity === oldName);
  const oldTempls = templates.filter((t) => t.activity === oldName);
  const noteText = activityNotes[oldName];

  const cmd = createRenameActivityCommand(
    oldName, newName, oldTxns, oldTempls, noteText, refreshNotes,
  );
  await useUndoStore.getState().execute(cmd);
}

interface DeleteParams {
  activity: string;
  transactions: TransactionRow[];
  templates: PlannedTemplateRow[];
  activityNotes: Record<string, string>;
  refreshNotes: () => Promise<void>;
}

/**
 * Delete an activity by clearing it from all transactions, templates, and notes.
 * Snapshots before/after state and executes via undo system.
 */
export async function deleteActivity(params: DeleteParams): Promise<void> {
  const { activity, transactions, templates, activityNotes, refreshNotes } = params;

  const oldTxns = transactions.filter((t) => t.activity === activity);
  const oldTempls = templates.filter((t) => t.activity === activity);
  const noteText = activity in activityNotes ? activityNotes[activity] : undefined;

  const cmd = createDeleteActivityCommand(
    activity, oldTxns, oldTempls, noteText, refreshNotes,
  );
  await useUndoStore.getState().execute(cmd);
}

interface PersistNoteParams {
  activity: string;
  text: string;
  oldText: string;
  refreshNotes: () => Promise<void>;
}

/**
 * Persist an activity note via the undo command system.
 * Uses execute() so the IPC call is part of the command lifecycle.
 */
export async function persistActivityNote(params: PersistNoteParams): Promise<void> {
  const { activity, text, oldText, refreshNotes } = params;

  const cmd = createEditActivityNoteCommand(activity, oldText, text, refreshNotes);
  await useUndoStore.getState().execute(cmd);
}
