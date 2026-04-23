import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  deriveKeys,
  encrypt,
  decrypt,
  computeHmac,
  verifyHmac,
  encryptAndSign,
  verifyAndDecrypt,
  BundleIntegrityError,
  BundleCryptoError,
  SEALED_HEADER_LENGTH,
} from '../bundle-crypto';

describe('deriveKeys', () => {
  it('produces deterministic output with same salt', () => {
    const salt = crypto.randomBytes(32);
    const a = deriveKeys('password', salt);
    const b = deriveKeys('password', salt);
    expect(a.aesKey.equals(b.aesKey)).toBe(true);
    expect(a.hmacKey.equals(b.hmacKey)).toBe(true);
  });

  it('produces different output with different passphrase', () => {
    const salt = crypto.randomBytes(32);
    const a = deriveKeys('password1', salt);
    const b = deriveKeys('password2', salt);
    expect(a.aesKey.equals(b.aesKey)).toBe(false);
  });

  it('produces different output with different salt', () => {
    const a = deriveKeys('password', crypto.randomBytes(32));
    const b = deriveKeys('password', crypto.randomBytes(32));
    expect(a.aesKey.equals(b.aesKey)).toBe(false);
  });

  it('produces correct key lengths', () => {
    const { aesKey, hmacKey, salt } = deriveKeys('test');
    expect(aesKey.length).toBe(32);
    expect(hmacKey.length).toBe(32);
    expect(salt.length).toBe(32);
  });
});

describe('encrypt / decrypt', () => {
  const key = crypto.randomBytes(32);

  it('round-trips plaintext', () => {
    const plaintext = Buffer.from('hello world');
    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('produces different ciphertext per call (random IV)', () => {
    const plaintext = Buffer.from('same data');
    const a = encrypt(plaintext, key);
    const b = encrypt(plaintext, key);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.iv.equals(b.iv)).toBe(false);
  });

  it('rejects wrong key', () => {
    const plaintext = Buffer.from('secret');
    const encrypted = encrypt(plaintext, key);
    const wrongKey = crypto.randomBytes(32);
    expect(() => decrypt(encrypted, wrongKey)).toThrow(BundleCryptoError);
  });

  it('rejects corrupted ciphertext', () => {
    const plaintext = Buffer.from('secret');
    const encrypted = encrypt(plaintext, key);
    encrypted.ciphertext[0] ^= 0xff;
    expect(() => decrypt(encrypted, key)).toThrow(BundleCryptoError);
  });

  it('handles empty plaintext', () => {
    const plaintext = Buffer.alloc(0);
    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);
    expect(decrypted.length).toBe(0);
  });
});

describe('HMAC', () => {
  const key = crypto.randomBytes(32);

  it('verifies valid HMAC', () => {
    const data = Buffer.from('test data');
    const hmac = computeHmac(data, key);
    expect(verifyHmac(data, hmac, key)).toBe(true);
  });

  it('rejects wrong data', () => {
    const data = Buffer.from('test data');
    const hmac = computeHmac(data, key);
    expect(verifyHmac(Buffer.from('wrong data'), hmac, key)).toBe(false);
  });

  it('rejects wrong key', () => {
    const data = Buffer.from('test data');
    const hmac = computeHmac(data, key);
    expect(verifyHmac(data, hmac, crypto.randomBytes(32))).toBe(false);
  });
});

describe('encryptAndSign / verifyAndDecrypt', () => {
  const passphrase = 'test-passphrase-123';

  it('round-trips plaintext', () => {
    const plaintext = Buffer.from('hello sync world');
    const sealed = encryptAndSign(plaintext, passphrase);
    const decrypted = verifyAndDecrypt(sealed, passphrase);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('rejects wrong passphrase', () => {
    const plaintext = Buffer.from('secret');
    const sealed = encryptAndSign(plaintext, passphrase);
    expect(() => verifyAndDecrypt(sealed, 'wrong-passphrase')).toThrow();
  });

  it('rejects corrupted HMAC', () => {
    const sealed = encryptAndSign(Buffer.from('data'), passphrase);
    // HMAC is at offset 60 (salt:32 + iv:12 + authTag:16)
    sealed[60] ^= 0xff;
    expect(() => verifyAndDecrypt(sealed, passphrase)).toThrow(BundleIntegrityError);
  });

  it('rejects corrupted ciphertext', () => {
    const sealed = encryptAndSign(Buffer.from('data'), passphrase);
    // Ciphertext starts after header (92 bytes)
    if (sealed.length > SEALED_HEADER_LENGTH) {
      sealed[SEALED_HEADER_LENGTH] ^= 0xff;
    }
    expect(() => verifyAndDecrypt(sealed, passphrase)).toThrow();
  });

  it('rejects truncated buffer', () => {
    const sealed = encryptAndSign(Buffer.from('data'), passphrase);
    const truncated = sealed.subarray(0, SEALED_HEADER_LENGTH - 1);
    expect(() => verifyAndDecrypt(truncated, passphrase)).toThrow(BundleIntegrityError);
  });

  it('handles large payload (100KB)', () => {
    const large = crypto.randomBytes(100 * 1024);
    const sealed = encryptAndSign(large, passphrase);
    const decrypted = verifyAndDecrypt(sealed, passphrase);
    expect(decrypted.equals(large)).toBe(true);
  });

  it('handles empty plaintext', () => {
    const sealed = encryptAndSign(Buffer.alloc(0), passphrase);
    const decrypted = verifyAndDecrypt(sealed, passphrase);
    expect(decrypted.length).toBe(0);
  });
});
