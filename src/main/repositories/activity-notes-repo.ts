import type Database from 'better-sqlite3';

export class ActivityNotesRepo {
  constructor(private readonly db: Database.Database) {}

  getAll(): Record<string, string> {
    const rows = this.db.prepare('SELECT activity, notes FROM activity_notes').all() as {
      activity: string;
      notes: string;
    }[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.activity] = row.notes;
    }
    return result;
  }

  save(activity: string, notes: string): void {
    // Use INSERT + UPDATE (not INSERT OR REPLACE) so cr-sqlite only bumps
    // col_version for columns whose values actually changed.
    const existing = this.db.prepare('SELECT 1 FROM activity_notes WHERE activity = ?').get(activity);
    if (existing) {
      this.db.prepare('UPDATE activity_notes SET notes = ? WHERE activity = ?').run(notes, activity);
    } else {
      this.db.prepare('INSERT INTO activity_notes (activity, notes) VALUES (?, ?)').run(activity, notes);
    }
  }

  remove(activity: string): void {
    this.db.prepare('DELETE FROM activity_notes WHERE activity = ?').run(activity);
  }
}
