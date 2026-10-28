import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../database/connection';
import { SettingsRepo } from '../../database/settings-repo';
import { TransactionRepo } from '../../repositories/transaction-repo';
import { SheetRepo } from '../../repositories/sheet-repo';
import { PlannedRepo } from '../../repositories/planned-repo';
import { InvoiceRepo } from '../../repositories/invoice-repo';
import { CategoryRepo } from '../../repositories/category-repo';
import { ActivityNotesRepo } from '../../repositories/activity-notes-repo';
import { AttachmentRepo } from '../../repositories/attachment-repo';
import { AuditRepo } from '../../repositories/audit-repo';
import { PersonnelRepo } from '../../repositories/personnel-repo';
import type { WindowContext } from '../../window/window-context';
import * as settings from '../settings-operations';
import { aiReadSettings, aiReadPersonnel } from '../ai-ledger-reads';
import { aiAccessPolicySchema } from '../../../shared/ai-access-types';
import type { AiOperationAccess } from '../ai-operation-access';

vi.mock('../../window/global-settings', () => ({ getUiPreferences: () => ({ theme: 'system' }), saveUiPreferences: vi.fn() }));
let root: string;
let ctx: WindowContext;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-operations-'));
  const db = openDatabase(path.join(root, 'synthetic.fdra')).db;
  const transactions = new TransactionRepo(db); const planned = new PlannedRepo(db);
  const sheets = new SheetRepo(db); const invoices = new InvoiceRepo(db);
  const categories = new CategoryRepo(db); const activityNotes = new ActivityNotesRepo(db);
  const attachments = new AttachmentRepo(db);
  ctx = { sqlite: db, isClosed: false, isLocalSyncAuthEnabled: false, localAuthPersonnel: null,
    authSession: null, databaseId: 'synthetic', settingsRepo: new SettingsRepo(db),
    transactionRepo: transactions, plannedRepo: planned, sheetRepo: sheets, invoiceRepo: invoices,
    auditRepo: new AuditRepo(db), personnelRepo: new PersonnelRepo(db),
    repos: { transactions, planned, sheets, invoices, categories, activityNotes, attachments },
  } as unknown as WindowContext;
  sheets.create('main', 'Main'); sheets.create('savings', 'Savings');
});
afterEach(() => { ctx.sqlite.close(); fs.rmSync(root, { recursive: true, force: true }); });


function access(capability: 'settings.read' | 'personnel.read'): AiOperationAccess {
  return { policy: aiAccessPolicySchema.parse({ sheetIds: [], fields: [], permissions: { allAccounts: true, capabilities: [capability] } }), isCurrent: () => true };
}
describe('shared supported settings', () => {
  it.each(Object.keys(settings))('%s checks access before reading or writing', (name) => {
    // eslint-disable-next-line import/namespace -- table-driven check of every exported operation
    const operation = settings[name as keyof typeof settings] as (context: WindowContext, raw?: unknown) => unknown;
    expect(() => operation({ isClosed: true } as WindowContext)).toThrow('closed');
  });
  it('reads financial-year defaults without writing and saves explicit org scope', () => {
    expect(settings.settingsGetFYStartMonth(ctx)).toBe(1);
    expect(ctx.settingsRepo.getSetting('fy.startMonth')).toBeNull();
    settings.settingsSaveFYStartMonth(ctx, 9);
    expect(ctx.settingsRepo.getOrgSettings()['fy.startMonth']).toBe('9');
    expect(() => settings.settingsSaveFYStartMonth(ctx, 13)).toThrow();
  });
  it('commits multi-setting writes atomically', () => {
    settings.settingsSaveProfile(ctx, { name: 'Before', initials: 'B' });
    ctx.sqlite.exec("CREATE TRIGGER synthetic_settings_failure BEFORE UPDATE ON settings WHEN NEW.key = 'profile.initials' BEGIN SELECT RAISE(ABORT, 'synthetic settings failure'); END");
    expect(() => settings.settingsSaveProfile(ctx, { name: 'After', initials: 'A' })).toThrow('settings failure');
    expect(settings.settingsGetProfile(ctx)).toEqual({ name: 'Before', initials: 'B' });
  });
  it('rejects generic keys and credentials instead of silently storing them', () => {
    expect(() => settings.settingsSaveProfile(ctx, { name: 'After', initials: 'A', password: 'SECRET' })).toThrow();
    expect(() => aiReadSettings(ctx, access('settings.read'), { groups: ['localSync.passphrase'] })).toThrow();
    expect(ctx.settingsRepo.getSetting('password')).toBeNull();
  });
  it('never returns sync credentials, local paths, invoice counters or logos', () => {
    for (const key of ['localSync.passphrase', 'localSync.syncFolder', 'invoice.logoPath', 'invoice.logoData', 'invoice.counter', 'invoice.notes', 'invoice.bankDetails']) ctx.settingsRepo.setSetting(key, 'SECRET');
    const result = aiReadSettings(ctx, access('settings.read'), { groups: ['invoiceDefaults', 'financialYear', 'organisation'] });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(result).toMatchObject({ invoiceDefaults: { accentMode: 'fidra' }, financialYear: { startMonth: 1 } });
  });
  it('preserves native organisation-name admin limits after a live demotion', () => {
    const person = ctx.personnelRepo.save({ id: 'admin', name: 'Admin', email: 'admin@example.test', role: 'admin', auth_uid: null, invited_by: null, password_hash: 'hash', encrypted_passphrase: null, passphrase_salt: null });
    ctx.localAuthPersonnel = person;
    ctx.personnelRepo.save({ ...person, role: 'member' });
    expect(() => settings.settingsSaveOrgName(ctx, 'Changed')).toThrow('admins');
    expect(settings.settingsGetOrgName(ctx)).toBe('');
    settings.settingsSaveTransactionSettings(ctx, { dateOnApprove: true, dateOnPlannedConversion: false });
    expect(settings.settingsGetTransactionSettings(ctx)).toEqual({ dateOnApprove: true, dateOnPlannedConversion: false });
  });
  it('requires a real team administrator for personnel reads and strips all credential material', () => {
    const permitted = access('personnel.read');
    expect(() => aiReadPersonnel(ctx, permitted, {})).toThrow('administrator');
    const person = ctx.personnelRepo.save({ id: 'admin', name: 'Admin', email: 'admin@example.test', role: 'admin', auth_uid: null, invited_by: null, password_hash: 'SECRET', encrypted_passphrase: 'SECRET', passphrase_salt: 'SECRET' });
    ctx.localAuthPersonnel = person;
    expect(aiReadPersonnel(ctx, permitted, {})).toEqual([{ id: 'admin', name: 'Admin', email: 'admin@example.test', role: 'admin' }]);
    ctx.personnelRepo.save({ ...person, role: 'member' });
    expect(() => aiReadPersonnel(ctx, permitted, {})).toThrow('admins');
  });
});
