import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useWindowStore } from '@/stores/window-store';
import { useSheetStore } from '@/stores/sheet-store';
import type { AiAccessRequest } from '../../shared/ai-access-types';
import type { ReconciliationScope } from '../../shared/reconciliation-types';

export function AiAccessDialog() {
  const [request, setRequest] = useState<AiAccessRequest | null>(null);
  const [open, setOpen] = useState(false);
  const [sheetIds, setSheetIds] = useState<string[]>([]);
  const [fields, setFields] = useState<ReconciliationScope['fields']>(['description', 'party', 'category', 'activity']);
  const [allowAdd, setAllowAdd] = useState(false); const [uploads, setUploads] = useState(false);
  const [matched, setMatched] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const ledgerName = useWindowStore((s) => s.dbName);
  const sheets = useSheetStore((s) => s.sheets);
  const refresh = useCallback(() => {
    window.api.getAiBridgeState().then((state) => setRequest(state.access.requests[0] ?? null)).catch(() => setRequest(null));
  }, []);
  useEffect(() => { refresh(); const off = window.api.onAiChanged(refresh); const timer = setInterval(refresh, 15_000); return () => { off(); clearInterval(timer); }; }, [refresh]);
  useEffect(() => { setOpen(false); setMatched(false); setSheetIds([]); setAllowAdd(false); setUploads(false); setError(null); }, [request?.id]);
  if (!request) return null;
  async function respond(approve: boolean) {
    if (!request) return; setBusy(true); setError(null);
    try {
      if (approve) await window.api.approveAiAccess(request.id, { sheetIds, fields, permissions: { allowAdd, allowStatementUploads: uploads } });
      else await window.api.denyAiAccess(request.id);
      setOpen(false); refresh();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <>
    <aside role="status" aria-label="AI connection request" className="fixed bottom-4 right-4 z-50 w-80 space-y-2 rounded-lg border border-border bg-surface-raised p-4 shadow-lg">
      <p className="text-sm">An app is requesting access to this ledger.</p><Button size="sm" onClick={() => setOpen(true)}>Review connection request</Button>
    </aside>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader><DialogTitle>Allow AI access to this ledger?</DialogTitle><DialogDescription>The app identifies itself as {request.client === 'chatgpt' ? 'ChatGPT' : 'Claude'}. Approve only a connection you initiated. Selected financial data will be shared with your AI provider.</DialogDescription></DialogHeader>
        <p className="text-sm font-medium">Ledger: {ledgerName}</p>
        <p className="text-sm">Verification code: <strong className="font-mono">{request.code}</strong></p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={matched} onChange={(e) => setMatched(e.target.checked)} />This code matches the connection I requested in my AI app</label>
        <fieldset className="space-y-2"><legend className="text-sm font-medium">Accounts this app may access</legend>{sheets.filter((sheet) => !sheet.is_virtual && !sheet.is_planned).map((sheet) => <label key={sheet.id} className="flex gap-2 text-sm"><input type="checkbox" checked={sheetIds.includes(sheet.id)} onChange={(e) => setSheetIds((ids) => e.target.checked ? [...ids, sheet.id] : ids.filter((id) => id !== sheet.id))} />{sheet.name}</label>)}</fieldset>
        <fieldset className="flex flex-wrap gap-3"><legend className="text-sm font-medium">Details it may read</legend>{(['description', 'party', 'category', 'activity', 'reference', 'notes'] as const).map((field) => <label key={field} className="flex gap-2 text-sm capitalize"><input type="checkbox" checked={fields.includes(field)} onChange={(e) => setFields((values) => e.target.checked ? [...values, field] : values.filter((item) => item !== field))} />{field}</label>)}</fieldset>
        <p className="text-xs text-muted-foreground">Dates, amounts, direction and account names are included. Each task requests its own date range within these accounts.</p>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={uploads} onChange={(e) => setUploads(e.target.checked)} />Receive statements I attach in my AI chat</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={allowAdd} onChange={(e) => setAllowAdd(e.target.checked)} />Add missing pending entries and fulfil planned payments when I ask</label>
        <p className="text-xs text-muted-foreground">Access is remembered on this device. Fidra backs up imports and keeps an audit trail and Undo. Existing actual entries cannot be edited or deleted through this connection. Revoke access in Settings at any time.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => { void respond(false); }}>Deny</Button><Button disabled={busy || !matched || !sheetIds.length} onClick={() => { void respond(true); }}>Allow access</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
