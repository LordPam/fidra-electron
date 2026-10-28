import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useWindowStore } from '@/stores/window-store';
import { aiAccessPolicySchema, type AiAccessRequest } from '../../shared/ai-access-types';
import { applicationCapabilityDetails, applicationCapabilitySchema, type ApplicationCapability } from '../../shared/application-capabilities';
import type { SheetRow } from '../../shared/ipc-types';
import type { ReconciliationScope } from '../../shared/reconciliation-types';

export function AiAccessDialog() {
  const [request, setRequest] = useState<AiAccessRequest | null>(null);
  const [open, setOpen] = useState(false);
  const [sheetIds, setSheetIds] = useState<string[]>([]);
  const [fields, setFields] = useState<ReconciliationScope['fields']>(['description', 'party', 'category', 'activity']);
  const [allowAdd, setAllowAdd] = useState(false); const [uploads, setUploads] = useState(false);
  const [capabilities, setCapabilities] = useState<ApplicationCapability[]>([]);
  const [allAccounts, setAllAccounts] = useState(false);
  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [matched, setMatched] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const ledgerName = useWindowStore((s) => s.dbName);
  const refresh = useCallback(() => {
    window.api.getAiBridgeState().then((state) => setRequest(state.access.requests[0] ?? null)).catch(() => setRequest(null));
  }, []);
  useEffect(() => { refresh(); const off = window.api.onAiChanged(refresh); const timer = setInterval(refresh, 15_000); return () => { off(); clearInterval(timer); }; }, [refresh]);
  useEffect(() => { setOpen(false); setMatched(false); setSheetIds([]); setAllowAdd(false); setUploads(false); setCapabilities([]); setAllAccounts(false); setError(null); }, [request?.id]);
  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true); setLoadError(null); setSheets([]);
    // Read directly: loading the sheet store can create a default account.
    window.api.getSheets().then((rows) => { if (current) setSheets(rows); })
      .catch((e: unknown) => { if (current) setLoadError(String(e)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [open, request?.id]);
  const policy = { sheetIds: allAccounts ? [] : sheetIds, fields, permissions: { allowAdd, allowStatementUploads: uploads, capabilities, allAccounts } };
  const validPolicy = aiAccessPolicySchema.safeParse(policy).success;
  if (!request) return null;
  async function respond(approve: boolean) {
    if (!request) return; setBusy(true); setError(null);
    try {
      if (approve) await window.api.approveAiAccess(request.id, policy);
      else await window.api.denyAiAccess(request.id);
      setOpen(false); refresh();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <>
    <aside role="status" aria-label="AI connection request" className="fixed bottom-4 right-4 z-50 w-80 space-y-2 rounded-lg border border-border bg-surface-raised p-4 shadow-lg">
      <p className="text-sm">An app is requesting access to this ledger.</p><Button size="sm" onClick={() => setOpen(true)}>Review connection request</Button>
    </aside>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader><DialogTitle>Allow AI access to this ledger?</DialogTitle><DialogDescription>The app identifies itself as {request.client === 'chatgpt' ? 'ChatGPT' : 'Claude'}. Approve only a connection you initiated. Selected financial data will be shared with your AI provider.</DialogDescription></DialogHeader>
        <p className="text-sm font-medium">Ledger: {ledgerName}</p>
        <p className="text-sm">Verification code: <strong className="font-mono">{request.code}</strong></p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={matched} onChange={(e) => setMatched(e.target.checked)} />This code matches the connection I requested in my AI app</label>
        <fieldset className="space-y-2"><legend className="text-sm font-medium">Accounts this app may access</legend>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={allAccounts} onChange={(e) => { setAllAccounts(e.target.checked); if (!e.target.checked) setCapabilities((values) => values.filter((value) => !applicationCapabilityDetails[value].ledgerWide)); }} />All current and future accounts, including ledger-wide operations</label>
          {loading && <p role="status" className="text-sm">Loading accounts…</p>}
          {loadError && <p role="alert" className="text-sm text-destructive">Could not load accounts: {loadError}</p>}
          {!loading && !loadError && !sheets.length && <p className="text-sm text-muted-foreground">This ledger has no accounts yet. Ledger-wide access is needed to create its first account.</p>}
          {sheets.filter((sheet) => !sheet.is_virtual && !sheet.is_planned).map((sheet) => <label key={sheet.id} className="flex gap-2 text-sm"><input type="checkbox" disabled={allAccounts} checked={allAccounts || sheetIds.includes(sheet.id)} onChange={(e) => setSheetIds((ids) => e.target.checked ? [...ids, sheet.id] : ids.filter((id) => id !== sheet.id))} />{sheet.name}</label>)}
        </fieldset>
        <fieldset className="flex flex-wrap gap-3"><legend className="text-sm font-medium">Details it may read</legend>{(['description', 'party', 'category', 'activity', 'reference', 'notes'] as const).map((field) => <label key={field} className="flex gap-2 text-sm capitalize"><input type="checkbox" checked={fields.includes(field)} onChange={(e) => setFields((values) => e.target.checked ? [...values, field] : values.filter((item) => item !== field))} />{field}</label>)}</fieldset>
        <p className="text-xs text-muted-foreground">Every approved connection may read reconciliation context for these accounts and selected fields. This includes dates, amounts, direction and account names, within each task’s requested date range. The additional read permissions below provide full records and versions. Field choices also restrict invoice billing details, line descriptions and notes. Category and activity management includes reading their names.</p>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={uploads} onChange={(e) => setUploads(e.target.checked)} />Receive statements I attach in my AI chat</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={allowAdd} onChange={(e) => setAllowAdd(e.target.checked)} />Add missing pending entries and fulfil planned payments when I ask</label>
        <fieldset className="space-y-2"><legend className="text-sm font-medium">Additional actions</legend>
          <p className="text-xs text-muted-foreground">Choose each permission separately. Ledger-wide actions require all current and future accounts above. Changes still follow your Fidra role and the normal review controls.</p>
          {applicationCapabilitySchema.options.map((capability) => <label key={capability} className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={!allAccounts && applicationCapabilityDetails[capability].ledgerWide} checked={capabilities.includes(capability)} onChange={(e) => setCapabilities((values) => e.target.checked ? [...values, capability] : values.filter((value) => value !== capability))} />{applicationCapabilityDetails[capability].label}</label>)}
        </fieldset>
        <p className="text-xs text-muted-foreground">Access is remembered on this device until you revoke it in Settings. Passwords and connection approvals stay inside Fidra. Your approval never gives an AI app more authority than you have.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => { void respond(false); }}>Deny</Button><Button disabled={busy || loading || !!loadError || !matched || !validPolicy} onClick={() => { void respond(true); }}>Allow access</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
