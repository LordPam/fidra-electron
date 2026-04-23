import crypto from 'node:crypto';

const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_LEN = 32;
const SCRYPT_OPTIONS: crypto.ScryptOptions = { N: 16384, r: 8, p: 1 };

const WRAP_KEYLEN = 32; // AES-256
const WRAP_SALT_LEN = 16;
const WRAP_IV_LEN = 12; // AES-256-GCM
const WRAP_ITERATIONS = 100_000;
const WRAP_DIGEST = 'sha256';

/**
 * Hash a password using scrypt. Returns "scrypt:<salt_hex>:<hash_hex>".
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SCRYPT_SALT_LEN);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

/**
 * Verify a password against a stored hash (timing-safe comparison).
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);

  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/**
 * Encrypt a sync passphrase with a user's password (key-wrapping).
 * Uses PBKDF2 to derive an AES-256-GCM key from the password.
 * Returns the encrypted passphrase and salt (both hex-encoded).
 */
export function wrapPassphrase(
  syncPassphrase: string,
  userPassword: string,
): { encrypted: string; salt: string } {
  const salt = crypto.randomBytes(WRAP_SALT_LEN);
  const key = crypto.pbkdf2Sync(userPassword, salt, WRAP_ITERATIONS, WRAP_KEYLEN, WRAP_DIGEST);
  const iv = crypto.randomBytes(WRAP_IV_LEN);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(syncPassphrase, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: iv_hex:tag_hex:encrypted_hex
  const combined = `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  return { encrypted: combined, salt: salt.toString('hex') };
}

/**
 * Decrypt a sync passphrase with a user's password.
 * Throws on wrong password or corrupted data.
 */
export function unwrapPassphrase(
  encrypted: string,
  salt: string,
  userPassword: string,
): string {
  const saltBuf = Buffer.from(salt, 'hex');
  const key = crypto.pbkdf2Sync(userPassword, saltBuf, WRAP_ITERATIONS, WRAP_KEYLEN, WRAP_DIGEST);

  const parts = encrypted.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted passphrase format');

  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const ciphertext = Buffer.from(parts[2], 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf-8');
}
