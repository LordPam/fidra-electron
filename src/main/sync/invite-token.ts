import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { wrapPassphrase, unwrapPassphrase } from './key-wrap';
import { syncLog, errorMessage } from './sync-log';

const INVITES_SUBDIR = 'invites';
const INVITE_EXT = '.invite';

/** Unambiguous character set (no 0/O/1/I/L) for human-readable invite codes. */
const INVITE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_CODE_LEN = 8;

/**
 * Generate a random invite code from unambiguous characters.
 * Example output: "K7NP3HWR"
 */
export function generateInviteCode(): string {
  const bytes = crypto.randomBytes(INVITE_CODE_LEN);
  let code = '';
  for (let i = 0; i < INVITE_CODE_LEN; i++) {
    code += INVITE_CHARS[bytes[i] % INVITE_CHARS.length];
  }
  return code;
}

/**
 * SHA-256 hex hash of a lowercased, trimmed email address.
 * Used as the invite filename to avoid exposing emails on disk.
 */
export function hashEmail(email: string): string {
  return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

/**
 * Write an invite token to the sync folder.
 * The token contains the sync passphrase wrapped (AES-256-GCM) with the invitee's password.
 * At join time, the invitee provides email + password to decrypt the passphrase.
 *
 * @returns The path to the written invite file.
 */
export function writeInviteToken(
  syncFolder: string,
  email: string,
  password: string,
  syncPassphrase: string,
): string {
  const invitesDir = path.join(syncFolder, INVITES_SUBDIR);
  fs.mkdirSync(invitesDir, { recursive: true });

  const filename = hashEmail(email) + INVITE_EXT;
  const filePath = path.join(invitesDir, filename);

  const wrapped = wrapPassphrase(syncPassphrase, password);
  const data = JSON.stringify({ encrypted: wrapped.encrypted, salt: wrapped.salt });

  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, data, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch { /* already gone */ }
    throw e;
  }

  syncLog('info', 'Invite token written', { email: email.toLowerCase().trim() });
  return filePath;
}

/**
 * Read an invite token from the sync folder and decrypt the sync passphrase.
 *
 * @returns The decrypted sync passphrase, or null if no invite file exists for this email.
 * @throws On wrong password (AES-GCM auth tag mismatch) or corrupted data.
 */
export function readInviteToken(
  syncFolder: string,
  email: string,
  password: string,
): string | null {
  const filename = hashEmail(email) + INVITE_EXT;
  const filePath = path.join(syncFolder, INVITES_SUBDIR, filename);

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw e;
  }

  const parsed = JSON.parse(raw) as { encrypted: string; salt: string };
  // unwrapPassphrase throws on wrong password (AES-GCM auth tag mismatch)
  return unwrapPassphrase(parsed.encrypted, parsed.salt, password);
}

/**
 * Delete an invite token from the sync folder (best-effort cleanup).
 * Called after a successful join to prevent token reuse.
 */
export function deleteInviteToken(syncFolder: string, email: string): void {
  const filename = hashEmail(email) + INVITE_EXT;
  const filePath = path.join(syncFolder, INVITES_SUBDIR, filename);

  try {
    fs.unlinkSync(filePath);
    syncLog('info', 'Invite token deleted', { email: email.toLowerCase().trim() });
  } catch (e) {
    // Best-effort — file may already be gone
    syncLog('warn', 'Invite token delete failed (best-effort)', { error: errorMessage(e) });
  }
}
