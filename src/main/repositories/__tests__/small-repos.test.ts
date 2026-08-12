import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { CategoryRepo } from '../category-repo';
import { ActivityNotesRepo } from '../activity-notes-repo';
import { AttachmentRepo } from '../attachment-repo';
import type { AttachmentRow } from '../../../shared/ipc-types';

const SCHEMA = `
  CREATE TABLE categories (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
    name TEXT NOT NULL DEFAULT '',
    sort_order INTEGER DEFAULT 0
  );
  CREATE TABLE activity_notes (
    activity TEXT PRIMARY KEY NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE attachments (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    transaction_id TEXT NOT NULL DEFAULT '',
    filename TEXT NOT NULL DEFAULT '',
    stored_name TEXT NOT NULL DEFAULT '',
    mime_type TEXT,
    file_size INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ''
  );
`;

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
});

describe('CategoryRepo', () => {
  let repo: CategoryRepo;
  beforeEach(() => { repo = new CategoryRepo(db); });

  it('stores and returns names in the given order', () => {
    repo.setAll('expense', ['Kit', 'Travel', 'Socials']);

    expect(repo.getAll('expense')).toEqual(['Kit', 'Travel', 'Socials']);
  });

  it('keeps income and expense lists apart', () => {
    repo.setAll('expense', ['Kit']);
    repo.setAll('income', ['Subs']);

    expect(repo.getAll('expense')).toEqual(['Kit']);
    expect(repo.getAll('income')).toEqual(['Subs']);
  });

  it('replaces the whole list for a type, leaving the other alone', () => {
    repo.setAll('expense', ['Kit', 'Travel']);
    repo.setAll('income', ['Subs']);

    repo.setAll('expense', ['Travel']);

    expect(repo.getAll('expense')).toEqual(['Travel']);
    expect(repo.getAll('income')).toEqual(['Subs']);
  });

  it('accepts an empty list', () => {
    repo.setAll('expense', ['Kit']);
    repo.setAll('expense', []);

    expect(repo.getAll('expense')).toEqual([]);
  });

  it('gives every category a distinct id', () => {
    repo.setAll('expense', ['Kit', 'Travel']);

    const ids = (db.prepare('SELECT id FROM categories').all() as { id: string }[]).map((r) => r.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => id.length > 0)).toBe(true);
  });
});

describe('ActivityNotesRepo', () => {
  let repo: ActivityNotesRepo;
  beforeEach(() => { repo = new ActivityNotesRepo(db); });

  it('returns notes keyed by activity', () => {
    repo.save('Tour', 'Book coach');
    repo.save('Gala', 'Confirm entries');

    expect(repo.getAll()).toEqual({ Tour: 'Book coach', Gala: 'Confirm entries' });
  });

  it('overwrites rather than duplicating', () => {
    repo.save('Tour', 'First');
    repo.save('Tour', 'Second');

    expect(repo.getAll()).toEqual({ Tour: 'Second' });
  });

  it('removes an entry', () => {
    repo.save('Tour', 'Book coach');
    repo.remove('Tour');

    expect(repo.getAll()).toEqual({});
  });

  it('ignores removal of something that is not there', () => {
    expect(() => repo.remove('Nothing')).not.toThrow();
  });
});

describe('AttachmentRepo', () => {
  let repo: AttachmentRepo;
  beforeEach(() => { repo = new AttachmentRepo(db); });

  function attachment(overrides: Partial<AttachmentRow> & { id: string }): AttachmentRow {
    return {
      transaction_id: 'tx-1',
      filename: 'receipt.pdf',
      stored_name: 'stored.pdf',
      mime_type: 'application/pdf',
      file_size: 100,
      created_at: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('lists a transaction\'s attachments, newest first', () => {
    repo.save(attachment({ id: 'a1', created_at: '2026-01-01T00:00:00.000Z' }));
    repo.save(attachment({ id: 'a2', created_at: '2026-02-01T00:00:00.000Z' }));
    repo.save(attachment({ id: 'a3', transaction_id: 'tx-2' }));

    expect(repo.getForTransaction('tx-1').map((a) => a.id)).toEqual(['a2', 'a1']);
  });

  it('updates an existing row instead of inserting a second', () => {
    repo.save(attachment({ id: 'a1' }));
    repo.save(attachment({ id: 'a1', stored_name: 'renamed.pdf' }));

    const rows = repo.getForTransaction('tx-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].stored_name).toBe('renamed.pdf');
  });

  it('counts per transaction and omits those with none', () => {
    repo.save(attachment({ id: 'a1', transaction_id: 'tx-1' }));
    repo.save(attachment({ id: 'a2', transaction_id: 'tx-1' }));
    repo.save(attachment({ id: 'a3', transaction_id: 'tx-2' }));

    expect(repo.getCounts(['tx-1', 'tx-2', 'tx-3'])).toEqual({ 'tx-1': 2, 'tx-2': 1 });
  });

  it('returns no counts for an empty id list, without building an empty IN ()', () => {
    expect(repo.getCounts([])).toEqual({});
  });

  it('removes all attachments for a transaction and hands back what it removed', () => {
    repo.save(attachment({ id: 'a1' }));
    repo.save(attachment({ id: 'a2' }));
    repo.save(attachment({ id: 'a3', transaction_id: 'tx-2' }));

    const removed = repo.removeForTransaction('tx-1');

    // The caller needs these rows to move the files and to support undo
    expect(removed.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    expect(repo.getForTransaction('tx-1')).toEqual([]);
    expect(repo.getForTransaction('tx-2')).toHaveLength(1);
  });

  it('returns an empty list when a transaction has no attachments', () => {
    expect(repo.removeForTransaction('tx-none')).toEqual([]);
  });
});
