import type Database from 'better-sqlite3';
import type { PlannedTemplateRow } from '../../shared/ipc-types';

export class PlannedRepo {
  constructor(private readonly db: Database.Database) {}

  getAll(): PlannedTemplateRow[] {
    return this.db
      .prepare('SELECT * FROM planned_templates ORDER BY start_date ASC')
      .all() as PlannedTemplateRow[];
  }

  getById(id: string): PlannedTemplateRow | null {
    return (this.db.prepare('SELECT * FROM planned_templates WHERE id = ?').get(id) as PlannedTemplateRow) ?? null;
  }

  save(data: PlannedTemplateRow): PlannedTemplateRow {
    const existing = this.db.prepare('SELECT 1 FROM planned_templates WHERE id = ?').get(data.id);
    if (existing) {
      this.db.prepare(
        `UPDATE planned_templates SET start_date=?, description=?, amount=?, type=?,
         frequency=?, target_sheet=?, category=?, party=?, activity=?,
         end_date=?, occurrence_count=?, skipped_dates=?, fulfilled_dates=?, version=?
         WHERE id=?`,
      ).run(
        data.start_date, data.description, data.amount, data.type,
        data.frequency, data.target_sheet, data.category, data.party, data.activity,
        data.end_date, data.occurrence_count, data.skipped_dates, data.fulfilled_dates,
        data.version, data.id,
      );
    } else {
      this.db.prepare(
        `INSERT INTO planned_templates
         (id, start_date, description, amount, type, frequency, target_sheet,
          category, party, activity, end_date, occurrence_count,
          skipped_dates, fulfilled_dates, version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        data.id, data.start_date, data.description, data.amount, data.type,
        data.frequency, data.target_sheet, data.category, data.party, data.activity,
        data.end_date, data.occurrence_count, data.skipped_dates, data.fulfilled_dates,
        data.version, data.created_at,
      );
    }
    return data;
  }

  bulkSave(templates: PlannedTemplateRow[]): PlannedTemplateRow[] {
    // Use INSERT + UPDATE (not INSERT OR REPLACE) so cr-sqlite only bumps
    // col_version for columns whose values actually changed.
    const insertStmt = this.db.prepare(
      `INSERT INTO planned_templates
       (id, start_date, description, amount, type, frequency, target_sheet,
        category, party, activity, end_date, occurrence_count,
        skipped_dates, fulfilled_dates, version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updateStmt = this.db.prepare(
      `UPDATE planned_templates SET start_date=?, description=?, amount=?, type=?,
       frequency=?, target_sheet=?, category=?, party=?, activity=?,
       end_date=?, occurrence_count=?, skipped_dates=?, fulfilled_dates=?,
       version=? WHERE id=?`,
    );
    const existsStmt = this.db.prepare('SELECT 1 FROM planned_templates WHERE id = ?');

    const run = this.db.transaction((items: PlannedTemplateRow[]) => {
      for (const data of items) {
        if (existsStmt.get(data.id)) {
          updateStmt.run(
            data.start_date, data.description, data.amount, data.type,
            data.frequency, data.target_sheet, data.category, data.party, data.activity,
            data.end_date, data.occurrence_count, data.skipped_dates, data.fulfilled_dates,
            data.version, data.id,
          );
        } else {
          insertStmt.run(
            data.id, data.start_date, data.description, data.amount, data.type,
            data.frequency, data.target_sheet, data.category, data.party, data.activity,
            data.end_date, data.occurrence_count, data.skipped_dates, data.fulfilled_dates,
            data.version, data.created_at,
          );
        }
      }
      return items;
    });
    return run(templates);
  }

  remove(id: string): boolean {
    const result = this.db.prepare('DELETE FROM planned_templates WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
