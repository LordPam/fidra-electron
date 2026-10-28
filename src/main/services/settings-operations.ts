import { z } from 'zod';
import type { WindowContext } from '../window/window-context';
import type { InvoiceDefaults } from '../../shared/ipc-types';
import { profileSchema, transactionSettingsSchema, invoiceDefaultsSchema, uiPreferencesSchema } from '../../shared/ipc-schemas';
import { getUiPreferences, saveUiPreferences } from '../window/global-settings';
import { assertApplicationPermission } from './application-access';

/**
 * Resolve the current user's display name.
 * Priority: auth session email → local profile (initials > name) → null.
 */
export function settingsGetCurrentUser(ctx: import('../window/window-context').WindowContext): { displayName: string; source: 'auth' | 'profile' | 'none' } | null {
  assertApplicationPermission(ctx, 'ledgerUse');
  // 1. Auth session (Local Sync auth)
  if (ctx.authSession?.user?.email) {
    return { displayName: ctx.authSession.user.email, source: 'auth' };
  }

  // 2. Local profile
  const initials = ctx.settingsRepo.getSetting('profile.initials') ?? '';
  const name = ctx.settingsRepo.getSetting('profile.name') ?? '';
  const local = initials || name;
  if (local) {
    return { displayName: local, source: 'profile' };
  }

  return null;
}

export function settingsGetProfile(ctx: WindowContext) {
  assertApplicationPermission(ctx, 'ledgerUse');
  return { name: ctx.settingsRepo.getSetting('profile.name') ?? '', initials: ctx.settingsRepo.getSetting('profile.initials') ?? '' };
}
export function settingsSaveProfile(ctx: WindowContext, raw: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const profile = profileSchema.strict().parse(raw);
  ctx.sqlite.transaction(() => {
    ctx.settingsRepo.setSetting('profile.name', profile.name);
    ctx.settingsRepo.setSetting('profile.initials', profile.initials);
  })();
}
export function settingsGetTransactionSettings(ctx: WindowContext) {
  assertApplicationPermission(ctx, 'ledgerUse');
  return { dateOnApprove: ctx.settingsRepo.getSetting('tx.dateOnApprove') === 'true', dateOnPlannedConversion: ctx.settingsRepo.getSetting('tx.dateOnPlannedConversion') !== 'false' };
}
export function settingsSaveTransactionSettings(ctx: WindowContext, raw: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const settings = transactionSettingsSchema.strict().parse(raw);
  ctx.sqlite.transaction(() => {
    ctx.settingsRepo.setSetting('tx.dateOnApprove', String(settings.dateOnApprove));
    ctx.settingsRepo.setSetting('tx.dateOnPlannedConversion', String(settings.dateOnPlannedConversion));
  })();
}
export function settingsGetFYStartMonth(ctx: WindowContext) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const month = Number(ctx.settingsRepo.getSetting('fy.startMonth') ?? 1);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : 1;
}
export function settingsSaveFYStartMonth(ctx: WindowContext, raw: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const month = z.number().int().min(1).max(12).parse(raw);
  ctx.settingsRepo.setSetting('fy.startMonth', String(month), 'org');
}
export function settingsGetOrgName(ctx: WindowContext) {
  assertApplicationPermission(ctx, 'ledgerUse');
  return ctx.settingsRepo.getSetting('report.orgName') ?? '';
}
export function settingsSaveOrgName(ctx: WindowContext, raw: unknown) {
  assertApplicationPermission(ctx, 'ledgerAdministration');
  const name = z.string().max(200).parse(raw);
  ctx.settingsRepo.setSetting('report.orgName', name);
}
export function settingsGetCurrentSheet(ctx: WindowContext) {
  assertApplicationPermission(ctx, 'ledgerUse');
  return ctx.settingsRepo.getSetting('ui.currentSheet') ?? 'All Sheets';
}
export function settingsSaveCurrentSheet(ctx: WindowContext, raw: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  ctx.settingsRepo.setSetting('ui.currentSheet', z.string().parse(raw));
}
const INVOICE_KEYS = ['fromName', 'fromAddress', 'bankDetails', 'notes', 'logoPath', 'logoData', 'counter', 'accentMode'] as const;
export function settingsGetInvoiceDefaults(ctx: WindowContext): InvoiceDefaults {
  assertApplicationPermission(ctx, 'ledgerUse');
  return {
    fromName: ctx.settingsRepo.getSetting('invoice.fromName') ?? '',
    fromAddress: ctx.settingsRepo.getSetting('invoice.fromAddress') ?? '',
    bankDetails: ctx.settingsRepo.getSetting('invoice.bankDetails') ?? '',
    notes: ctx.settingsRepo.getSetting('invoice.notes') ?? '',
    logoPath: ctx.settingsRepo.getSetting('invoice.logoPath') ?? '',
    logoData: ctx.settingsRepo.getSetting('invoice.logoData') ?? '',
    counter: ctx.settingsRepo.getSetting('invoice.counter') ?? '',
    accentMode: z.enum(['fidra', 'black', 'logo']).catch('fidra').parse(ctx.settingsRepo.getSetting('invoice.accentMode')),
  };
}
export function settingsSaveInvoiceDefaults(ctx: WindowContext, raw: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const defaults = invoiceDefaultsSchema.strict().parse(raw);
  ctx.sqlite.transaction(() => {
    for (const key of INVOICE_KEYS) ctx.settingsRepo.setSetting(`invoice.${key}`, defaults[key]);
  })();
}
export function settingsGetUiPreferences(ctx: WindowContext) {
  assertApplicationPermission(ctx, 'ledgerUse');
  return getUiPreferences();
}
export function settingsSaveUiPreferences(ctx: WindowContext, raw: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  saveUiPreferences(uiPreferencesSchema.strict().parse(raw));
}
