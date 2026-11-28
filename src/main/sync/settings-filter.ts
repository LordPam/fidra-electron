import type { CrChangesetRow } from './bundle-format';
import { isOrgKey } from '../database/settings-repo';

export function settingsKey(row: CrChangesetRow): string {
  const raw = Buffer.isBuffer(row.pk) ? row.pk.toString('utf8') : row.pk;
  // eslint-disable-next-line no-control-regex -- cr-sqlite text-key header for known setting keys.
  return raw.replace(/^[\x00-\x1f]+/, '');
}

export function isOrgChangeset(row: CrChangesetRow): boolean {
  return row.table !== 'settings' || isOrgKey(settingsKey(row));
}

export function isImportableSyncRow(row: CrChangesetRow, expectedGroupId: string): boolean {
  if (row.table !== 'settings') return true;
  if (settingsKey(row) === 'localSync.groupId'
    && (row.cid === '-1' || (row.cid === 'value' && row.val !== expectedGroupId)
      || (row.cid === 'scope' && row.val !== 'org'))) {
    throw new Error('A sync bundle attempted to change the immutable team identity. Review is required.');
  }
  return isOrgChangeset(row);
}
