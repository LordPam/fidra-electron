import { z } from 'zod';
import { nameSchema, transactionTypeSchema } from '../../shared/ipc-schemas';
import type { WindowContext } from '../window/window-context';
import { assertApplicationPermission } from './application-access';

/** Shared desktop/external application operations. Each entry validates before repository access. */
export function categoriesGetAll(ctx: WindowContext, type: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validType = transactionTypeSchema.parse(type);
  return ctx.repos.categories.getAll(validType);
}

export function categoriesSetAll(ctx: WindowContext, type: unknown, names: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validType = transactionTypeSchema.parse(type);
  const validNames = z.array(nameSchema).parse(names);

  // Categories are matched by name and carry no UNIQUE constraint (cr-sqlite
  // forbids one), so a repeated name would produce two indistinguishable entries.
  // Keep the first spelling of each, preserving the caller's ordering.
  const seen = new Set<string>();
  const deduped = validNames.filter((name) => {
    const key = name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  ctx.repos.categories.setAll(validType, deduped);
}
