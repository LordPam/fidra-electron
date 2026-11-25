import { useState } from 'react';
import { Button } from './ui/button';
import type { LedgerCleanupPreview, LedgerCleanupEntry } from '../../shared/ledger-cleanup-types';

const stateLabels = { ready: 'Ready', draft: 'Review required', approved: 'Approved, awaiting application', committed: 'Applied', undone: 'Undone', rejected: 'Declined' };
function Entries({ title, rows }: { title: string; rows: LedgerCleanupEntry[] }) {
  return <section className="space-y-1"><h4 className="text-sm font-medium">{title} · {rows.length} entries</h4>
    <div className="max-h-64 overflow-auto rounded border border-border"><table className="w-full text-left text-xs">
      <thead><tr className="border-b border-border"><th className="p-2">Date</th><th className="p-2">Entry / sheet</th><th className="p-2 text-right">Amount</th><th className="p-2">Status</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id} className="border-b border-border last:border-0"><td className="whitespace-nowrap p-2 align-top">{row.date}</td>
        <td className="p-2"><p>{row.description ?? (row.type === 'income' ? 'Income' : 'Expense')}</p><p className="text-muted-foreground">{row.account}{row.linkedId ? ' · Linked transfer' : ''}</p></td>
        <td className="whitespace-nowrap p-2 text-right align-top">{row.type === 'income' ? '+' : '−'}£{row.amount}</td><td className="p-2 align-top">{row.status === '--' ? 'No approval required' : row.status}</td></tr>)}</tbody>
    </table></div>
  </section>;
}
interface Props {
  preview: LedgerCleanupPreview; busy: boolean; canUndo: boolean;
  onReview: (approve: boolean) => void; onUndo: () => void;
}
export function LedgerCleanupReview({ preview, busy, canUndo, onReview, onUndo }: Props) {
  const [reviewed, setReviewed] = useState(false);
  return <details className="space-y-3 rounded border border-border p-3 text-sm">
    <summary className="cursor-pointer font-medium">{preview.label} · {stateLabels[preview.state]}</summary>
    <p className="mt-3 text-xs text-muted-foreground">Review the affected sheets and entries below. A backup is created before applying. Undo is available while the ledger remains unchanged afterward.</p>
    {!!preview.sheets.length && <div className="space-y-1">{preview.sheets.map((sheet) => <p key={sheet.id}>Rename “{sheet.before}” to “{sheet.after}”</p>)}</div>}
    {preview.changes ? <p>{preview.changes.length} changed record{preview.changes.length === 1 ? '' : 's'}</p> : <p>{preview.transferCount} linked transfer{preview.transferCount === 1 ? '' : 's'} · {preview.before.length} affected existing entries · {preview.after.length} resulting entries</p>}
    <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{preview.reasons.map((item, i) => <li key={i}>{item.reason}</li>)}</ul>
    {!preview.changes && <><Entries title="Before" rows={preview.before} /><Entries title="After" rows={preview.after} /></>}
    {preview.changes?.map((change) => <section key={`${change.resource}:${change.id}`} className="space-y-1">
      <h4 className="font-medium">{change.resource}{change.before === null ? ' · Create' : change.after === null ? ' · Remove' : ' · Edit'}</h4>
      <div className="max-h-64 overflow-auto rounded border border-border"><table className="w-full text-left text-xs">
        <thead><tr className="border-b border-border"><th className="p-2">Field</th><th className="p-2">Before</th><th className="p-2">After</th></tr></thead>
        <tbody>{[...new Set([...Object.keys(change.before ?? {}), ...Object.keys(change.after ?? {})])].filter((field) => !['id', 'version'].includes(field)).map((field) => <tr key={field} className="border-b border-border last:border-0">
          <td className="p-2 align-top">{field.replace(/([A-Z])/g, ' $1')}</td><td className="whitespace-pre-wrap break-words p-2 align-top">{display(change.before?.[field])}</td><td className="whitespace-pre-wrap break-words p-2 align-top">{display(change.after?.[field])}</td>
        </tr>)}</tbody>
      </table></div>
    </section>)}
    {preview.requiresReview && preview.state === 'draft' && <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy} onChange={(event) => setReviewed(event.target.checked)} />I reviewed the accounts, dates, amounts and removals</label>
      <div className="flex gap-2"><Button disabled={busy || !reviewed} onClick={() => onReview(true)}>{preview.changes ? 'Approve these changes' : 'Approve this cleanup'}</Button>
        <Button variant="outline" disabled={busy} onClick={() => onReview(false)}>{preview.changes ? 'Decline changes' : 'Decline cleanup'}</Button></div>
    </div>}
    {preview.state === 'approved' && <p className="text-xs text-muted-foreground">Approved for the exact changes shown. Your AI can now apply them.</p>}
    {preview.state === 'committed' && <Button variant="outline" disabled={busy || !canUndo} onClick={onUndo}>{preview.changes ? 'Undo these changes' : 'Undo this cleanup'}</Button>}
  </details>;
}

function display(value: unknown): string { return value == null ? '—' : typeof value === 'string' ? value : JSON.stringify(value); }
