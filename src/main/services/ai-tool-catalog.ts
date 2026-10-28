import type { AiBridge } from './ai-bridge';
import { aiLedgerReadDefinitions, aiRunSyncDefinition, aiBackupDefinitions } from '../../shared/ai-application-tools';

export function aiToolCatalog(bridge: Pick<AiBridge, 'toolDefinitions'>): unknown {
      const domain = bridge.toolDefinitions({ allowAdd: true, allowStatementUploads: true }) as { tools: { name: string; inputSchema: Record<string, unknown> }[] };
      return { tools: [
        { name: 'connect_fidra', description: 'Request first-time access. Show the verification code and ask a Fidra administrator to approve the matching request in Fidra. Installing alone grants no data access. Approved access persists.', inputSchema: { type: 'object', properties: { newConnection: { type: 'boolean', description: 'Request approval for an additional or moved ledger. Never expands existing access.' } }, additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false } },
        { name: 'list_connections', description: 'List only this installation’s approved ledgers and connection status. Returns no transaction data.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
        ...aiLedgerReadDefinitions(),
        aiRunSyncDefinition,
        ...aiBackupDefinitions,
        ...domain.tools.map((tool) => ({ ...tool, inputSchema: tool.name === 'read_context' ? { type: 'object', properties: { connectionId: { type: 'string' }, from: { type: 'string', description: 'Requested start date, YYYY-MM-DD' }, to: { type: 'string', description: 'Requested end date, YYYY-MM-DD' }, sheetIds: { type: 'array', items: { type: 'string' } } }, required: ['from', 'to'], additionalProperties: false }
          : { ...tool.inputSchema, properties: { ...(tool.inputSchema.properties as object), connectionId: { type: 'string' } } } })),
      ] };
}
