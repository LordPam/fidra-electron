import type Database from 'better-sqlite3';
import type { SheetRow } from '../../shared/ipc-types';

export class SheetRepo {
  constructor(private readonly db: Database.Database) {}

  getAll(): SheetRow[] {
    return this.db
      .prepare('SELECT * FROM sheets WHERE is_virtual = 0 AND is_planned = 0 ORDER BY sort_order, name')
      .all() as SheetRow[];
  }

  getByName(name: string): SheetRow | null {
    return (this.db.prepare('SELECT * FROM sheets WHERE name = ?').get(name) as SheetRow) ?? null;
  }

  create(id: string, name: string): SheetRow {
    const now = new Date().toISOString();
    const maxOrder = (this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM sheets WHERE is_virtual = 0 AND is_planned = 0').get() as { m: number }).m;
    this.db.prepare('INSERT INTO sheets (id, name, is_virtual, is_planned, sort_order, created_at) VALUES (?, ?, 0, 0, ?, ?)').run(
      id, name, maxOrder + 1, now,
    );
    return { id, name, is_virtual: 0, is_planned: 0, sort_order: maxOrder + 1, created_at: now };
  }

  reorder(orderedIds: string[]): void {
    const stmt = this.db.prepare('UPDATE sheets SET sort_order = ? WHERE id = ?');
    const tx = this.db.transaction(() => {
      orderedIds.forEach((id, index) => {
        stmt.run(index, id);
      });
    });
    tx();
  }

  remove(id: string): boolean {
    const result = this.db.prepare('DELETE FROM sheets WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // Sheets are referenced by NAME in three places: transactions.sheet,
  // planned_templates.target_sheet, and planned_templates.transfer_target_sheet
  // (the destination sheet of a transfer template's income side). All three must
  // cascade together or a template ends up pointing at a sheet that no longer exists.
  renameSheet(oldName: string, newName: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE sheets SET name = ? WHERE name = ?').run(newName, oldName);
      this.db.prepare('UPDATE transactions SET sheet = ? WHERE sheet = ?').run(newName, oldName);
      this.db.prepare('UPDATE planned_templates SET target_sheet = ? WHERE target_sheet = ?').run(newName, oldName);
      this.db.prepare('UPDATE planned_templates SET transfer_target_sheet = ? WHERE transfer_target_sheet = ?').run(newName, oldName);
    });
    tx();
  }

  mergeAndDelete(sourceId: string, sourceName: string, targetName: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE transactions SET sheet = ? WHERE sheet = ?').run(targetName, sourceName);
      this.db.prepare('UPDATE planned_templates SET target_sheet = ? WHERE target_sheet = ?').run(targetName, sourceName);
      this.db.prepare('UPDATE planned_templates SET transfer_target_sheet = ? WHERE transfer_target_sheet = ?').run(targetName, sourceName);
      this.db.prepare('DELETE FROM sheets WHERE id = ?').run(sourceId);
    });
    tx();
  }

  deleteWithTransactions(id: string, name: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM attachments WHERE transaction_id IN (SELECT id FROM transactions WHERE sheet = ?)').run(name);
      this.db.prepare('DELETE FROM transactions WHERE sheet = ?').run(name);
      this.db.prepare('DELETE FROM planned_templates WHERE target_sheet = ?').run(name);
      // Templates that live on another sheet but transfer INTO this one survive;
      // they lose their (now dangling) destination and become plain planned rows.
      this.db.prepare('UPDATE planned_templates SET transfer_target_sheet = NULL WHERE transfer_target_sheet = ?').run(name);
      this.db.prepare('DELETE FROM sheets WHERE id = ?').run(id);
    });
    tx();
  }

  deleteSimple(id: string): boolean {
    const result = this.db.prepare('DELETE FROM sheets WHERE id = ?').run(id);
    return result.changes > 0;
  }

  restoreWithSort(sheet: SheetRow): SheetRow {
    this.db.prepare(
      'INSERT INTO sheets (id, name, is_virtual, is_planned, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(sheet.id, sheet.name, sheet.is_virtual, sheet.is_planned, sheet.sort_order, sheet.created_at);
    return sheet;
  }

  getTransactionsOnSheet(name: string): import('../../shared/ipc-types').TransactionRow[] {
    return this.db.prepare('SELECT * FROM transactions WHERE sheet = ?').all(name) as import('../../shared/ipc-types').TransactionRow[];
  }

  /**
   * Every template affected by an operation on this sheet — templates that live on it
   * plus templates that transfer into it. Callers snapshot this before rename/merge/delete
   * so undo can restore both `target_sheet` and `transfer_target_sheet`.
   */
  getPlannedOnSheet(name: string): import('../../shared/ipc-types').PlannedTemplateRow[] {
    return this.db.prepare(
      'SELECT * FROM planned_templates WHERE target_sheet = ? OR transfer_target_sheet = ?',
    ).all(name, name) as import('../../shared/ipc-types').PlannedTemplateRow[];
  }

  getAttachmentsOnSheet(name: string): import('../../shared/ipc-types').AttachmentRow[] {
    return this.db.prepare(
      'SELECT a.* FROM attachments a INNER JOIN transactions t ON a.transaction_id = t.id WHERE t.sheet = ?',
    ).all(name) as import('../../shared/ipc-types').AttachmentRow[];
  }
}
