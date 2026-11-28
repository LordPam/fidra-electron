import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { encryptAndSign, verifyAndDecrypt } from './bundle-crypto';

const KEY = 'authority.key.v1';
const keySchema = z.object({ publicKey: z.string().min(1).max(4096), sealedPrivateKey: z.string().min(1) }).strict();

/** The private signing key is device-local, encrypted, and never a CRR row.
 * Sharing the transport passphrase does not share this signing key. Native IPC
 * additionally requires a current administrator before using the authority.
 */
export function ensureOrganisationAuthority(db: Database.Database, passphrase: string): string {
  const previous = db.prepare('SELECT value FROM sync_meta WHERE key = ?').pluck().get(KEY) as string | undefined;
  if (previous) return keySchema.parse(JSON.parse(previous)).publicKey;
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const sealedPrivateKey = encryptAndSign(pair.privateKey.export({ type: 'pkcs8', format: 'der' }), passphrase).toString('base64');
  db.prepare('INSERT INTO sync_meta (key, value) VALUES (?, ?)').run(KEY, JSON.stringify({ publicKey, sealedPrivateKey }));
  return publicKey;
}

export function hasOrganisationAuthority(db: Database.Database, publicKey: string): boolean {
  const value = db.prepare('SELECT value FROM sync_meta WHERE key = ?').pluck().get(KEY) as string | undefined;
  return !!value && keySchema.parse(JSON.parse(value)).publicKey === publicKey;
}

export function signOrganisationDecision(db: Database.Database, publicKey: string, passphrase: string, decision: unknown): string {
  const value = db.prepare('SELECT value FROM sync_meta WHERE key = ?').pluck().get(KEY) as string | undefined;
  if (!value) throw new Error('This device has no organisation signing key. Use the authorising device or reviewed recovery.');
  const key = keySchema.parse(JSON.parse(value));
  if (key.publicKey !== publicKey) throw new Error('The organisation signing authority does not match the pinned mailbox.');
  const privateKey = crypto.createPrivateKey({ key: verifyAndDecrypt(Buffer.from(key.sealedPrivateKey, 'base64'), passphrase), type: 'pkcs8', format: 'der' });
  return crypto.sign(null, Buffer.from(JSON.stringify(decision)), privateKey).toString('base64');
}

export function verifyOrganisationDecision(publicKey: string, decision: unknown, signature: string): boolean {
  const key = crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), type: 'spki', format: 'der' });
  return key.asymmetricKeyType === 'ed25519' && crypto.verify(null, Buffer.from(JSON.stringify(decision)), key, Buffer.from(signature, 'base64'));
}

export function authorityFingerprint(publicKey: string): string {
  return crypto.createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex');
}
