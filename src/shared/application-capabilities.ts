import { z } from 'zod';

/** These are consent capabilities, not a generic IPC or repository allowlist. */
export const applicationCapabilitySchema = z.enum([
  'transactions.read', 'transactions.manage', 'transactions.delete',
  'planned.read', 'planned.manage', 'planned.delete', 'transfers.manage',
  'sheets.manage', 'categories.manage', 'activities.manage',
  'invoices.read', 'invoices.manage', 'invoices.delete',
  'settings.read', 'settings.manage',
  'backups.read', 'backups.create', 'backups.restore', 'backups.delete', 'backups.manage',
  'sync.read', 'sync.run', 'sync.manage', 'personnel.read', 'personnel.manage', 'device.manage',
]);
export type ApplicationCapability = z.infer<typeof applicationCapabilitySchema>;

export const applicationCapabilityDetails: Record<ApplicationCapability, {
  label: string; ledgerWide: boolean; nativeReview: boolean;
}> = {
  'transactions.read': { label: 'Read transactions in permitted accounts', ledgerWide: false, nativeReview: false },
  'transactions.manage': { label: 'Create and edit transactions', ledgerWide: false, nativeReview: false },
  'transactions.delete': { label: 'Delete transactions', ledgerWide: false, nativeReview: true },
  'planned.read': { label: 'Read planned payments', ledgerWide: false, nativeReview: false },
  'planned.manage': { label: 'Create, edit and fulfil planned payments', ledgerWide: false, nativeReview: false },
  'planned.delete': { label: 'Delete planned payments', ledgerWide: false, nativeReview: true },
  'transfers.manage': { label: 'Record and edit internal ledger transfers', ledgerWide: false, nativeReview: false },
  'sheets.manage': { label: 'Create, rename, merge, delete and reorder accounts', ledgerWide: true, nativeReview: true },
  'categories.manage': { label: 'Manage ledger categories', ledgerWide: true, nativeReview: false },
  'activities.manage': { label: 'Manage activities and their notes', ledgerWide: true, nativeReview: false },
  'invoices.read': { label: 'Read invoices and their billing details', ledgerWide: true, nativeReview: false },
  'invoices.manage': { label: 'Create and manage invoices and linked entries', ledgerWide: true, nativeReview: false },
  'invoices.delete': { label: 'Delete invoices', ledgerWide: true, nativeReview: true },
  'settings.read': { label: 'Read supported application settings', ledgerWide: true, nativeReview: false },
  'settings.manage': { label: 'Change supported application settings', ledgerWide: true, nativeReview: false },
  'backups.read': { label: 'List this ledger’s backups', ledgerWide: true, nativeReview: false },
  'backups.create': { label: 'Create ledger backups', ledgerWide: true, nativeReview: false },
  'backups.restore': { label: 'Request restoration of a ledger backup', ledgerWide: true, nativeReview: true },
  'backups.delete': { label: 'Request deletion of ledger backups', ledgerWide: true, nativeReview: true },
  'backups.manage': { label: 'Manage backup settings', ledgerWide: true, nativeReview: true },
  'sync.read': { label: 'Read synchronization status', ledgerWide: true, nativeReview: false },
  'sync.run': { label: 'Run synchronization', ledgerWide: true, nativeReview: false },
  'sync.manage': { label: 'Open synchronization setup, maintenance and conflict review', ledgerWide: true, nativeReview: true },
  'personnel.read': { label: 'Read team names, emails and roles', ledgerWide: true, nativeReview: false },
  'personnel.manage': { label: 'Manage team roles, membership and invitations', ledgerWide: true, nativeReview: true },
  'device.manage': { label: 'Open application update and device-management workflows', ledgerWide: true, nativeReview: true },
};
