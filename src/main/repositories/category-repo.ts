import crypto from 'node:crypto';
import type Database from 'better-sqlite3';

export class CategoryRepo {
  constructor(private readonly db: Database.Database) {}

  getAll(type: string): string[] {
    const rows = this.db
      .prepare('SELECT name FROM categories WHERE type = ? ORDER BY sort_order, name')
      .all(type) as { name: string }[];
    return rows.map((r) => r.name);
  }

  setAll(type: string, names: string[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM categories WHERE type = ?').run(type);
      const stmt = this.db.prepare(
        'INSERT INTO categories (id, type, name, sort_order) VALUES (?, ?, ?, ?)',
      );
      names.forEach((name, index) => {
        stmt.run(crypto.randomUUID(), type, name, index);
      });
    });
    tx();
  }
}
