import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { invitationSchema, type FidraInvitation } from '../../shared/invitation-types';
import { hashEmail } from './invite-token';
import { wrapPassphrase, unwrapPassphrase } from './key-wrap';
import { z } from 'zod';

const payloadSchema = z.object({ invitation: invitationSchema, passphrase: z.string().min(1) }).strict();

export function createInvitation(info: Omit<FidraInvitation, 'version' | 'id' | 'code' | 'expiresAt'>): FidraInvitation {
  return invitationSchema.parse({ ...info, version: 1, id: crypto.randomUUID(), code: crypto.randomBytes(32).toString('hex').toUpperCase(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() });
}

/** Metadata is inside the authenticated encryption, rather than trusted from a descriptor. */
export function writeInvitationToken(folder: string, invitation: FidraInvitation, passphrase: string): void {
  const wrapped = wrapPassphrase(JSON.stringify({ invitation, passphrase }), invitation.code);
  const directory = path.join(folder, 'invites'); fs.mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, `${hashEmail(invitation.email)}.invite`);
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ version: 2, ...wrapped }), { mode: 0o600 });
  fs.renameSync(temporary, destination);
}

export function decodeInvitationPayload(encrypted: string, salt: string, code: string, email: string): { invitation: FidraInvitation; passphrase: string } {
  const payload = payloadSchema.parse(JSON.parse(unwrapPassphrase(encrypted, salt, code)));
  if (payload.invitation.code !== code || payload.invitation.email.toLowerCase() !== email.trim().toLowerCase()) throw new Error('Invitation does not match this person.');
  if (Date.parse(payload.invitation.expiresAt) <= Date.now()) throw new Error('This invitation has expired. Ask the team administrator for a new invitation.');
  return payload;
}

export function readInvitationIdentity(folder: string, email: string, code: string): FidraInvitation | null {
  const file = path.join(folder, 'invites', `${hashEmail(email)}.invite`);
  if (!fs.existsSync(file)) return null;
  if (fs.statSync(file).size > 16_384) throw new Error('Invitation file is too large.');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: number; encrypted: string; salt: string };
  return raw.version === 2 ? decodeInvitationPayload(raw.encrypted, raw.salt, code, email).invitation : null;
}

export function readInvitationFile(file: string): FidraInvitation {
  if (!file.endsWith('.fidra-invite') || fs.statSync(file).size > 16_384) throw new Error('Choose a valid Fidra invitation file.');
  const invitation = invitationSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (Date.parse(invitation.expiresAt) <= Date.now()) throw new Error('This invitation has expired. Ask for a new invitation.');
  return invitation;
}
