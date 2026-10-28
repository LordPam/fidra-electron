import { aiRunSyncSchema as runSchema } from '../../shared/ai-application-tools';
import type { WindowContext } from '../window/window-context';
import { assertAiOperationAccess, type AiOperationAccess } from './ai-operation-access';
import { syncExportNow, syncGetStatus, syncImportNow } from './sync-operations';

export function aiRunSync(ctx: WindowContext, access: AiOperationAccess, raw: unknown) {
  assertAiOperationAccess(ctx, access, 'sync.run');
  const input = runSchema.parse(raw);
  if (!syncGetStatus(ctx).enabled || !ctx.localSyncOrchestrator) throw new Error('Synchronization is stopped. Open its setup inside Fidra to reconnect.');
  const exported = input.direction !== 'import' ? syncExportNow(ctx) : null;
  assertAiOperationAccess(ctx, access, 'sync.run');
  const imported = input.direction !== 'export' ? syncImportNow(ctx) : null;
  return { exported, imported, instructions: 'Any critical-field conflicts remain queued for human review in Fidra.' };
}
