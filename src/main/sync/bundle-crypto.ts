import crypto from 'node:crypto';

// ─── Error types ────────────────────────────────────────────────────

export class BundleIntegrityError extends Error {
  constructor(message = 'Bundle integrity check failed (HMAC mismatch)') {
    super(message);
    this.name = 'BundleIntegrityError';
  }
}

export class BundleCryptoError extends Error {
  constructor(message = 'Bundle decryption failed') {
    super(message);
    this.name = 'BundleCryptoError';
  }
}

// ─── Constants ──────────────────────────────────────────────────────

const PBKDF2_ITERATIONS = 600_000; // OWASP 2023 recommendation
const SALT_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const HMAC_LENGTH = 32;
const DERIVED_KEY_LENGTH = 64; // 32 AES + 32 HMAC

/** Fixed header size: salt(32) + iv(12) + authTag(16) + hmac(32) = 92 */
export const SEALED_HEADER_LENGTH = SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + HMAC_LENGTH;

// ─── Key derivation ─────────────────────────────────────────────────

export interface DerivedKeys {
  aesKey: Buffer;
  hmacKey: Buffer;
  salt: Buffer;
}

export function deriveKeys(passphrase: string, salt?: Buffer): DerivedKeys {
  const actualSalt = salt ?? crypto.randomBytes(SALT_LENGTH);
  const derived = crypto.pbkdf2Sync(
    passphrase,
    actualSalt,
    PBKDF2_ITERATIONS,
    DERIVED_KEY_LENGTH,
    'sha256',
  );
  return {
    aesKey: derived.subarray(0, 32),
    hmacKey: derived.subarray(32, 64),
    salt: actualSalt,
  };
}

// ─── AES-256-GCM encryption ────────────────────────────────────────

export interface EncryptedPayload {
  iv: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
}

export function encrypt(plaintext: Buffer, aesKey: Buffer): EncryptedPayload {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { iv, ciphertext, authTag };
}

export function decrypt(payload: EncryptedPayload, aesKey: Buffer): Buffer {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, payload.iv);
    decipher.setAuthTag(payload.authTag);
    return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
  } catch {
    throw new BundleCryptoError();
  }
}

// ─── HMAC ───────────────────────────────────────────────────────────

export function computeHmac(data: Buffer, hmacKey: Buffer): Buffer {
  return crypto.createHmac('sha256', hmacKey).update(data).digest();
}

export function verifyHmac(data: Buffer, expectedHmac: Buffer, hmacKey: Buffer): boolean {
  const actual = computeHmac(data, hmacKey);
  return crypto.timingSafeEqual(actual, expectedHmac);
}

// ─── High-level API ─────────────────────────────────────────────────

/**
 * Encrypt plaintext and produce a sealed buffer.
 *
 * Binary format: [salt:32][iv:12][authTag:16][hmac:32][ciphertext:variable]
 * HMAC covers: salt + iv + authTag + ciphertext (encrypt-then-MAC)
 */
export function encryptAndSign(plaintext: Buffer, passphrase: string): Buffer {
  const { aesKey, hmacKey, salt } = deriveKeys(passphrase);
  const { iv, ciphertext, authTag } = encrypt(plaintext, aesKey);

  // HMAC covers everything except itself
  const hmacInput = Buffer.concat([salt, iv, authTag, ciphertext]);
  const hmac = computeHmac(hmacInput, hmacKey);

  return Buffer.concat([salt, iv, authTag, hmac, ciphertext]);
}

/**
 * Verify HMAC, then decrypt a sealed buffer.
 * Throws BundleIntegrityError on HMAC failure, BundleCryptoError on decryption failure.
 */
export function verifyAndDecrypt(sealed: Buffer, passphrase: string): Buffer {
  if (sealed.length < SEALED_HEADER_LENGTH) {
    throw new BundleIntegrityError('Sealed buffer too short');
  }

  let offset = 0;
  const salt = sealed.subarray(offset, offset += SALT_LENGTH);
  const iv = sealed.subarray(offset, offset += IV_LENGTH);
  const authTag = sealed.subarray(offset, offset += AUTH_TAG_LENGTH);
  const hmac = sealed.subarray(offset, offset += HMAC_LENGTH);
  const ciphertext = sealed.subarray(offset);

  // Re-derive keys from salt
  const { aesKey, hmacKey } = deriveKeys(passphrase, Buffer.from(salt));

  // Verify HMAC first (encrypt-then-MAC: verify before decrypting)
  const hmacInput = Buffer.concat([salt, iv, authTag, ciphertext]);
  if (!verifyHmac(hmacInput, Buffer.from(hmac), hmacKey)) {
    throw new BundleIntegrityError();
  }

  return decrypt({ iv: Buffer.from(iv), ciphertext: Buffer.from(ciphertext), authTag: Buffer.from(authTag) }, aesKey);
}
