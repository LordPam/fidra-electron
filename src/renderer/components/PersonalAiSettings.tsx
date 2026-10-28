import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useSheetStore } from '@/stores/sheet-store';
import { useUndoStore } from '@/stores/undo-store';
import type { AiBridgeState } from '../../shared/ai-bridge-types';
import { applicationCapabilityDetails } from '../../shared/application-capabilities';

export function PersonalAiSettings() {
  const [state, setState] = useState<AiBridgeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(''); const [password, setPassword] = useState('');
  const sheets = useSheetStore((s) => s.sheets);
  const undo = useUndoStore((s) => s.undo);
  const undoId = useUndoStore((s) => s.undoStack.at(-1)?.id);
  const refresh = useCallback(() => { window.api.getAiBridgeState().then(setState).catch((e: unknown) => setError(String(e))); }, []);
  useEffect(() => { refresh(); return window.api.onAiChanged(refresh); }, [refresh]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await action(); refresh(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <Card>
    <CardHeader><CardTitle>Connected AI apps</CardTitle><CardDescription>Manage approved access to this ledger.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Connect from the Fidra plugin in your AI app. The standalone ledger’s access owner, or a team administrator, chooses the accounts and actions it may use. Approved access is remembered; locking this computer or signing out pauses it.</p>
      <p className="text-xs text-muted-foreground">Fidra has not been published in ChatGPT’s plugin directory yet.</p>
      {state && !state.access.secureStorageAvailable && <p className="text-sm">Unlock your operating system credential store to manage persistent connections.</p>}
      {(state?.access.owner === 'setup' || state?.access.owner === 'locked') && <div className="space-y-3 rounded-lg border border-border p-3">
        <p className="text-sm font-medium">{state.access.owner === 'setup' ? 'Set up this ledger’s AI access owner' : 'Unlock AI access'}</p>
        <p className="text-xs text-muted-foreground">{state.access.owner === 'setup' ? 'This standalone ledger has no administrator account. Set an owner name and password to protect AI connection approvals on this device. This does not enable sync or change the ledger.' : 'Enter the owner password to resume this ledger’s approved connections. You do not need to approve the plugin again.'}</p>
        <label className="block text-sm">Owner name<Input autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="block text-sm">Owner password<Input type="password" autoComplete={state.access.owner === 'setup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {state.access.owner === 'setup' && <p className="text-xs text-muted-foreground">Use at least 12 characters. Remember this password to unlock approved access after restarting Fidra.</p>}
        <Button disabled={busy || !name.trim() || password.length < 12} onClick={() => { void run(async () => { await window.api.unlockAiOwner(name, password); setPassword(''); }); }}>{state.access.owner === 'setup' ? 'Set access owner' : 'Unlock access'}</Button>
      </div>}
      {state?.access.owner === 'unavailable' && state.access.secureStorageAvailable && <p className="text-sm">Sign in as a Fidra administrator to manage connections. New, unsaved ledgers cannot grant access.</p>}
      {state?.access.owner === 'admin' && !state.access.authorizations.length && <p className="text-sm text-muted-foreground">No AI apps have access to this ledger.</p>}
      {state?.access.authorizations.map((connection) => <div key={connection.id} className="space-y-2 rounded-lg border border-border p-3 text-sm">
        <p className="font-medium">{connection.client === 'chatgpt' ? 'ChatGPT' : 'Claude'} · {connection.active ? 'Available' : 'Paused'}</p>
        <p>{connection.policy.permissions.allAccounts ? 'All current and future accounts, including ledger-wide operations' : connection.policy.sheetIds.map((id) => sheets.find((sheet) => sheet.id === id)?.name ?? 'Account details not loaded').join(', ')}</p>
        <p className="text-muted-foreground">{connection.policy.permissions.allowAdd ? 'May add pending entries and fulfil planned payments' : 'Read and prepare drafts'}{connection.policy.permissions.allowStatementUploads ? ' · May receive statements from chat' : ''}</p>
        {!!connection.policy.permissions.capabilities.length && <ul className="list-disc pl-5 text-xs text-muted-foreground">{connection.policy.permissions.capabilities.map((capability) => <li key={capability}>{applicationCapabilityDetails[capability].label}</li>)}</ul>}
        <p className="text-xs text-muted-foreground">Approved by {connection.approvedBy} on {new Date(connection.approvedAt).toLocaleDateString()}</p>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => { void run(() => window.api.revokeAiAccess(connection.id)); }}>Revoke access</Button>
      </div>)}
      {state?.proposals.map((proposal) => <details key={proposal.id} className="rounded border border-border p-3 text-sm">
        <summary>{proposal.label} · {proposal.rows.length} rows · {proposal.state}</summary>
        <p className="my-2 text-xs text-muted-foreground">New entries start pending. Your AI asks about uncertainty in the conversation before applying a batch.</p>
        {proposal.rows.map((row, index) => <p key={index} className="text-xs">{row.source.date} · £{row.source.amount} · {row.description} · {row.action}</p>)}
        {proposal.state === 'committed' && <Button className="mt-3" variant="outline" disabled={busy || undoId !== `reconciliation:${proposal.id}`} onClick={() => { void run(undo); }}>Undo this import</Button>}
      </details>)}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </CardContent>
  </Card>;
}
