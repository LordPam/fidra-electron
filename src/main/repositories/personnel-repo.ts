import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { PersonnelRecord } from '../../shared/auth-types';

type PersonnelInput = Omit<PersonnelRecord, 'created_at' | 'password_hash' | 'encrypted_passphrase' | 'passphrase_salt' | 'device_id' | 'isActive'> & {
  created_at?: string;
  password_hash?: string | null;
  encrypted_passphrase?: string | null;
  passphrase_salt?: string | null;
  device_id?: string | null;
};

const COLUMNS = 'id, email, name, role, auth_uid, created_at, invited_by, password_hash, encrypted_passphrase, passphrase_salt, device_id';

/** Raw row from SQLite — no computed fields yet. */
type RawPersonnelRow = Omit<PersonnelRecord, 'isActive'>;

/** Enrich a raw row with computed `isActive`. */
function enrich(row: RawPersonnelRow): PersonnelRecord {
  return { ...row, isActive: !!(row.auth_uid || row.password_hash) };
}

function enrichOrNull(row: RawPersonnelRow | undefined): PersonnelRecord | null {
  return row ? enrich(row) : null;
}

export class PersonnelRepo {
  constructor(private readonly db: Database.Database) {}

  getAll(): PersonnelRecord[] {
    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM personnel ORDER BY name`)
      .all() as RawPersonnelRow[];
    return rows.map(enrich);
  }

  getById(id: string): PersonnelRecord | null {
    return enrichOrNull(
      this.db
        .prepare(`SELECT ${COLUMNS} FROM personnel WHERE id = ?`)
        .get(id) as RawPersonnelRow | undefined,
    );
  }

  getByEmail(email: string): PersonnelRecord | null {
    return enrichOrNull(
      this.db
        .prepare(`SELECT ${COLUMNS} FROM personnel WHERE email = ? COLLATE NOCASE`)
        .get(email) as RawPersonnelRow | undefined,
    );
  }

  getByDeviceId(deviceId: string): PersonnelRecord | null {
    return enrichOrNull(
      this.db
        .prepare(`SELECT ${COLUMNS} FROM personnel WHERE device_id = ?`)
        .get(deviceId) as RawPersonnelRow | undefined,
    );
  }

  save(record: PersonnelInput): PersonnelRecord {
    const id = record.id || crypto.randomUUID();
    const createdAt = record.created_at || new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO personnel (id, email, name, role, auth_uid, created_at, invited_by, password_hash, encrypted_passphrase, passphrase_salt, device_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           email = excluded.email,
           name = excluded.name,
           role = excluded.role,
           auth_uid = excluded.auth_uid,
           invited_by = excluded.invited_by,
           password_hash = excluded.password_hash,
           encrypted_passphrase = excluded.encrypted_passphrase,
           passphrase_salt = excluded.passphrase_salt,
           device_id = excluded.device_id`,
      )
      .run(
        id,
        record.email,
        record.name,
        record.role,
        record.auth_uid ?? null,
        createdAt,
        record.invited_by ?? null,
        record.password_hash ?? null,
        record.encrypted_passphrase ?? null,
        record.passphrase_salt ?? null,
        record.device_id ?? null,
      );

    return this.getById(id)!;
  }

  updateAuth(
    id: string,
    passwordHash: string,
    encryptedPassphrase: string,
    passphraseSalt: string,
  ): boolean {
    const result = this.db
      .prepare(
        'UPDATE personnel SET password_hash = ?, encrypted_passphrase = ?, passphrase_salt = ? WHERE id = ?',
      )
      .run(passwordHash, encryptedPassphrase, passphraseSalt, id);
    return result.changes > 0;
  }

  updateDeviceId(id: string, deviceId: string): boolean {
    // Skip if already set to the same value — avoids generating a spurious
    // CRR changeset on every startup that would trigger peer notifications.
    const current = this.db
      .prepare('SELECT device_id FROM personnel WHERE id = ?')
      .get(id) as { device_id: string | null } | undefined;
    if (current?.device_id === deviceId) return false;

    const result = this.db
      .prepare('UPDATE personnel SET device_id = ? WHERE id = ?')
      .run(deviceId, id);
    return result.changes > 0;
  }

  remove(id: string): boolean {
    const result = this.db.prepare('DELETE FROM personnel WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
