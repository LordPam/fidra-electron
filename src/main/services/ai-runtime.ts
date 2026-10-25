import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { app, safeStorage } from 'electron';
import { AiAuthorizationStore } from './ai-authorization-store';
import { retireLegacyAiConnections } from './ai-legacy-cleanup';
import { AiAccessBroker } from './ai-access-broker';
import { AiBridge } from './ai-bridge';
import { getWindowManager } from '../window/window-manager';
import { createBackup, getBackupSettings } from './backup-service';

export const aiBridgeResourceDirectory = path.join(app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'), 'ai-bridge');
export const fidraAiWorkflow = fs.readFileSync(path.join(aiBridgeResourceDirectory, 'skills', 'fidra-reconcile', 'SKILL.md'), 'utf8');

export const personalAiBridge = new AiBridge({
  instructions: fidraAiWorkflow,
  isCurrent: (context) => getWindowManager().getContext(context.window.webContents.id) === context,
  isPreparing: () => getWindowManager().isPreparingOperation,
  onChanged: (context) => context.sendToRenderer('ai:changed'),
  beforeApply: async (context) => { await createBackup(context.sqlite, context.dbPath, context.databaseId, 'manual', getBackupSettings(context.settingsRepo)); },
  onCommitted: (context, approval) => {
    context.sendToRenderer('ai:importCommitted', approval);
    for (const other of getWindowManager().getAllContexts()) {
      if (!other.isClosed && fs.realpathSync(other.dbPath) === fs.realpathSync(context.dbPath)) {
        other.sendToRenderer('localSync:dataChanged', { tables: ['transactions', 'planned_templates', 'audit_log'] });
        other.sendToRenderer('ai:changed');
      }
    }
  },
});

export const personalAiAccess = new AiAccessBroker({
  discoveryFile: path.join(os.homedir(), '.fidra', 'ai-access', 'endpoint.json'),
  store: new AiAuthorizationStore(path.join(os.homedir(), '.fidra', 'ai-access', 'authorizations.enc'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value), decrypt: (value) => safeStorage.decryptString(value),
  }),
  bridge: personalAiBridge, contexts: () => getWindowManager().getAllContexts(),
  preparing: () => getWindowManager().isPreparingOperation,
  changed: () => { for (const ctx of getWindowManager().getAllContexts()) if (!ctx.isClosed) ctx.sendToRenderer('ai:changed'); },
});

export function retireOldAiTrial(): void { retireLegacyAiConnections(path.join(os.homedir(), '.fidra', 'ai-connections')); }
