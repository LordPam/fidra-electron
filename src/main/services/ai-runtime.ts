import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { AiBridge } from './ai-bridge';
import { getWindowManager } from '../window/window-manager';
import { createBackup, getBackupSettings } from './backup-service';

export const aiBridgeResourceDirectory = path.join(app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'), 'ai-bridge');
export const fidraAiWorkflow = fs.readFileSync(path.join(aiBridgeResourceDirectory, 'skills', 'fidra-reconcile', 'SKILL.md'), 'utf8');

export const personalAiBridge = new AiBridge({
  directory: path.join(os.homedir(), '.fidra', 'ai-connections'),
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
