import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { PersonnelRepo } from '../personnel-repo';

const SCHEMA = `
  CREATE TABLE personnel (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    auth_uid TEXT,
    created_at TEXT NOT NULL DEFAULT '',
    invited_by TEXT
  );
  CREATE UNIQUE INDEX idx_personnel_email ON personnel(email);
`;

let db: Database.Database;
let repo: PersonnelRepo;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  repo = new PersonnelRepo(db);
});

describe('PersonnelRepo', () => {
  it('save + getAll returns saved records', () => {
    repo.save({ id: 'p1', email: 'a@b.com', name: 'Alice', role: 'admin', auth_uid: null, invited_by: null });
    repo.save({ id: 'p2', email: 'b@b.com', name: 'Bob', role: 'member', auth_uid: null, invited_by: 'p1' });

    const all = repo.getAll();
    expect(all).toHaveLength(2);
    expect(all[0].name).toBe('Alice');
    expect(all[1].name).toBe('Bob');
  });

  it('getById returns correct record', () => {
    repo.save({ id: 'p1', email: 'a@b.com', name: 'Alice', role: 'admin', auth_uid: 'uid-1', invited_by: null });

    const found = repo.getById('p1');
    expect(found).not.toBeNull();
    expect(found!.email).toBe('a@b.com');
    expect(found!.auth_uid).toBe('uid-1');
  });

  it('getById returns null for missing id', () => {
    expect(repo.getById('nonexistent')).toBeNull();
  });

  it('getByEmail returns correct record', () => {
    repo.save({ id: 'p1', email: 'alice@test.com', name: 'Alice', role: 'member', auth_uid: null, invited_by: null });

    const found = repo.getByEmail('alice@test.com');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('p1');
  });

  it('getByEmail returns null for missing email', () => {
    expect(repo.getByEmail('nobody@test.com')).toBeNull();
  });

  it('remove returns true for existing record', () => {
    repo.save({ id: 'p1', email: 'a@b.com', name: 'Alice', role: 'admin', auth_uid: null, invited_by: null });
    expect(repo.remove('p1')).toBe(true);
    expect(repo.getById('p1')).toBeNull();
  });

  it('remove returns false for missing record', () => {
    expect(repo.remove('nonexistent')).toBe(false);
  });

  it('enforces UNIQUE constraint on email', () => {
    repo.save({ id: 'p1', email: 'same@test.com', name: 'Alice', role: 'admin', auth_uid: null, invited_by: null });
    expect(() =>
      repo.save({ id: 'p2', email: 'same@test.com', name: 'Bob', role: 'member', auth_uid: null, invited_by: null }),
    ).toThrow();
  });

  it('allows nullable auth_uid and invited_by', () => {
    const record = repo.save({
      id: 'p1',
      email: 'a@b.com',
      name: 'Alice',
      role: 'admin',
      auth_uid: null,
      invited_by: null,
    });
    expect(record.auth_uid).toBeNull();
    expect(record.invited_by).toBeNull();
  });

  it('updates existing record on save with same id (upsert)', () => {
    repo.save({ id: 'p1', email: 'old@b.com', name: 'Alice', role: 'member', auth_uid: null, invited_by: null });
    repo.save({ id: 'p1', email: 'new@b.com', name: 'Alice Updated', role: 'admin', auth_uid: 'uid-1', invited_by: null });

    const updated = repo.getById('p1');
    expect(updated!.email).toBe('new@b.com');
    expect(updated!.name).toBe('Alice Updated');
    expect(updated!.role).toBe('admin');
    expect(updated!.auth_uid).toBe('uid-1');
  });

  it('generates id if empty string provided', () => {
    const record = repo.save({ id: '', email: 'a@b.com', name: 'Alice', role: 'member', auth_uid: null, invited_by: null });
    expect(record.id).toBeTruthy();
    expect(record.id.length).toBeGreaterThan(0);
  });

  it('sets created_at automatically if not provided', () => {
    const record = repo.save({ id: 'p1', email: 'a@b.com', name: 'Alice', role: 'member', auth_uid: null, invited_by: null });
    expect(record.created_at).toBeTruthy();
  });
});
