import { useState } from 'react';
import type { SheetRow, PlannedTemplateRow } from '../../shared/ipc-types';
import type { AiBridgeState, AiClient, AiConnectionPermissions } from '../../shared/ai-bridge-types';
import type { ReconciliationApproval, ReconciliationScope } from '../../shared/reconciliation-types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface PersonalAiSettingsProps {
  state: AiBridgeState;
  sheets: SheetRow[];
  plannedTemplates: PlannedTemplateRow[];
  ledgerName: string;
  busy: boolean;
  error: string | null;
  onConnect: (client: AiClient, scope: ReconciliationScope, permissions: AiConnectionPermissions) => void;
  onDisconnect: (id: string) => void;
  onExport: (id: string) => void;
  onSelectStatement: () => Promise<import('../../shared/statement-types').SelectedStatement | null>;
  onExportContext: (id: string) => void;
  onOpenProposal: () => void;
  onApprove: (approval: ReconciliationApproval) => void;
  onDiscard: (id: string) => void;
  undoableImportId: string | null;
  onUndo: () => void;
  className?: string;
}

const optionalFields: ReconciliationScope['fields'] = ['description', 'party', 'category', 'activity', 'reference', 'notes'];

export function PersonalAiSettings({ state, sheets, plannedTemplates, ledgerName, busy, error, onConnect, onDisconnect, onExport, onSelectStatement, onExportContext, onOpenProposal, onApprove, onDiscard, undoableImportId, onUndo, className }: PersonalAiSettingsProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [sheetIds, setSheetIds] = useState<string[]>([]);
  const [fields, setFields] = useState<ReconciliationScope['fields']>(['description', 'party', 'category', 'activity']);
  const [statementIds, setStatementIds] = useState<string[]>([]);
  const [client, setClient] = useState<AiClient>('claude');
  const [allowAdd, setAllowAdd] = useState(false);
  const [allowStatementUploads, setAllowStatementUploads] = useState(false);
  const [reviewed, setReviewed] = useState<Record<string, number[]>>({});

  return <Card className={cn(className)}>
    <CardHeader><CardTitle>Personal AI</CardTitle><CardDescription>Reconcile statements for {ledgerName} with the permissions you choose.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Only the accounts, dates and fields you select are shared with your AI provider. Fidra must stay open and signed in. Connections last one hour and disconnect when this ledger closes, you sign out, or the computer locks.</p>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">Desktop app<select aria-label="AI desktop app" className="ml-2 rounded border border-border bg-surface-base p-1" value={client} onChange={(event) => setClient(event.target.value as AiClient)}><option value="claude">Claude</option><option value="chatgpt">ChatGPT</option></select></label>
        <label className="flex items-center gap-2 text-sm">From<Input aria-label="AI context from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm">To<Input aria-label="AI context to" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Accounts to share</legend>
        <div className="flex flex-wrap gap-4">{sheets.map((sheet) => <label key={sheet.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sheetIds.includes(sheet.id)} onChange={(event) => setSheetIds((ids) => event.target.checked ? [...ids, sheet.id] : ids.filter((id) => id !== sheet.id))} />{sheet.name}</label>)}</div>
      </fieldset>
      <fieldset><legend className="mb-2 text-sm font-medium">Context fields</legend>
        <p className="mb-2 text-xs text-muted-foreground">Dates, amounts, income/expense direction and account names are included. Choose the additional details your AI can read.</p>
        <div className="flex flex-wrap gap-4">{optionalFields.map((field) => <label key={field} className="flex items-center gap-2 text-sm capitalize"><input type="checkbox" checked={fields.includes(field)} onChange={(event) => setFields((values) => event.target.checked ? [...values, field] : values.filter((value) => value !== field))} />{field}</label>)}</div>
      </fieldset>
      <div className="space-y-2"><p className="text-sm font-medium">Bank statements for this connection</p>
        <p className="text-xs text-muted-foreground">Select the statements your AI may use. CSV/text can be read through the connection. For PDFs, attach the same selected file to your AI chat for extraction.</p>
        <Button variant="outline" disabled={busy} onClick={async () => { const selected = await onSelectStatement(); if (selected) setStatementIds((ids) => [...ids, selected.id]); }}>Select bank statement</Button>
        {state.statements.map((statement) => <label key={statement.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={statementIds.includes(statement.id)} onChange={(event) => setStatementIds((ids) => event.target.checked ? [...ids, statement.id] : ids.filter((id) => id !== statement.id))} />{statement.name}</label>)}
      </div>
      {client === 'chatgpt' && <p className="text-sm text-muted-foreground">The trial extension includes Fidra’s reconciliation instructions and connection tools. Installation in your ChatGPT desktop app still needs to be verified. You can also export selected context and open a proposal file as a fallback.</p>}
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">What this connection may do</legend>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={allowStatementUploads} onChange={(event) => setAllowStatementUploads(event.target.checked)} />Receive statements I attach in my AI chat</label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={allowAdd} onChange={(event) => setAllowAdd(event.target.checked)} />Add missing entries and fulfil planned payments when I ask in chat</label>
        <p className="text-xs text-muted-foreground">Add access is limited to these accounts and dates, with up to 1,000 changed rows per connection. Entries start pending. Fidra backs up first and keeps an audit trail and Undo. Existing actual transactions cannot be edited or deleted through this connection.</p>
      </fieldset>
      <Button disabled={busy || !sheetIds.length || !from || !to || from > to} onClick={() => onConnect(client, { sheetIds, statementIds, from, to, fields }, { allowAdd, allowStatementUploads })}>Share selected context with {client === 'claude' ? 'Claude' : 'ChatGPT'}</Button>
      {state.connections.map((connection) => <div key={connection.id} className="space-y-2 rounded-lg border border-border p-3 text-sm">
        <p><strong>{connection.client === 'claude' ? 'Claude' : 'ChatGPT'}</strong> · Expires {new Date(connection.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        <p>{connection.permissions.allowAdd ? 'May add missing entries and fulfil planned payments' : 'Drafts only'}{connection.permissions.allowStatementUploads ? ' · May receive statements from chat' : ''}</p>
        <p className="text-muted-foreground">{connection.scope.from} to {connection.scope.to} · {connection.scope.sheetIds.map((id) => sheets.find((sheet) => sheet.id === id)?.name ?? 'Account').join(', ')} · {connection.scope.fields.join(', ') || 'No optional fields'}</p>
        {connection.lastUsedAt && <p className="text-xs text-muted-foreground">Last activity: {connection.lastTool === 'stage_reconciliation' ? 'Prepared a statement draft' : connection.lastTool === 'read_context' ? 'Read selected context' : 'Checked a proposal'}</p>}
        <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => onExport(connection.id)}>{connection.client === 'claude' ? 'Save Claude connection' : 'Save ChatGPT extension (trial)'}</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => onExportContext(connection.id)}>Export selected context</Button><Button variant="outline" size="sm" disabled={busy} onClick={onOpenProposal}>Open proposal file</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => onDisconnect(connection.id)}>Disconnect</Button></div>
        <p className="text-xs text-muted-foreground">{connection.client === 'claude' ? 'Open the saved connection file with Claude Desktop and install it. Renew access here when it expires; the installed connection can be reused.' : 'This package uses the ChatGPT desktop local-plugin route, subject to your account’s access.'}</p>
      </div>)}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {state.proposals.length > 0 && <div className="space-y-3"><h3 className="font-medium">Statement proposals</h3>
        {state.proposals.map((proposal) => {
          const issues = proposal.review.filter((row) => row.questions.length);
          const blocked = proposal.review.some((row) => row.blockers.length);
          const approvals = reviewed[proposal.id] ?? [];
          const connected = state.connections.some((connection) => connection.id === proposal.grantId);
          return <details key={proposal.id} className="rounded-lg border border-border p-3" open={proposal.state !== 'undone'}>
            <summary className="cursor-pointer text-sm font-medium">{proposal.label} · {proposal.rows.length} rows · {proposal.state === 'draft' ? 'Ready for review' : proposal.state === 'committed' ? 'Imported' : 'Undone'}</summary>
            <p className="my-2 text-xs text-muted-foreground">New entries start as pending. Ask your AI to correct a draft if anything is wrong. Transfers and invoice-linked planned payments need their existing Fidra workflows.</p>
            <div className="max-h-96 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Bank row</th><th className="p-2">Proposal</th><th className="p-2">Review</th></tr></thead><tbody>
              {proposal.rows.map((row, index) => <tr key={index} className="border-t border-border align-top">
                <td className="p-2"><p>{row.source.date} · {row.source.type} · £{row.source.amount}</p><p className="text-muted-foreground">{row.source.description}</p><details className="text-xs"><summary>Source evidence</summary><p className="whitespace-pre-wrap break-words">{row.source.evidence}</p></details></td>
                <td className="p-2"><p>{row.action === 'skip' ? 'Skip' : row.action === 'fulfil' ? 'Import and fulfil planned payment' : row.action === 'link' ? 'Keep existing transaction and fulfil planned payment' : 'Import new'} · {sheets.find((sheet) => sheet.id === row.sheetId)?.name ?? 'Account'}</p><p>{row.description}</p><p className="text-xs text-muted-foreground">Party: {row.party ?? 'Unassigned'} · Category: {row.category ?? 'Unassigned'} · Activity: {row.activity ?? 'Unassigned'}</p>{row.planned && <p className="text-xs">Planned: {plannedTemplates.find((template) => template.id === row.planned?.templateId)?.description ?? row.planned.templateId} · {row.planned.date}</p>}</td>
                <td className="p-2"><ul className="space-y-1 text-xs">{proposal.review[index].blockers.map((message) => <li key={message} className="text-destructive">{message}</li>)}{proposal.review[index].questions.map((message) => <li key={message}>{message}</li>)}</ul>
                  {proposal.state === 'draft' && proposal.review[index].questions.length > 0 && <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={approvals.includes(index)} onChange={(event) => setReviewed((previous) => ({ ...previous, [proposal.id]: event.target.checked ? [...approvals, index] : approvals.filter((value) => value !== index) }))} />I checked this row</label>}
                </td>
              </tr>)}
            </tbody></table></div>
            {proposal.state === 'committed' && <Button className="mt-3" variant="outline" disabled={busy || undoableImportId !== proposal.id} onClick={onUndo}>Undo this import</Button>}
            {proposal.state !== 'committed' && <div className="mt-3 flex flex-wrap items-center gap-3">
              {!!issues.length && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={issues.every((row) => approvals.includes(row.index))} onChange={(event) => setReviewed((previous) => ({ ...previous, [proposal.id]: event.target.checked ? issues.map((row) => row.index) : [] }))} />I checked all flagged rows</label>}
              <Button disabled={busy || blocked || !connected || issues.some((row) => !approvals.includes(row.index))} onClick={() => onApprove({ id: proposal.id, digest: proposal.digest, reviewedRows: approvals })}>Approve this batch</Button>
              <Button variant="outline" disabled={busy} onClick={() => onDiscard(proposal.id)}>Discard proposal</Button>
              {!connected && <p className="text-xs text-muted-foreground">This connection ended. Reconnect and ask your AI to prepare a fresh proposal.</p>}
            </div>}
          </details>;
        })}
      </div>}
    </CardContent>
  </Card>;
}
