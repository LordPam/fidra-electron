import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

for (const returning of [false, true]) {
  test(returning ? 'an existing person joins another device with their existing password' : 'an invitation fills recipient details and joins without choosing a local filename', async ({ app, window, userHome }) => {
    const folder = path.join(userHome, 'shared'); fs.mkdirSync(folder);
    expect(await window.evaluate((syncFolder) => window.api.localSyncConfigure({ syncFolder, passphrase: 'synthetic-team-passphrase' }), folder)).toMatchObject({ success: true });
    expect(await window.evaluate(() => window.api.localAuthCreateFirstAdmin({ name: 'Admin', email: 'admin@example.test', password: 'admin-password', syncPassphrase: 'synthetic-team-passphrase' }))).toMatchObject({ success: true });
    const recipient = returning ? { name: 'Admin', email: 'admin@example.test', role: 'admin' as const } : { name: 'Sam', email: 'sam@example.test', role: 'member' as const };
    const invited = await window.evaluate((person) => window.api.localAuthInviteMember(person), recipient);
    expect(invited.success, invited.error).toBe(true); expect(invited.invitation?.existingAccount).toBe(returning);
    const descriptor = path.join(folder, 'Join.fidra-invite');
    await app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, descriptor);
    expect(await window.evaluate((invitation) => window.api.saveInvitation(invitation), invited.invitation!)).toBe(true);
    const nextWindow = app.waitForEvent('window');
    await window.evaluate((file) => window.api.createWindow(file), path.join(userHome, 'recipient-shell.fdra'));
    const second = await nextWindow; await second.getByRole('heading', { name: 'Dashboard' }).waitFor();
    await second.evaluate(() => window.dispatchEvent(new CustomEvent('fidra:showFileChooser')));
    await second.getByRole('button', { name: 'Join Local Sync', exact: true }).click();
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, descriptor);
    await second.getByRole('button', { name: 'Open invitation', exact: true }).click();
    await expect(second.getByLabel('Sync Folder', { exact: true })).toHaveValue(folder);
    await expect(second.getByText(new RegExp(recipient.email))).toBeVisible();
    const password = second.getByLabel(returning ? 'Your existing password' : 'Choose a password', { exact: true });
    if (returning) {
      await expect(second.getByLabel('Confirm Password', { exact: true })).toHaveCount(0);
      await password.fill('wrong-password'); await second.getByRole('button', { name: 'Join', exact: true }).click();
      await expect(second.getByText('Incorrect password', { exact: true })).toBeVisible();
      expect(fs.readdirSync(path.join(userHome, '.fidra', 'accounts')).filter((name) => name.endsWith('.fdra'))).toHaveLength(1);
    }
    await password.fill(returning ? 'admin-password' : 'member-password');
    if (!returning) await second.getByLabel('Confirm Password', { exact: true }).fill('member-password');
    await second.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(second.getByRole('heading', { name: `Welcome back, ${recipient.name}` })).toBeVisible();
    const status = await second.evaluate(() => window.api.localAuthGetStatus());
    expect(status.isAuthenticated).toBe(true); expect(status.personnel?.email).toBe(recipient.email);
    expect(await second.evaluate(() => window.api.getDbPath())).toContain(path.join('.fidra', 'accounts'));
  });
}
