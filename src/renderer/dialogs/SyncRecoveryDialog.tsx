import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { RecoveryPreview, RecoveryResult } from '../../shared/sync-recovery-types';

const money = (pence: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);
export function SyncRecoveryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [mailboxes, setMailboxes] = useState<string[]>([]);
  const [ledgers, setLedgers] = useState<string[]>([]);
  const [sessions, setSessions] = useState<{ id: string; createdAt: string; phase: string }[]>([]);
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [destination, setDestination] = useState(''); const [retired, setRetired] = useState<string[]>([]);
  const [paused, setPaused] = useState(false); const [reviewed, setReviewed] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    window.api.recoveryList().then((result) => { if (result.success) setSessions(result.value); else setError(result.error); }).catch((e) => setError(String(e)));
  }, [open]);
  const run = async (action: () => Promise<RecoveryResult<RecoveryPreview>>) => {
    setBusy(true); setError(null);
    try {
      const result = await action();
      if (!result.success) setError(result.error);
      else { setPreview(result.value); setReviewed(false); setDeleting(null); if (result.value.publicationFolder) setDestination(result.value.publicationFolder); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const choose = async (kind: 'mailbox' | 'ledger' | 'destination') => {
    setError(null);
    try {
      const result = await window.api.showOpenDialog({ title: kind === 'ledger' ? 'Choose closed peer ledger backups' : kind === 'destination' ? 'Choose an empty shared mailbox folder' : 'Choose a previous mailbox folder',
        properties: kind === 'ledger' ? ['openFile', 'multiSelections'] : ['openDirectory'],
        filters: kind === 'ledger' ? [{ name: 'Fidra account', extensions: ['fdra'] }] : undefined });
      if (result.canceled) return;
      if (kind === 'mailbox') setMailboxes((old) => [...new Set([...old, ...result.filePaths])]);
      else if (kind === 'ledger') setLedgers((old) => [...new Set([...old, ...result.filePaths])]);
      else setDestination(result.filePaths[0] ?? '');
    } catch (e) { setError(String(e)); }
  };
  const resolve = (conflictId: string, choice: 'keep-local' | 'accept-remote' | 'delete-both') => {
    if (preview) void run(() => window.api.recoveryResolve({ id: preview.id, conflictId, choice, reviewDigest: preview.reviewDigest }));
  };
  const blocked = !preview || !!preview.issues.length || !!preview.conflicts.length || preview.attachments.some((item) => !item.selectedHash)
    || preview.peers.some((peer) => !peer.hasLedger && !retired.includes(peer.deviceId) && !peer.retired);
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) onOpenChange(value); }}>
    <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>Review sync recovery</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">Build a separate account from this ledger, closed peer backups and previous mailbox folders. Original ledgers and shared files are retained. Financial disagreements need your choice before publication.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {busy && <p role="status" className="text-sm">Preserving and verifying recovery data…</p>}
      {!preview ? <div className="space-y-4">
        <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => void choose('mailbox')}>Add previous mailbox</Button><Button variant="outline" disabled={busy} onClick={() => void choose('ledger')}>Add peer ledger backups</Button></div>
        <p className="text-xs text-muted-foreground">Close Fidra on other devices before copying their account files. Include every known device’s latest local account. A mailbox receipt cannot prove that unexported edits are included.</p>
        {[...mailboxes.map((value) => ({ value, kind: 'mailbox' })), ...ledgers.map((value) => ({ value, kind: 'ledger' }))].map(({ value, kind }) => <div key={`${kind}:${value}`} className="flex gap-2 items-center text-xs"><span className="break-all flex-1">{value}</span><Button size="sm" variant="ghost" disabled={busy} onClick={() => kind === 'mailbox' ? setMailboxes(mailboxes.filter((item) => item !== value)) : setLedgers(ledgers.filter((item) => item !== value))}>Remove</Button></div>)}
        <Button disabled={busy} onClick={() => void run(() => window.api.recoveryPrepare({ mailboxes, peerLedgers: ledgers }))}>Prepare private review</Button>
        {sessions.length > 0 && <div className="space-y-2"><p className="text-sm font-medium">Saved reviews</p>{sessions.map((item) => <Button key={item.id} variant="outline" className="block" disabled={busy} onClick={() => void run(() => window.api.recoveryPreview(item.id))}>{new Date(item.createdAt).toLocaleString()} · {item.phase}</Button>)}</div>}
      </div> : <div className="space-y-4">
        <p className="text-xs text-muted-foreground">{preview.files} preserved mailbox objects · {preview.duplicates} exact duplicates · {preview.phase}</p>
        {preview.warnings.map((issue) => <p key={issue} className="text-xs text-muted-foreground">{issue}</p>)}
        {preview.issues.map((issue) => <p key={issue} className="text-sm text-destructive">{issue}</p>)}
        <div className="rounded border overflow-auto"><table className="w-full text-sm"><caption className="text-left p-2 text-xs">Account totals include pending entries; rejected and planned entries are excluded.</caption><thead><tr><th className="p-2 text-left">Account</th><th>Before</th><th>After</th><th>Added / changed / removed</th></tr></thead><tbody>{preview.accounts.map((item) => <tr key={item.sheet} className="border-t"><td className="p-2">{item.sheet}</td><td>{money(item.beforePence)}</td><td>{money(item.afterPence)}</td><td>{item.created} / {item.changed} / {item.deleted}</td></tr>)}</tbody></table></div>
        <details className="rounded border p-3"><summary className="text-sm cursor-pointer">Review individual changes ({preview.changes.length})</summary><div className="space-y-3 mt-3">{preview.changes.map((change) => <div key={`${change.table}:${change.id}`} className="text-xs"><p className="font-medium">{change.table} · {change.id} · {change.before ? change.after ? 'Changed' : 'Removed' : 'Added'}</p><table className="w-full table-fixed"><thead><tr><th className="text-left">Field</th><th className="text-left">Before</th><th className="text-left">After</th></tr></thead><tbody>{[...new Set([...Object.keys(change.before ?? {}), ...Object.keys(change.after ?? {})])].filter((key) => change.before?.[key] !== change.after?.[key]).map((key) => <tr key={key} className="border-t align-top"><td className="py-1 break-words">{key}</td><td className="py-1 break-words whitespace-pre-wrap">{String(change.before?.[key] ?? '(empty)')}</td><td className="py-1 break-words whitespace-pre-wrap">{String(change.after?.[key] ?? '(empty)')}</td></tr>)}</tbody></table></div>)}</div></details>
        {preview.conflicts.map((conflict) => <div key={conflict.id} className="rounded border p-3 space-y-2">
          <p className="text-sm font-medium">{conflict.table} · {conflict.entity} · {conflict.jointTransfer ? 'Both transfer entries' : conflict.field === '-1' ? 'Deletion or restoration' : conflict.field}</p>
          {conflict.transfer ? <div className="grid grid-cols-2 gap-3 text-xs">{(['local', 'remote'] as const).map((side) => <div key={side}><p className="font-medium">{side === 'local' ? 'Current pair' : 'Incoming pair'}</p>{conflict.transfer![side].map((row) => <p key={row.id}>{row.sheet} · {row.type} · £{row.amount} · {row.date}</p>)}</div>)}{conflict.transfer.remoteError && <p className="col-span-2 text-destructive">{conflict.transfer.remoteError}</p>}</div> : <div className="grid grid-cols-2 gap-3 text-sm"><p>Current: {conflict.local ?? '(empty)'}</p><p>Incoming: {conflict.remote ?? '(empty)'}</p></div>}
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => resolve(conflict.id, 'keep-local')}>Keep current{conflict.jointTransfer ? ' pair' : ''}</Button><Button size="sm" variant="outline" disabled={busy || !!conflict.transfer?.remoteError} onClick={() => resolve(conflict.id, 'accept-remote')}>Use incoming{conflict.jointTransfer ? ' pair' : ''}</Button>{conflict.jointTransfer && <Button size="sm" variant="outline" disabled={busy} onClick={() => deleting === conflict.id ? resolve(conflict.id, 'delete-both') : setDeleting(conflict.id)}>{deleting === conflict.id ? 'Confirm deletion of both entries' : 'Delete both entries…'}</Button>}</div>
        </div>)}
        {preview.attachments.map((item) => <div key={item.id} className="rounded border p-3 text-sm space-y-2"><p className="font-medium">{item.name}</p>{item.alternatives.length === 0 && <p className="text-destructive">Missing file. Supply its original in a fresh review before publishing.</p>}{item.alternatives.map((alternative) => <label key={alternative.hash} className="flex gap-2 items-start text-xs"><input type="radio" name={`attachment-${item.id}`} checked={item.selectedHash === alternative.hash} disabled={busy || preview.phase !== 'review'} onChange={() => void run(() => window.api.recoveryAttachment({ id: preview.id, attachmentId: item.id, hash: alternative.hash, reviewDigest: preview.reviewDigest }))} /><span className="break-all">{alternative.source} · {alternative.size} bytes · {alternative.hash}</span></label>)}</div>)}
        <div className="space-y-2"><p className="text-sm font-medium">Old devices</p>{preview.peers.map((peer) => <div key={peer.deviceId} className="text-xs"><p>{peer.name} · {peer.deviceId} · {peer.hasLedger ? 'Ledger captured' : 'No ledger backup supplied'}</p>{!peer.hasLedger && <label className="flex gap-2"><input type="checkbox" checked={retired.includes(peer.deviceId) || peer.retired} disabled={busy || preview.phase !== 'review'} onChange={(event) => setRetired((old) => event.target.checked ? [...old, peer.deviceId] : old.filter((id) => id !== peer.deviceId))} />Retire this device; its unsupplied local edits may be missing. Keep its original account for later recovery.</label>}</div>)}</div>
        {preview.phase === 'published' ? <div className="space-y-2"><p className="text-sm">Recovered account published. Open it, sign in, and invite each other device to the new mailbox. Each peer must stop using its old account.</p><Button disabled={busy || !preview.publishedDbPath} onClick={async () => { try { const result = await window.api.switchToFile(preview.publishedDbPath!); if (!result.success) setError(result.error ?? 'Could not open the recovered account.'); } catch (e) { setError(String(e)); } }}>Open recovered account</Button></div> : <div className="space-y-3 border-t pt-3">
          <Button variant="outline" disabled={busy || preview.phase === 'publishing'} onClick={() => void choose('destination')}>Choose empty new mailbox</Button><p className="text-xs break-all">{destination}</p>
          <p className="text-xs text-muted-foreground">Choose the folder through your sharing provider. Fidra verifies these local files; it cannot certify that OneDrive has uploaded them or that an offline peer has switched.</p>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={paused} disabled={busy} onChange={(event) => setPaused(event.target.checked)} />Every old client is paused and will rejoin the new mailbox.</label>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy} onChange={(event) => setReviewed(event.target.checked)} />I have reviewed the account changes, file choices and missing-device decisions.</label>
          <Button disabled={busy || blocked || !destination || !paused || !reviewed || preview.phase === 'preparing'} onClick={() => void run(() => window.api.recoveryPublish({ id: preview.id, destinationFolder: destination, retiredDevices: retired, confirmPausedClients: paused, confirmReviewedChanges: reviewed, reviewDigest: preview.publicationReviewDigest ?? preview.reviewDigest }))}>{preview.phase === 'publishing' ? 'Retry prepared publication' : 'Publish recovered account and mailbox'}</Button>
        </div>}
        <p className="text-xs break-all text-muted-foreground">Reviewed ledger: {preview.ledgerDigest}<br />Team authority: {preview.authorityFingerprint}</p>
        <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => void run(() => window.api.recoveryPreview(preview.id))}>Refresh review</Button><Button variant="ghost" disabled={busy} onClick={() => { setPreview(null); setReviewed(false); setPaused(false); setRetired([]); setDestination(''); }}>Start another review</Button></div>
      </div>}
    </DialogContent>
  </Dialog>;
}
