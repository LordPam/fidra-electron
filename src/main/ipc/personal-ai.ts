import { app, dialog, ipcMain, powerMonitor } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { z } from 'zod';
import { resolveContext } from './context-resolver';
import { getWindowManager } from '../window/window-manager';
import { aiBridgeResourceDirectory, fidraAiWorkflow, personalAiBridge } from '../services/ai-runtime';
import { reconciliationScopeSchema, reconciliationApprovalSchema, reconciliationDraftSchema } from '../../shared/reconciliation-types';
import type { WindowContext } from '../window/window-context';
import { aiConnectionPermissionsSchema } from '../../shared/ai-bridge-types';

function requireUser(context: WindowContext): string {
  if (context.isClosed || getWindowManager().isPreparingOperation) throw new Error('Fidra is preparing to close.');
  if (context.isLocalSyncAuthEnabled && !context.localAuthPersonnel) throw new Error('Sign in to this ledger first.');
  return context.localAuthPersonnel?.email ?? 'Local user';
}
function changed(context: WindowContext): void {
  for (const other of getWindowManager().getAllContexts()) {
    if (!other.isClosed && fs.realpathSync(other.dbPath) === fs.realpathSync(context.dbPath)) {
      other.sendToRenderer('localSync:dataChanged', { tables: ['transactions', 'planned_templates', 'audit_log'] });
      other.sendToRenderer('ai:changed');
    }
  }
}

export function registerPersonalAiHandlers(): void {
  ipcMain.handle('ai:getState', (event) => {
    const context = resolveContext(event); requireUser(context);
    return { connections: personalAiBridge.connections(context), proposals: context.reconciliation.list(), statements: personalAiBridge.selectedStatements(context) };
  });
  ipcMain.handle('ai:connect', async (event, raw: unknown) => {
    const context = resolveContext(event); requireUser(context);
    const input = z.object({ client: z.enum(['claude', 'chatgpt']), scope: reconciliationScopeSchema, permissions: aiConnectionPermissionsSchema.optional() }).strict().parse(raw);
    return personalAiBridge.connect(context, input.client, input.scope, input.permissions);
  });
  ipcMain.handle('ai:selectStatement', async (event) => {
    const context = resolveContext(event); requireUser(context);
    const result = await dialog.showOpenDialog(context.window, { title: 'Select a bank statement to share',
      filters: [{ name: 'Bank statement', extensions: ['csv', 'pdf', 'txt'] }], properties: ['openFile'] });
    if (result.canceled || !result.filePaths[0]) return null;
    requireUser(context);
    return personalAiBridge.selectStatement(context, result.filePaths[0]);
  });
  ipcMain.handle('ai:exportContext', async (event, raw: unknown) => {
    const context = resolveContext(event); requireUser(context);
    const id = z.string().uuid().parse(raw);
    personalAiBridge.requireConnection(context, id);
    const result = await dialog.showSaveDialog(context.window, { title: 'Export selected context for your AI', defaultPath: 'Fidra-context.json', filters: [{ name: 'Selected AI context', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false;
    const selected = personalAiBridge.context(context, id);
    const contents = { format: 'fidra-context', version: 1, grantId: id, context: selected,
      proposalSchema: z.toJSONSchema(reconciliationDraftSchema),
      instructions: 'This is the file-exchange fallback: use the supplied context and statement in place of read_context/read_statement. Return a JSON file shaped as {"format":"fidra-proposal","version":1,"grantId":<grantId above>,"draft":<proposal matching proposalSchema>}. The user opens it in Fidra for validation and native approval; no MCP tool call is required for this route.',
      workflow: fidraAiWorkflow };
    fs.writeFileSync(result.filePath, JSON.stringify(contents, null, 2), { mode: 0o600, flag: 'wx' });
    return true;
  });
  ipcMain.handle('ai:openProposal', async (event) => {
    const context = resolveContext(event); requireUser(context);
    const result = await dialog.showOpenDialog(context.window, { title: 'Open a proposal from your AI', filters: [{ name: 'Statement proposal', extensions: ['json'] }], properties: ['openFile'] });
    if (result.canceled || !result.filePaths[0]) return null;
    requireUser(context);
    const file = result.filePaths[0];
    if (fs.statSync(file).size > 2_000_000) throw new Error('Select a proposal smaller than 2 MB.');
    const input = z.object({ format: z.literal('fidra-proposal'), version: z.literal(1), grantId: z.string().uuid(), draft: reconciliationDraftSchema }).strict().parse(JSON.parse(fs.readFileSync(file, 'utf8')));
    const proposal = personalAiBridge.stage(context, input.grantId, input.draft);
    context.sendToRenderer('ai:changed'); return proposal;
  });
  ipcMain.handle('ai:disconnect', (event, raw: unknown) => {
    const context = resolveContext(event); requireUser(context);
    const id = z.string().uuid().parse(raw);
    personalAiBridge.requireConnection(context, id); personalAiBridge.revoke(id);
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
    const result = context.reconciliation.commit(approval, actor); changed(context); return result;
  });
  ipcMain.handle('ai:undo', (event, raw: unknown) => {
    const context = resolveContext(event); const actor = requireUser(context);
    context.reconciliation.undo(z.string().uuid().parse(raw), actor); changed(context);
  });
  ipcMain.handle('ai:exportConnection', async (event, raw: unknown) => {
    const context = resolveContext(event); requireUser(context);
    const { info, file } = personalAiBridge.requireConnection(context, z.string().uuid().parse(raw));
    const client = info.client;
    const result = await dialog.showSaveDialog(context.window, { title: client === 'claude' ? 'Save Claude desktop connection' : 'Save ChatGPT desktop plugin',
      defaultPath: client === 'claude' ? 'Fidra.mcpb' : 'Fidra-ChatGPT.zip', filters: [{ name: 'Desktop connection', extensions: [client === 'claude' ? 'mcpb' : 'zip'] }] });
    if (result.canceled || !result.filePath) return false;
    // Revalidate consent after the native dialog, not just before opening it.
    personalAiBridge.requireConnection(context, info.id);
    const bridgePath = path.join(aiBridgeResourceDirectory, 'server.cjs');
    const zip = new JSZip(); zip.file('server/server.cjs', fs.readFileSync(bridgePath));
    for (const name of ['setup', 'fidra-reconcile']) zip.file(`skills/${name}/SKILL.md`, fs.readFileSync(path.join(aiBridgeResourceDirectory, 'skills', name, 'SKILL.md')));
    if (client === 'claude') zip.file('manifest.json', JSON.stringify({ manifest_version: '0.3', name: 'fidra', display_name: 'Fidra', version: '1.2.0',
      description: 'Reconcile statements with Fidra. Prepare drafts or add missing entries with explicit connection permission.', author: { name: 'Fidra' },
      server: { type: 'node', entry_point: 'server/server.cjs', mcp_config: { command: 'node', args: ['${__dirname}/server/server.cjs', '--connection-file', file] } },
      compatibility: { platforms: ['darwin', 'win32'], runtimes: { node: '>=18.0.0' } },
    }, null, 2));
    else {
      zip.file('plugin.json', JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'fidra', version: '1.2.0', description: 'Reconcile bank statements with Fidra. Add missing entries through an explicitly authorised connection, or prepare drafts.', author: { name: 'Fidra' }, extensions: { 'com.openai': { requires_local_executor: true, onboardingSkill: './skills/setup/SKILL.md' } } }, null, 2));
      zip.file('mcp.json', JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: { fidra: { type: 'stdio', command: 'node', args: ['${PLUGIN_ROOT}/server/server.cjs', '--connection-file', file] } } }, null, 2));
      zip.file('.agents/plugins/marketplace.json', JSON.stringify({ name: 'fidra-local', interface: { displayName: 'Fidra trial' }, plugins: [{ name: 'fidra', source: { source: 'local', path: './' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] }, null, 2));
    }
    zip.file('README.txt', 'Keep Fidra open and signed in. The connection expires after one hour; renew it in Fidra Settings. Only selected context is shared with your AI provider. Chat attachments and direct additions require separate permissions chosen in Fidra. Direct additions create a backup, pending entries, an audit trail and native Undo; existing actuals cannot be edited or deleted. Disconnect in Fidra Settings to revoke access.\n'
      + (client === 'claude' ? 'Open this .mcpb with Claude Desktop and install the extension.\n' : 'Unzip into a private local folder. This includes a local marketplace catalog at .agents/plugins/marketplace.json. Open that folder in ChatGPT desktop, restart if needed, then choose the Fidra trial marketplace in the Plugins Directory and install Fidra. A local Node runtime is required by this trial adapter. The actual client installation still needs verification. Public local-MCP submissions require approved-partner eligibility; private local-source testing is separate.\n'));
    fs.writeFileSync(result.filePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), { flag: 'wx', mode: 0o600 });
    return true;
  });
  const prune = setInterval(() => personalAiBridge.prune(), 30_000);
  powerMonitor.on('lock-screen', () => personalAiBridge.stop());
  powerMonitor.on('suspend', () => personalAiBridge.stop());
  app.once('will-quit', () => { clearInterval(prune); personalAiBridge.stop(); });
}
