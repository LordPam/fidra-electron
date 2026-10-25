import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const catalogSchema = z.array(z.object({ path: z.string(), databaseId: z.string() })).max(1000);
export type AccountLocation = z.infer<typeof catalogSchema>[number];
export function financialDirectory(): string { return path.join(os.homedir(), '.fidra', 'accounts'); }
const catalogPath = () => path.join(os.homedir(), '.fidra', 'accounts.json');

/** Financial metadata survives a device reset, independently of UI preferences. */
export function retainedAccounts(): AccountLocation[] {
  if (!fs.existsSync(catalogPath())) return [];
  return catalogSchema.parse(JSON.parse(fs.readFileSync(catalogPath(), 'utf8')));
}

export function rememberAccount(dbPath: string, databaseId: string): void {
  const accounts = retainedAccounts();
  const resolved = fs.realpathSync(dbPath);
  const next = accounts.filter((account) => account.path !== resolved);
  next.push({ path: resolved, databaseId });
  fs.mkdirSync(path.dirname(catalogPath()), { recursive: true });
  const temporary = `${catalogPath()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
  fs.renameSync(temporary, catalogPath());
}

export function newAccountPath(): string {
  fs.mkdirSync(financialDirectory(), { recursive: true });
  for (let number = 1; number <= 1000; number++) {
    const candidate = path.join(financialDirectory(), number === 1 ? 'Accounts.fdra' : `Accounts ${number}.fdra`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(financialDirectory(), `Accounts-${randomUUID().slice(0, 8)}.fdra`);
}

/** Reserve with wx: creating a ledger must never overwrite another file. */
export function reserveAccountPath(): string {
  fs.mkdirSync(financialDirectory(), { recursive: true });
  const destination = newAccountPath();
  fs.closeSync(fs.openSync(destination, 'wx', 0o600));
  return destination;
}
