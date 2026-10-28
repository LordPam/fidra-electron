import type { WindowContext } from '../window/window-context';
import type { AiAccessPolicy } from '../../shared/ai-access-types';
import { applicationCapabilityDetails, type ApplicationCapability } from '../../shared/application-capabilities';
import { assertApplicationPermission } from './application-access';

/** Constructed only by the authenticated broker, never from tool arguments. */
export interface AiOperationAccess {
  policy: AiAccessPolicy;
  isCurrent(): boolean;
}

export function assertAiOperationAccess(ctx: WindowContext, access: AiOperationAccess, capability: ApplicationCapability): void {
  if (!access.isCurrent()) throw new Error('This connection is paused or revoked.');
  assertApplicationPermission(ctx, capability.startsWith('personnel.') ? 'teamAdministration'
    : ['settings.manage', 'backups.restore', 'backups.delete', 'backups.manage', 'sync.manage', 'device.manage'].includes(capability)
      ? 'ledgerAdministration' : 'ledgerUse');
  if (!access.policy.permissions.capabilities.includes(capability)) throw new Error(`This connection does not have permission for ${capability}. Request a new approval inside Fidra.`);
  if (applicationCapabilityDetails[capability].ledgerWide && !access.policy.permissions.allAccounts) {
    throw new Error('This operation requires explicit ledger-wide access.');
  }
}

export function aiPermittedAccounts(ctx: WindowContext, access: AiOperationAccess, requested?: string[]) {
  const available = ctx.sheetRepo.getAll().filter((sheet) => !sheet.is_virtual && !sheet.is_planned);
  const permitted = available.filter((sheet) => access.policy.permissions.allAccounts || access.policy.sheetIds.includes(sheet.id));
  if (requested?.some((id) => !permitted.some((sheet) => sheet.id === id))) throw new Error('An account is missing or outside the approved permission.');
  return requested ? permitted.filter((sheet) => requested.includes(sheet.id)) : permitted;
}
