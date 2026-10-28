import type { PersonnelRecord } from '../../shared/auth-types';
import type { PersonnelRepo } from '../repositories/personnel-repo';

/** Trusted, live application state. A tool argument must never supply this context. */
export interface ApplicationAccessContext {
  readonly isClosed: boolean;
  readonly isLocalSyncAuthEnabled: boolean;
  readonly localAuthPersonnel: PersonnelRecord | null;
  readonly personnelRepo: Pick<PersonnelRepo, 'getById'>;
}

export type ApplicationActor =
  | { kind: 'standalone' }
  | { kind: 'team'; id: string; name: string; role: 'admin' | 'member' };

export type ApplicationPermission = 'ledgerUse' | 'ledgerAdministration' | 'teamAdministration';
export type ApplicationAccess =
  | { allowed: true; actor: ApplicationActor }
  | { allowed: false; error: string };

type TeamAccess =
  | { allowed: true; actor: Extract<ApplicationActor, { kind: 'team' }> }
  | { allowed: false; error: string };

/**
 * Shared user-authority ceiling for application operations.
 * External callers must ALSO pass their live broker/grant and resource checks.
 * A standalone UI user is not a team administrator; AI ownership remains a
 * separate native-unlock/consent requirement enforced by the access broker.
 */
export function checkApplicationPermission(
  context: ApplicationAccessContext,
  permission: 'teamAdministration',
): TeamAccess;
export function checkApplicationPermission(
  context: ApplicationAccessContext,
  permission: ApplicationPermission,
): ApplicationAccess;
export function checkApplicationPermission(
  context: ApplicationAccessContext,
  permission: ApplicationPermission,
): ApplicationAccess {
  if (context.isClosed) return { allowed: false, error: 'This ledger is closed.' };

  const signedIn = context.localAuthPersonnel;
  let actor: ApplicationActor;
  if (signedIn) {
    const current = context.personnelRepo.getById(signedIn.id);
    if (!current?.password_hash) {
      return { allowed: false, error: 'Your account is no longer active. Sign in again.' };
    }
    actor = { kind: 'team', id: current.id, name: current.name, role: current.role };
  } else if (context.isLocalSyncAuthEnabled) {
    return { allowed: false, error: 'Sign in to Fidra before continuing.' };
  } else {
    actor = { kind: 'standalone' };
  }

  if (permission === 'teamAdministration' && actor.kind !== 'team') {
    return { allowed: false, error: 'Team administration requires a signed-in Fidra administrator.' };
  }
  if (permission !== 'ledgerUse' && actor.kind === 'team' && actor.role !== 'admin') {
    return { allowed: false, error: 'Only admins can perform this operation.' };
  }
  return { allowed: true, actor };
}

/** Use at throwing application boundaries such as the existing ledger IPC. */
export function assertApplicationPermission(
  context: ApplicationAccessContext,
  permission: ApplicationPermission,
): ApplicationActor {
  const result = checkApplicationPermission(context, permission);
  if (!result.allowed) throw new Error(result.error);
  return result.actor;
}
