import { dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { invitationSchema } from '../../shared/invitation-types';
import { readInvitationFile, readInvitationIdentity } from '../sync/invitation';
import { resolveContext } from './context-resolver';

export function registerInvitationHandlers(): void {
  ipcMain.handle('invitation:save', async (event, raw: unknown) => {
    const ctx = resolveContext(event);
    if (ctx.localAuthPersonnel?.role !== 'admin') throw new Error('Only an administrator can save invitations.');
    const invitation = invitationSchema.parse(raw);
    const result = await dialog.showSaveDialog(ctx.window, {
      title: 'Save invitation to share', defaultPath: `Join-${invitation.id.slice(0, 8)}.fidra-invite`,
      filters: [{ name: 'Fidra invitation', extensions: ['fidra-invite'] }],
    });
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, JSON.stringify(invitation), { mode: 0o600, flag: 'wx' });
    return true;
  });
  ipcMain.handle('invitation:open', async (event) => {
    const ctx = resolveContext(event);
    const result = await dialog.showOpenDialog(ctx.window, {
      title: 'Open a Fidra invitation', filters: [{ name: 'Fidra invitation', extensions: ['fidra-invite'] }], properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0];
    const invitation = readInvitationFile(file);
    const parent = path.dirname(file);
    const candidate = path.basename(parent) === 'invites' ? path.dirname(parent) : parent;
    // Infer only a folder that actually contains the paired token. A descriptor
    // copied to Downloads cannot smuggle an arbitrary filesystem location.
    const { hashEmail } = await import('../sync/invite-token');
    const syncFolder = fs.existsSync(path.join(candidate, 'invites', `${hashEmail(invitation.email)}.invite`)) ? candidate : null;
    // Prefer authenticated team/recipient metadata whenever the paired token is
    // available. A descriptor copied elsewhere is authenticated during joining.
    const verified = syncFolder ? readInvitationIdentity(syncFolder, invitation.email, invitation.code) : null;
    return { invitation: verified ?? invitation, syncFolder };
  });
}
