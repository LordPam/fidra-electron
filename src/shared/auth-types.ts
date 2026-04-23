export type AuthMode = 'admin' | 'member' | 'localSync';
export type PersonnelRole = 'admin' | 'member';

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly personnelId: string;
}

export interface AuthSession {
  readonly user: AuthUser;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number; // Unix timestamp in seconds
}

export interface PersonnelRecord {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: PersonnelRole;
  readonly auth_uid: string | null;
  readonly created_at: string;
  readonly invited_by: string | null;
  readonly password_hash: string | null;
  readonly encrypted_passphrase: string | null;
  readonly passphrase_salt: string | null;
  readonly device_id: string | null;
  /** True if the person has completed auth setup (Cloud auth_uid or Local Sync password_hash). */
  readonly isActive: boolean;
}

export interface LocalAuthStatus {
  readonly authEnabled: boolean;
  readonly isAuthenticated: boolean;
  readonly personnel: PersonnelRecord | null;
  readonly isAdmin: boolean;
}
