import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { aiAccessPolicySchema } from '../../shared/ai-access-types';

export const aiAuthorizationSchema = z.object({
  id: z.string().uuid(), publicKey: z.string().min(1).max(200), client: z.enum(['chatgpt', 'claude']),
  databaseId: z.string().min(1), dbPath: z.string().min(1), personId: z.string().min(1),
  identityHash: z.string().min(1), approvedBy: z.string().min(1), approvedAt: z.string(), policy: aiAccessPolicySchema,
}).strict();
export type AiAuthorization = z.infer<typeof aiAuthorizationSchema>;
const ownerSchema = z.object({ databaseId: z.string(), dbPath: z.string(), name: z.string(), passwordHash: z.string() }).strict();
const dataSchema = z.object({ version: z.literal(1), authorizations: z.array(aiAuthorizationSchema).max(100), owners: z.array(ownerSchema).max(100) }).strict();
export type AiAuthorizationData = z.infer<typeof dataSchema>;
export interface AiSecureStorage { available(): boolean; encrypt(value: string): Buffer; decrypt(value: Buffer): string }

/** Per-device only. Corrupt or unavailable secure storage never becomes empty approval state. */
export class AiAuthorizationStore {
  constructor(private readonly file: string, private readonly storage: AiSecureStorage) {}
  available(): boolean { return this.storage.available(); }
  read(): AiAuthorizationData {
    if (!this.available()) throw new Error('Unlock your operating system credential store to connect an AI app.');
    const directory = path.dirname(this.file);
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new Error('Connected-app permissions must use a private directory.');
    if (!fs.existsSync(this.file)) return { version: 1, authorizations: [], owners: [] };
    const stat = fs.lstatSync(this.file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1_000_000) throw new Error('The connected-app permissions file is invalid.');
    return dataSchema.parse(JSON.parse(this.storage.decrypt(fs.readFileSync(this.file))));
  }
  write(input: AiAuthorizationData): void {
    const data = dataSchema.parse(input);
    if (!this.available()) throw new Error('Secure storage is required for persistent AI permissions.');
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('Connected-app permissions must use a private directory.');
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, this.storage.encrypt(JSON.stringify(data)), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, this.file);
    } finally { fs.rmSync(temporary, { force: true }); }
  }
  clear(): void { fs.rmSync(this.file, { force: true }); }
}
