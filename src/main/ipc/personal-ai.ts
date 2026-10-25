import { app, ipcMain, powerMonitor } from 'electron';
import { z } from 'zod';
import { resolveContext } from './context-resolver';
import { getWindowManager } from '../window/window-manager';
import { personalAiAccess, personalAiBridge, retireOldAiTrial } from '../services/ai-runtime';
import { reconciliationApprovalSchema } from '../../shared/reconciliation-types';
import type { WindowContext } from '../window/window-context';
import { aiAccessPolicySchema } from '../../shared/ai-access-types';

function requireUser(context: WindowContext): string {
  if (context.isClosed || getWindowManager().isPreparingOperation) throw new Error('Fidra is preparing to close.');
  if (context.isLocalSyncAuthEnabled && !context.localAuthPersonnel) throw new Error('Sign in to this ledger first.');
  return context.localAuthPersonnel?.email ?? 'Local user';
}
export function registerPersonalAiHandlers(): void {
  try { retireOldAiTrial(); } catch { console.warn('[AI] Old trial files could not be removed; financial startup is continuing.'); }
  ipcMain.handle('ai:getState', (event) => {
    const context = resolveContext(event); requireUser(context);
    const sessionIds = new Set(personalAiBridge.connections(context).map((session) => session.id));
    return { access: personalAiAccess.state(context), proposals: context.reconciliation.list().filter((proposal) => sessionIds.has(proposal.grantId)) };
  });
  ipcMain.handle('ai:approveAccess', (event, raw: unknown) => {
    const context = resolveContext(event); requireUser(context);
    const input = z.object({ requestId: z.string().uuid(), policy: aiAccessPolicySchema }).strict().parse(raw);
    personalAiAccess.approve(context, input.requestId, input.policy);
  });
  ipcMain.handle('ai:denyAccess', (event, raw: unknown) => {
    const context = resolveContext(event); requireUser(context);
    personalAiAccess.deny(context, z.string().uuid().parse(raw));
  });
  ipcMain.handle('ai:revokeAccess', (event, raw: unknown) => {
    const context = resolveContext(event); requireUser(context);
    personalAiAccess.revoke(context, z.string().uuid().parse(raw));
  });
  ipcMain.handle('ai:unlockOwner', (event, raw: unknown) => {
    const context = resolveContext(event); requireUser(context);
    const input = z.object({ name: z.string().trim().min(1).max(100), password: z.string().min(12).max(200) }).strict().parse(raw);
    personalAiAccess.unlockOwner(context, input.name, input.password);
  });
  ipcMain.handle('ai:discard', (event, raw: unknown) => {
    const context = resolveContext(event); requireUser(context);
    context.reconciliation.discard(z.string().uuid().parse(raw)); context.sendToRenderer('ai:changed');
  });
  ipcMain.handle('ai:approve', (event, raw: unknown) => {
    const context = resolveContext(event); const actor = requireUser(context);
    const approval = reconciliationApprovalSchema.parse(raw);
    const proposal = context.reconciliation.list().find((item) => item.id === approval.id);
    if (!proposal) throw new Error('This proposal no longer exists.');
    personalAiBridge.requireConnection(context, proposal.grantId);
    const result = context.reconciliation.commit(approval, actor); context.sendToRenderer('ai:changed'); return result;
  });
  ipcMain.handle('ai:undo', (event, raw: unknown) => {
    const context = resolveContext(event); const actor = requireUser(context);
    context.reconciliation.undo(z.string().uuid().parse(raw), actor); context.sendToRenderer('ai:changed');
  });
  void personalAiAccess.start().catch((error: unknown) => console.warn('[AI] Local connection unavailable:', String(error)));
  const prune = setInterval(() => personalAiBridge.prune(), 30_000);
  powerMonitor.on('lock-screen', () => personalAiAccess.pause());
  powerMonitor.on('suspend', () => personalAiAccess.pause());
  powerMonitor.on('unlock-screen', () => personalAiAccess.resume());
  powerMonitor.on('resume', () => personalAiAccess.resume());
  app.once('will-quit', () => { clearInterval(prune); personalAiAccess.stop(); });
}
