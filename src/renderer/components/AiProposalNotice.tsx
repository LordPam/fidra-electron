import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { updateBlocker } from '@/services/update-preparation';
import { useUndoStore } from '@/stores/undo-store';
import { createReconciliationImportCommand, createAiSheetCreationCommand } from '@/services/undo';
import { useTransactionStore } from '@/stores/transaction-store';
import { usePlannedStore } from '@/stores/planned-store';
import { useSheetStore } from '@/stores/sheet-store';

/** AI activity stays visible without navigating away from unfinished work. */
export function AiProposalNotice() {
  const [visible, setVisible] = useState<'draft' | 'imported' | 'sheet' | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [reason, setReason] = useState<string | null>(null);
  const location = useLocation(); const navigate = useNavigate();
  useEffect(() => {
    setVisible(null); setReason(null);
    const draft = window.api.onAiProposalReady(() => { if (location.pathname !== '/settings') setVisible('draft'); });
    const imported = window.api.onAiImportCommitted((approval) => {
      const command = createReconciliationImportCommand(approval);
      const undo = useUndoStore.getState();
      if (!undo.undoStack.some((item) => item.id === command.id)) undo.record(command);
      void Promise.all([useTransactionStore.getState().silentRefresh(), usePlannedStore.getState().silentRefresh()]).catch(() => setReason('The import completed. Reopen this view to refresh the entries.'));
      setVisible('imported');
    });
    const sheetCreated = window.api.onAiSheetCreated((creation) => {
      if (creation.state !== 'applied') return;
      const command = createAiSheetCreationCommand(creation);
      const undo = useUndoStore.getState();
      if (![...undo.undoStack, ...undo.redoStack].some((item) => item.id === command.id)) undo.record(command);
      void useSheetStore.getState().silentRefresh();
      setSheetName(creation.sheet.name); setReason(null); setVisible('sheet');
    });
    return () => { draft(); imported(); sheetCreated(); };
  }, [location.pathname]);
  if (!visible) return null;
  return <aside role="status" aria-label={visible === 'sheet' ? 'AI sheet created' : visible === 'imported' ? 'AI statement imported' : 'Statement draft ready'} className="fixed right-4 top-16 z-50 w-80 space-y-2 rounded-lg border border-border bg-surface-raised p-4 shadow-lg">
    <p className="text-sm font-medium">{visible === 'sheet' ? `Your AI created “${sheetName}”` : visible === 'imported' ? 'Your AI imported statement entries' : 'A statement draft is ready for review'}</p>
    <p className="text-xs text-muted-foreground">{visible === 'sheet' ? 'The empty sheet is ready. You can undo its creation while it remains empty and unchanged.' : visible === 'imported' ? 'Entries were added under your connection permission. Review the batch and use Undo in Settings.' : 'This is a draft. It stays unchanged until applied through an authorised connection or approved here.'}</p>
    {reason && <p className="text-xs text-destructive">{reason}</p>}
    <div className="flex gap-2"><Button size="sm" onClick={() => {
      const blocked = updateBlocker(); if (blocked) { setReason(blocked); return; }
      setVisible(null); navigate(visible === 'sheet' ? '/transactions' : '/settings');
    }}>{visible === 'sheet' ? 'View sheets' : visible === 'imported' ? 'View import' : 'Review draft'}</Button><Button size="sm" variant="ghost" onClick={() => setVisible(null)}>Dismiss</Button></div>
  </aside>;
}
