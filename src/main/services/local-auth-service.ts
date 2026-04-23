import type { PersonnelRepo } from '../repositories/personnel-repo';
import type { PersonnelRecord, PersonnelRole } from '../../shared/auth-types';
import { hashPassword, verifyPassword, wrapPassphrase, unwrapPassphrase } from '../sync/key-wrap';
import crypto from 'node:crypto';

interface AuthResult {
  success: boolean;
  personnel?: PersonnelRecord;
  syncPassphrase?: string;
  error?: string;
}

export class LocalAuthService {
  constructor(private readonly personnelRepo: PersonnelRepo) {}

  /**
   * Sign in with email + password. Verifies credentials and unwraps the sync passphrase.
   */
  signIn(email: string, password: string): AuthResult {
    const personnel = this.personnelRepo.getByEmail(email);
    if (!personnel) {
      return { success: false, error: 'No account found for this email' };
    }
    if (!personnel.password_hash) {
      return { success: false, error: 'Account not yet activated — use your invite code to set a password first' };
    }

    if (!verifyPassword(password, personnel.password_hash)) {
      return { success: false, error: 'Incorrect password' };
    }

    if (!personnel.encrypted_passphrase || !personnel.passphrase_salt) {
      return { success: false, error: 'Account not fully configured — missing sync passphrase data' };
    }

    try {
      const syncPassphrase = unwrapPassphrase(
        personnel.encrypted_passphrase,
        personnel.passphrase_salt,
        password,
      );
      return { success: true, personnel, syncPassphrase };
    } catch {
      return { success: false, error: 'Failed to decrypt sync passphrase — credentials may be corrupted' };
    }
  }

  /**
   * Create the first admin account. Only allowed when no auth personnel exist.
   */
  createFirstAdmin(
    name: string,
    email: string,
    password: string,
    syncPassphrase: string,
  ): AuthResult {
    if (this.hasAuthPersonnel()) {
      return { success: false, error: 'An admin account already exists' };
    }

    const passwordHash = hashPassword(password);
    const { encrypted, salt } = wrapPassphrase(syncPassphrase, password);

    const personnel = this.personnelRepo.save({
      id: crypto.randomUUID(),
      email,
      name,
      role: 'admin' as PersonnelRole,
      auth_uid: null,
      invited_by: null,
      password_hash: passwordHash,
      encrypted_passphrase: encrypted,
      passphrase_salt: salt,
    });

    return { success: true, personnel, syncPassphrase };
  }

  /**
   * Invite a member. Creates personnel record WITHOUT password — the joiner
   * sets their own password when they join via invite code.
   */
  inviteMember(
    name: string,
    email: string,
    role: PersonnelRole,
    invitedBy?: string,
  ): { success: boolean; record?: PersonnelRecord; error?: string } {
    // Check for duplicate email
    const existing = this.personnelRepo.getByEmail(email);
    if (existing) {
      return { success: false, error: 'A user with this email already exists' };
    }

    const record = this.personnelRepo.save({
      id: crypto.randomUUID(),
      email,
      name,
      role,
      auth_uid: null,
      invited_by: invitedBy ?? null,
      password_hash: null,
      encrypted_passphrase: null,
      passphrase_salt: null,
    });

    return { success: true, record };
  }

  /**
   * Set password + key-wrapped passphrase for a personnel record (used during join).
   * Called on the joiner's newly-created DB after snapshot import.
   */
  static setPasswordForPersonnel(
    personnelRepo: PersonnelRepo,
    email: string,
    password: string,
    syncPassphrase: string,
  ): { success: boolean; error?: string } {
    const person = personnelRepo.getByEmail(email);
    if (!person) {
      return { success: false, error: 'Personnel record not found for this email' };
    }

    const passwordHash = hashPassword(password);
    const { encrypted, salt } = wrapPassphrase(syncPassphrase, password);
    personnelRepo.updateAuth(person.id, passwordHash, encrypted, salt);
    return { success: true };
  }

  /**
   * Change password: verify old password, unwrap passphrase, re-hash, re-wrap.
   */
  changePassword(
    personnelId: string,
    oldPassword: string,
    newPassword: string,
  ): { success: boolean; error?: string } {
    const personnel = this.personnelRepo.getById(personnelId);
    if (!personnel || !personnel.password_hash) {
      return { success: false, error: 'Account not found' };
    }

    if (!verifyPassword(oldPassword, personnel.password_hash)) {
      return { success: false, error: 'Current password is incorrect' };
    }

    if (!personnel.encrypted_passphrase || !personnel.passphrase_salt) {
      return { success: false, error: 'Account not fully configured' };
    }

    let syncPassphrase: string;
    try {
      syncPassphrase = unwrapPassphrase(
        personnel.encrypted_passphrase,
        personnel.passphrase_salt,
        oldPassword,
      );
    } catch {
      return { success: false, error: 'Failed to decrypt passphrase' };
    }

    const newHash = hashPassword(newPassword);
    const { encrypted, salt } = wrapPassphrase(syncPassphrase, newPassword);

    this.personnelRepo.updateAuth(personnelId, newHash, encrypted, salt);
    return { success: true };
  }

  /**
   * Check if any personnel record has a password_hash set (= auth is configured).
   */
  hasAuthPersonnel(): boolean {
    const all = this.personnelRepo.getAll();
    return all.some((p) => p.password_hash != null);
  }
}
