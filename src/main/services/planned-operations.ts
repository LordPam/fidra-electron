import { idSchema, plannedTemplateBulkSaveSchema, plannedTemplateRowSchema } from '../../shared/ipc-schemas';
import { assertSheetsExist } from './referential-integrity';
import { logPlannedCreated, logPlannedUpdated, logPlannedDeleted, logBulkPlannedSaved } from './audit-service';
import type { WindowContext } from '../window/window-context';
import { assertApplicationPermission } from './application-access';
import type { PlannedTemplateRow } from '../../shared/ipc-types';

function invoiceFieldsChanged(before: PlannedTemplateRow | null, after: PlannedTemplateRow) {
  return !before || before.start_date !== after.start_date || before.description !== after.description || before.amount !== after.amount;
}

/** Shared desktop/external application operations. Each entry validates before repository access. */
export function plannedGetAll(ctx: WindowContext) {
  assertApplicationPermission(ctx, 'ledgerUse');
  return ctx.repos.planned.getAll();
}

export function plannedSave(ctx: WindowContext, data: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validated = plannedTemplateRowSchema.parse(data);
  assertSheetsExist(ctx.sqlite, [
    { label: 'target sheet', sheet: validated.target_sheet },
    { label: 'transfer target sheet', sheet: validated.transfer_target_sheet },
  ]);
  const existing = ctx.plannedRepo.getById(validated.id);
  const result = ctx.sqlite.transaction(() => {
    const saved = ctx.repos.planned.save(validated);
    if (invoiceFieldsChanged(existing, saved)) ctx.repos.invoices.updateLinkedFromPlanned(
      saved.id, saved.start_date, saved.description, saved.amount,
    );
    return saved;
  })();
  if (existing) {
    logPlannedUpdated(ctx, existing, validated);
  } else {
    logPlannedCreated(ctx, validated);
  }
  return result;
}

export function plannedBulkSave(ctx: WindowContext, data: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validated = plannedTemplateBulkSaveSchema.parse(data);
  assertSheetsExist(ctx.sqlite, validated.flatMap((t) => [
    { label: 'target sheet', sheet: t.target_sheet },
    { label: 'transfer target sheet', sheet: t.transfer_target_sheet },
  ]));
  const existingMap = new Map(
    validated.map((tmpl) => [tmpl.id, ctx.plannedRepo.getById(tmpl.id)]),
  );
  const results = ctx.sqlite.transaction(() => {
    const saved = ctx.repos.planned.bulkSave(validated);
    for (const template of saved) {
      if (invoiceFieldsChanged(existingMap.get(template.id) ?? null, template)) ctx.repos.invoices.updateLinkedFromPlanned(
        template.id, template.start_date, template.description, template.amount,
      );
    }
    return saved;
  })();
  if (validated.length > 0) {
    let created = 0;
    let updated = 0;
    for (const tmpl of validated) {
      if (existingMap.get(tmpl.id)) updated++;
      else created++;
    }
    logBulkPlannedSaved(ctx, created, updated, validated.map((t) => t.id));
  }
  return results;
}

export function plannedDelete(ctx: WindowContext, id: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validId = idSchema.parse(id);
  const result = ctx.repos.planned.remove(validId);
  logPlannedDeleted(ctx, validId);
  return result;
}
