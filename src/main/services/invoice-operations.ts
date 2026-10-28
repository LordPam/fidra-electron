import { idSchema, invoiceRowSchema } from '../../shared/ipc-schemas';
import { logInvoiceCreated, logInvoiceUpdated, logInvoiceDeleted, logInvoiceMarkedPaid } from './audit-service';
import type { WindowContext } from '../window/window-context';
import { assertApplicationPermission } from './application-access';

/** Shared desktop/external application operations. Each entry validates before repository access. */
export function invoicesGetAll(ctx: WindowContext) {
  assertApplicationPermission(ctx, 'ledgerUse');
  return ctx.repos.invoices.getAll();
}

export function invoicesGetByPlannedTemplate(ctx: WindowContext, plannedTemplateId: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validId = idSchema.parse(plannedTemplateId);
  return ctx.repos.invoices.getByPlannedTemplateId(validId);
}

export function invoicesSave(ctx: WindowContext, data: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validated = invoiceRowSchema.parse(data);
  const existing = ctx.invoiceRepo.getById(validated.id);
  const result = ctx.repos.invoices.save(validated);
  if (existing) {
    logInvoiceUpdated(ctx, validated);
  } else {
    logInvoiceCreated(ctx, validated);
  }
  return result;
}

export function invoicesDelete(ctx: WindowContext, id: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validId = idSchema.parse(id);
  const result = ctx.repos.invoices.remove(validId);
  logInvoiceDeleted(ctx, validId);
  return result;
}

export function invoicesMarkPaid(ctx: WindowContext, invoiceId: unknown, transactionId: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validInvoiceId = idSchema.parse(invoiceId);
  const validTxId = idSchema.parse(transactionId);
  const result = ctx.repos.invoices.markPaid(validInvoiceId, validTxId);
  if (result) logInvoiceMarkedPaid(ctx, result);
  return result;
}

export function invoicesRevertToDraft(ctx: WindowContext, invoiceId: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validId = idSchema.parse(invoiceId);
  return ctx.repos.invoices.revertToDraft(validId);
}
