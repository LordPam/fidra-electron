import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { PlannedTemplateRow, TransactionRow, InvoiceRow } from '../../shared/ipc-types';
import { defaultStatusForType } from '../../shared/transaction-rules';

import { usePlannedStore } from '@/stores/planned-store';
import { useTransactionStore } from '@/stores/transaction-store';
import { useSheetStore } from '@/stores/sheet-store';
import { useCategoryStore } from '@/stores/category-store';
import { useUndoStore } from '@/stores/undo-store';
import { useViewZoom } from '@/hooks/useViewZoom';
import { useSheetFiltered } from '@/hooks/useSheetFiltered';

import { expandTemplate, createInstance, getNextDueDate, getOverdueDate, type PlannedInstance } from '../../shared/forecast';
import type { ExpandedTemplate } from '@/domain/models';
import { getUniqueValues } from '@/lib/autocomplete';
import { formatCurrency, formatDate } from '@/lib/format';
import {
  createAddPlannedCommand,
  createBulkAddPlannedCommand,
  createBulkDeletePlannedCommand,
  createBulkEditPlannedCommand,
  createEditPlannedCommand,
  createDeletePlannedCommand,
  createConvertPlannedCommand,
  createAddTransferCommand,
  createAddTransactionCommand,
} from '@/services/undo';
import { cn } from '@/lib/utils';

import { AddPlannedDialog } from '@/dialogs/AddPlannedDialog';
import { EditPlannedDialog } from '@/dialogs/EditPlannedDialog';
import { BulkEditPlannedDialog } from '@/dialogs/BulkEditPlannedDialog';
import { PlannedGroupWarningDialog, type PlannedGroupAction } from '@/dialogs/PlannedGroupWarningDialog';
import { EditTransactionDialog } from '@/dialogs/EditTransactionDialog';

import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { UndoRedoButtons } from '@/components/UndoRedoButtons';
import {
  Plus,
  ChevronRight,
  ChevronDown,
  Pencil,
  Trash2,
  Copy,
  ArrowRightLeft,
  X,
  FileText,
} from 'lucide-react';
import { ZoomControls } from '@/components/ZoomControls';
import { useUndoRedoShortcuts } from '@/hooks/useUndoRedoShortcuts';
import { toAmount } from '../../shared/money';
import { groupPlannedByActivity, plannedGroupHasMultipleInstances, UNASSIGNED_ACTIVITY } from '@/services/planned-groups';

const HORIZON_DAYS = 180;

function addDaysToToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function PlannedView() {
  const location = useLocation();
  const navigate = useNavigate();
  const { templates, loading, loadAll: loadPlanned } = usePlannedStore();
  const { transactions, loadAll: loadTransactions } = useTransactionStore();
  const { sheets, currentSheet, loadAll: loadSheets } = useSheetStore();
  const { incomeCategories, expenseCategories, loadAll: loadCategories } = useCategoryStore();
  const { execute } = useUndoStore();
  useUndoRedoShortcuts();
  const { zoom: plannedTableZoom, zoomIn: zoomPlannedTableIn, zoomOut: zoomPlannedTableOut, resetZoom: resetPlannedTableZoom } = useViewZoom('plannedTableZoom');

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PlannedTemplateRow | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(new Set());
  const selectionAnchorRef = useRef<string | null>(null);
  const [selectedInstance, setSelectedInstance] = useState<{ templateId: string; instanceDate: string } | null>(null);
  const [showBulkEditDialog, setShowBulkEditDialog] = useState(false);
  const [groupWarning, setGroupWarning] = useState<{
    action: PlannedGroupAction;
    template: PlannedTemplateRow;
    instanceDate: string;
  } | null>(null);
  const [linkedInvoiceTemplateIds, setLinkedInvoiceTemplateIds] = useState<Set<string>>(new Set());
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [convertingTransaction, setConvertingTransaction] = useState<TransactionRow | null>(null);
  const convertingInstanceRef = useRef<PlannedInstance | null>(null);
  const [deletingTemplateData, setDeletingTemplateData] = useState<Map<string, { template: PlannedTemplateRow; index: number }>>(new Map());

  const sheetNames = useMemo(
    () => sheets.filter((s) => !s.is_virtual && !s.is_planned).map((s) => s.name),
    [sheets],
  );

  useEffect(() => {
    loadPlanned();
    loadSheets();
    loadCategories();
    loadTransactions();
    // Load which templates have linked invoices
    window.api.getInvoices().then((rows: unknown[]) => {
      const ids = new Set<string>();
      for (const row of rows as { planned_template_id: string | null }[]) {
        if (row.planned_template_id) ids.add(row.planned_template_id);
      }
      setLinkedInvoiceTemplateIds(ids);
    });
  }, [loadPlanned, loadSheets, loadCategories, loadTransactions]);

  // Select template if navigated from dashboard
  useEffect(() => {
    const state = location.state as { selectTemplateId?: string } | null;
    if (state?.selectTemplateId) {
      setSelectedTemplateId(state.selectTemplateId);
      setSelectedTemplateIds(new Set([state.selectTemplateId]));
      // Clear state so it doesn't re-select on re-render
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  const horizon = addDaysToToday(HORIZON_DAYS);
  const today = todayISO();

  // Filter templates by current sheet
  const getTargetSheet = useCallback((t: PlannedTemplateRow) => t.target_sheet, []);
  const sheetFiltered = useSheetFiltered(templates, currentSheet, getTargetSheet);

  // Expand each template into its instances, filter out completed ones with no future instances
  const expanded: ExpandedTemplate[] = useMemo(() => {
    return sheetFiltered
      .map((template) => {
        const futureInstances = expandTemplate(template, horizon);
        const overdueDate = getOverdueDate(template);
        // Prepend a synthetic instance for the overdue date if it's not already covered
        let instances = futureInstances;
        if (overdueDate && !futureInstances.some((i) => i.instanceDate === overdueDate)) {
          const overdueInstance: PlannedInstance = {
            transaction: createInstance(template, overdueDate),
            templateId: template.id,
            instanceDate: overdueDate,
          };
          instances = [overdueInstance, ...futureInstances];
        }
        return {
          template,
          instances,
          nextDue: getNextDueDate(template),
          overdueDate,
        };
      })
      .filter(({ instances, nextDue, overdueDate }) =>
        instances.length > 0 || nextDue !== null || overdueDate !== null
      );
  }, [sheetFiltered, horizon]);

  const activityGroups = useMemo(
    () => groupPlannedByActivity(expanded, (entry) => entry.template),
    [expanded],
  );
  const orderedExpanded = useMemo(
    () => activityGroups.flatMap((group) => group.items),
    [activityGroups],
  );

  const selectedTemplates = useMemo(
    () => orderedExpanded
      .filter(({ template }) => selectedTemplateIds.has(template.id))
      .map(({ template }) => template),
    [orderedExpanded, selectedTemplateIds],
  );

  const multiInstanceSelectionCount = useMemo(
    () => orderedExpanded.filter(({ template, instances }) =>
      selectedTemplateIds.has(template.id) && plannedGroupHasMultipleInstances(template, instances.length)
    ).length,
    [orderedExpanded, selectedTemplateIds],
  );

  // Summary stats for the balance card
  const plannedSummary = useMemo(() => {
    let totalIncome = 0;
    let totalExpenses = 0;
    let overdueCount = 0;

    for (const { template, instances, overdueDate } of expanded) {
      for (const inst of instances) {
        const amount = toAmount(inst.transaction.amount);
        if (template.type === 'income') totalIncome += amount;
        else totalExpenses += amount;
      }
      if (overdueDate !== null) overdueCount++;
    }

    return {
      templateCount: expanded.length,
      totalIncome,
      totalExpenses,
      net: totalIncome - totalExpenses,
      overdueCount,
    };
  }, [expanded]);

  // Selected template details for the sidebar card
  const selectedTemplateDetails = useMemo(() => {
    if (!selectedTemplateId) return null;
    const entry = expanded.find((ex) => ex.template.id === selectedTemplateId);
    if (!entry) return null;
    const { template, nextDue } = entry;
    return {
      description: template.description,
      amount: toAmount(template.amount),
      type: template.type,
      party: template.party,
      nextDue,
    };
  }, [selectedTemplateId, expanded]);

  const showSheetColumn = currentSheet === 'All Sheets' && sheetNames.length >= 2;

  // Autocomplete suggestions from existing transactions
  const descriptionSuggestions = useMemo(() => getUniqueValues(transactions, 'description'), [transactions]);
  const partySuggestions = useMemo(() => getUniqueValues(transactions, 'party'), [transactions]);
  const activitySuggestions = useMemo(() => getUniqueValues(transactions, 'activity'), [transactions]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = useCallback(() => {
    setSelectedTemplateId(null);
    setSelectedTemplateIds(new Set());
    setSelectedInstance(null);
    selectionAnchorRef.current = null;
  }, []);

  const selectTemplate = useCallback((templateId: string, event?: React.MouseEvent) => {
    setSelectedInstance(null);
    setSelectedTemplateId(templateId);

    if (event?.shiftKey && selectionAnchorRef.current) {
      const anchorIndex = orderedExpanded.findIndex(({ template }) => template.id === selectionAnchorRef.current);
      const targetIndex = orderedExpanded.findIndex(({ template }) => template.id === templateId);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        setSelectedTemplateIds(new Set(orderedExpanded.slice(start, end + 1).map(({ template }) => template.id)));
        return;
      }
    }

    if (event && (event.metaKey || event.ctrlKey)) {
      setSelectedTemplateIds((previous) => {
        const next = new Set(previous);
        if (next.has(templateId)) {
          next.delete(templateId);
          setSelectedTemplateId(next.values().next().value ?? null);
        } else {
          next.add(templateId);
          setSelectedTemplateId(templateId);
        }
        return next;
      });
      selectionAnchorRef.current = templateId;
      return;
    }

    setSelectedTemplateIds(new Set([templateId]));
    selectionAnchorRef.current = templateId;
  }, [orderedExpanded]);

  const selectInstance = useCallback((templateId: string, instanceDate: string) => {
    setSelectedTemplateId(templateId);
    setSelectedTemplateIds(new Set([templateId]));
    setSelectedInstance({ templateId, instanceDate });
    selectionAnchorRef.current = templateId;
  }, []);

  const handleAdd = useCallback(async (template: PlannedTemplateRow) => {
    await execute(createAddPlannedCommand(template));
  }, [execute]);

  const handleEdit = useCallback((original: PlannedTemplateRow, updated: PlannedTemplateRow) => {
    execute(createEditPlannedCommand(original, updated));
  }, [execute]);

  const handleDeleteTemplates = useCallback(async (toDelete: PlannedTemplateRow[]) => {
    if (toDelete.length === 0) return;
    setDeletingTemplateData((prev) => {
      const next = new Map(prev);
      for (const template of toDelete) {
        const idx = orderedExpanded.findIndex((entry) => entry.template.id === template.id);
        next.set(template.id, { template, index: idx >= 0 ? idx : 0 });
      }
      return next;
    });
    if (toDelete.length === 1) await execute(createDeletePlannedCommand(toDelete[0]));
    else await execute(createBulkDeletePlannedCommand(toDelete));
    clearSelection();
    setTimeout(() => {
      setDeletingTemplateData((prev) => {
        const next = new Map(prev);
        for (const template of toDelete) next.delete(template.id);
        return next;
      });
    }, 400);
  }, [clearSelection, execute, orderedExpanded]);

  const handleDelete = useCallback(async (template: PlannedTemplateRow) => {
    await handleDeleteTemplates([template]);
  }, [handleDeleteTemplates]);

  const handleDuplicateTemplates = useCallback(async (toDuplicate: PlannedTemplateRow[]) => {
    if (toDuplicate.length === 0) return;
    const now = new Date().toISOString();
    const duplicates = toDuplicate.map((template) => ({
      ...template,
      id: crypto.randomUUID(),
      skipped_dates: '[]',
      fulfilled_dates: '[]',
      version: 1,
      created_at: now,
    }));
    if (duplicates.length === 1) await execute(createAddPlannedCommand(duplicates[0]));
    else await execute(createBulkAddPlannedCommand(duplicates));
    setSelectedTemplateId(duplicates[0].id);
    setSelectedTemplateIds(new Set(duplicates.map((template) => template.id)));
    setSelectedInstance(null);
  }, [execute]);

  const handleDuplicate = useCallback(async (template: PlannedTemplateRow) => {
    await handleDuplicateTemplates([template]);
  }, [handleDuplicateTemplates]);

  const handleBulkEditSave = useCallback(async (
    originals: PlannedTemplateRow[],
    updated: PlannedTemplateRow[],
  ) => {
    await execute(createBulkEditPlannedCommand(originals, updated));
  }, [execute]);

  const requestInstanceGroupAction = useCallback((
    action: PlannedGroupAction,
    template: PlannedTemplateRow,
    instanceDate: string,
  ) => {
    setGroupWarning({ action, template, instanceDate });
  }, []);

  const handleConvert = useCallback(async (_template: PlannedTemplateRow, instance: PlannedInstance) => {
    const txSettings = await window.api.getTransactionSettings();
    const now = new Date().toISOString();
    const newTx: TransactionRow = {
      ...instance.transaction,
      id: crypto.randomUUID(),
      date: txSettings.dateOnPlannedConversion ? now.slice(0, 10) : instance.instanceDate,
      status: defaultStatusForType(instance.transaction.type),
      version: 1,
      created_at: now,
      modified_at: null,
      modified_by: null,
    };
    convertingInstanceRef.current = instance;
    setConvertingTransaction(newTx);
    setShowConvertDialog(true);
  }, []);

  const handleConvertSave = useCallback(async (_original: TransactionRow, updated: TransactionRow) => {
    const instance = convertingInstanceRef.current;
    if (!instance) {
      await execute(createAddTransactionCommand(updated));
      return;
    }
    convertingInstanceRef.current = null;
    const template = templates.find((t) => t.id === instance.templateId);
    if (template) {
      let updatedTemplate: PlannedTemplateRow | null = null;
      if (template.frequency !== 'once') {
        const fulfilled: string[] = JSON.parse(template.fulfilled_dates || '[]');
        fulfilled.push(instance.instanceDate);
        updatedTemplate = {
          ...template,
          fulfilled_dates: JSON.stringify(fulfilled),
          version: template.version + 1,
        };
      }

      // Transfer template: create linked pair instead of single transaction
      if (template.transfer_target_sheet) {
        const linkedId = crypto.randomUUID();
        const now = new Date().toISOString();
        const expense: TransactionRow = {
          ...updated,
          type: 'expense',
          status: 'approved',
          linked_id: linkedId,
          sheet: template.target_sheet,
        };
        const income: TransactionRow = {
          ...updated,
          id: crypto.randomUUID(),
          type: 'income',
          status: '--',
          linked_id: linkedId,
          sheet: template.transfer_target_sheet,
          created_at: now,
        };

        // Mark template fulfilled then create the transfer pair
        if (updatedTemplate) {
          await execute(createEditPlannedCommand(template, updatedTemplate));
        } else {
          await execute(createDeletePlannedCommand(template));
        }
        await execute(createAddTransferCommand(expense, income));
      } else {
        let linkedInvoice: InvoiceRow | undefined;
        try {
          const linkedInvoices = await window.api.getInvoicesByPlannedTemplate(template.id);
          if (linkedInvoices.length > 0 && linkedInvoices[0].status !== 'paid') {
            linkedInvoice = linkedInvoices[0];
          }
        } catch { /* Non-critical */ }

        await execute(createConvertPlannedCommand(template, updatedTemplate, updated, linkedInvoice));
      }
    } else {
      await execute(createAddTransactionCommand(updated));
    }
    setShowConvertDialog(false);
  }, [execute, templates]);

  const handleCreateInvoice = useCallback(async (template: PlannedTemplateRow, instanceDate?: string) => {
    // Check if an invoice already exists for this planned template
    const existing = await window.api.getInvoicesByPlannedTemplate(template.id);
    if (existing.length > 0) {
      // Navigate to the existing invoice instead of creating a new one
      navigate('/invoices', {
        state: { selectInvoiceId: existing[0].id },
      });
      return;
    }

    // Use the provided instance date, or fall back to the next due date
    const dueDate = instanceDate
      ?? expanded.find((ex) => ex.template.id === template.id)?.nextDue
      ?? undefined;

    navigate('/invoices', {
      state: {
        invoicePrefill: {
          toName: template.party || '',
          description: template.description,
          amount: toAmount(template.amount),
          date: dueDate,
          plannedTemplateId: template.id,
        },
      },
    });
  }, [navigate, expanded]);

  const handleSkipInstance = useCallback(async (template: PlannedTemplateRow, instanceDate: string) => {
    const skipped: string[] = JSON.parse(template.skipped_dates || '[]');
    skipped.push(instanceDate);
    const updated: PlannedTemplateRow = {
      ...template,
      skipped_dates: JSON.stringify(skipped),
      version: template.version + 1,
    };
    await execute(createEditPlannedCommand(template, updated));
  }, [execute]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      const active = document.activeElement as HTMLElement | null;
      const tag = (active?.tagName ?? '').toUpperCase();
      const isInputFocused = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (isMod && e.key.toLowerCase() === 'n' && !isInputFocused) {
        e.preventDefault();
        setShowAddDialog(true);
        return;
      }

      if (isInputFocused) return;
      if (active?.closest('form, [role="dialog"], [role="listbox"], [data-radix-popper-content-wrapper]')) return;

      if (isMod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedTemplateIds(new Set(orderedExpanded.map(({ template }) => template.id)));
        setSelectedTemplateId(orderedExpanded[0]?.template.id ?? null);
        setSelectedInstance(null);
        return;
      }

      if (isMod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (selectedInstance) {
          const entry = orderedExpanded.find(({ template }) => template.id === selectedInstance.templateId);
          if (entry) requestInstanceGroupAction('duplicate', entry.template, selectedInstance.instanceDate);
        } else {
          void handleDuplicateTemplates(selectedTemplates);
        }
        return;
      }

      if (isMod && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        if (selectedInstance) {
          const entry = orderedExpanded.find(({ template }) => template.id === selectedInstance.templateId);
          if (entry) requestInstanceGroupAction('delete', entry.template, selectedInstance.instanceDate);
        } else {
          void handleDeleteTemplates(selectedTemplates);
        }
        return;
      }

      if (e.key === 'Escape') {
        clearSelection();
        return;
      }

      // Arrow keys: navigate between templates (skip when Cmd/Ctrl held)
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !isMod) {
        e.preventDefault();
        if (orderedExpanded.length === 0) return;

        const currentIdx = selectedTemplateId
          ? orderedExpanded.findIndex((ex) => ex.template.id === selectedTemplateId)
          : -1;

        let nextIdx: number;
        if (e.key === 'ArrowDown') {
          nextIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, orderedExpanded.length - 1);
        } else {
          nextIdx = currentIdx < 0 ? 0 : Math.max(currentIdx - 1, 0);
        }

        const nextId = orderedExpanded[nextIdx].template.id;
        setSelectedTemplateId(nextId);
        setSelectedTemplateIds(new Set([nextId]));
        setSelectedInstance(null);
        selectionAnchorRef.current = nextId;
        return;
      }

      if (e.key === 'e' || e.key === 'E') {
        if (selectedTemplates.length > 1) {
          setShowBulkEditDialog(true);
        } else if (selectedTemplates.length === 1) {
          setEditingTemplate(selectedTemplates[0]);
          setShowEditDialog(true);
        }
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    clearSelection,
    handleDeleteTemplates,
    handleDuplicateTemplates,
    orderedExpanded,
    requestInstanceGroupAction,
    selectedInstance,
    selectedTemplateId,
    selectedTemplates,
  ]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="app-drag app-view-header flex items-center justify-between px-6 py-3 border-b border-border-subtle bg-surface-raised">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-display font-semibold">Planned</h1>
        </div>

        <div className="flex items-center gap-1">
          {selectedTemplates.length > 1 && (
            <Button variant="outline" size="sm" onClick={() => setShowBulkEditDialog(true)}>
              <Pencil className="h-4 w-4 mr-1" />
              Edit {selectedTemplates.length} Groups
            </Button>
          )}
          <Button size="sm" onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Planned
          </Button>
          <UndoRedoButtons />
          <ZoomControls
            zoom={plannedTableZoom}
            onZoomIn={zoomPlannedTableIn}
            onZoomOut={zoomPlannedTableOut}
            onReset={resetPlannedTableZoom}
          />
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 flex gap-3 overflow-hidden px-5 pt-4 pb-5 min-h-0">
        {loading ? (
          <div className="flex-1 flex items-center justify-center rounded-xl border border-border-subtle">
            <p className="font-display text-sm text-muted-foreground">Loading planned transactions...</p>
          </div>
        ) : expanded.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <p className="font-display font-medium text-fidra-slate">No planned transactions</p>
            <p className="text-sm text-muted-foreground">Click "Add Planned" to create your first template</p>
          </div>
        ) : (
          <div
            className="flex-1 overflow-auto rounded-xl border border-border-subtle bg-[#EEEEE9] dark:bg-[#2A2D32]"
            onClick={clearSelection}
          >
            <div style={plannedTableZoom !== 1 ? { zoom: plannedTableZoom } : undefined}>
            <table className="w-full text-sm font-body">
              <thead className="bg-[#E4E4DF] dark:bg-[#32363B] sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 text-left font-display text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground border-b border-border-subtle w-8" />
                  <th className="px-4 py-3 text-left font-display text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground border-b border-border-subtle">Description</th>
                  <th className="px-4 py-3 text-left font-display text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground border-b border-border-subtle">Party</th>
                  <th className="px-4 py-3 text-right font-display text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground border-b border-border-subtle">Amount</th>
                  {showSheetColumn && (
                    <th className="px-4 py-3 text-left font-display text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground border-b border-border-subtle">Sheet</th>
                  )}
                  <th className="px-4 py-3 text-left font-display text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground border-b border-border-subtle">Frequency</th>
                  <th className="px-4 py-3 text-left font-display text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground border-b border-border-subtle">Next Due</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Merge ghost rows at their original positions
                  const colCount = showSheetColumn ? 7 : 6;
                  type RenderItem = { type: 'live'; entry: ExpandedTemplate; idx: number } | { type: 'ghost'; template: PlannedTemplateRow };
                  const items: RenderItem[] = orderedExpanded.map((entry, idx) => ({ type: 'live' as const, entry, idx }));
                  const ghosts = Array.from(deletingTemplateData.values()).sort((a, b) => a.index - b.index);
                  let offset = 0;
                  for (const { template, index } of ghosts) {
                    if (orderedExpanded.some((ex) => ex.template.id === template.id)) continue;
                    const insertAt = Math.min(index + offset, items.length);
                    items.splice(insertAt, 0, { type: 'ghost', template });
                    offset++;
                  }
                  let previousActivity: string | null = null;
                  return items.map((item) => {
                    const itemTemplate = item.type === 'ghost' ? item.template : item.entry.template;
                    const activity = itemTemplate.activity?.trim() || UNASSIGNED_ACTIVITY;
                    const showActivityHeader = activity !== previousActivity;
                    previousActivity = activity;
                    if (item.type === 'ghost') {
                      const tmpl = item.template;
                      return (
                        <React.Fragment key={`deleting-${tmpl.id}`}>
                          {showActivityHeader && (
                            <tr className="bg-fidra-teal/10" data-activity-group={activity}>
                              <td colSpan={colCount} className="px-4 py-2 font-display text-xs font-semibold text-fidra-teal">{activity}</td>
                            </tr>
                          )}
                          <tr data-row-deleting="" className="border-b border-border-subtle">
                            <td colSpan={colCount} className="whitespace-nowrap px-4 py-3">
                              <div className="flex items-center gap-4">
                                <span className="text-foreground font-medium">{tmpl.description}</span>
                                <span className={cn('font-mono tabular-nums ml-auto', tmpl.type === 'income' ? 'text-fidra-positive' : 'text-fidra-negative')}>
                                  {formatCurrency(tmpl.amount)}
                                </span>
                              </div>
                            </td>
                          </tr>
                        </React.Fragment>
                      );
                    }
                    const { entry: { template, instances, nextDue, overdueDate }, idx } = item;
                  const isExpanded = expandedIds.has(template.id);
                  const isSelected = selectedTemplateIds.has(template.id);
                  const isOverdue = overdueDate !== null;

                  return (
                    <React.Fragment key={template.id}>
                      {showActivityHeader && (
                        <tr className="bg-fidra-teal/10" data-activity-group={activity}>
                          <td colSpan={colCount} className="px-4 py-2 font-display text-xs font-semibold text-fidra-teal">
                            <span>{activity}</span>
                            <span className="ml-2 font-body font-normal text-muted-foreground">
                              {activityGroups.find((group) => group.activity === activity)?.items.length ?? 0} {activityGroups.find((group) => group.activity === activity)?.items.length === 1 ? 'group' : 'groups'}
                            </span>
                          </td>
                        </tr>
                      )}
                      {/* Template row */}
                      <ContextMenu>
                        <ContextMenuTrigger asChild>
                          <tr
                            className={cn(
                              'border-b border-border-subtle cursor-pointer transition-[background-color] duration-150',
                              idx % 2 === 0 ? 'bg-[#EEEEE9] dark:bg-[#2A2D32]' : 'bg-[#E8E8E3] dark:bg-[#252830]',
                              'hover:bg-fidra-teal/5',
                              isOverdue && 'italic',
                            )}
                            {...(isSelected ? { 'data-row-selected': '', 'data-row-focused': '' } : {})}
                            onClick={(e) => {
                              e.stopPropagation();
                              selectTemplate(template.id, e);
                            }}
                            onContextMenu={() => {
                              if (!selectedTemplateIds.has(template.id)) {
                                setSelectedTemplateId(template.id);
                                setSelectedTemplateIds(new Set([template.id]));
                                setSelectedInstance(null);
                              }
                            }}
                            onDoubleClick={() => {
                              setEditingTemplate(template);
                              setShowEditDialog(true);
                            }}
                          >
                            <td
                              className="px-4 py-3"
                              onClick={(e) => {
                                if (instances.length > 0) {
                                  e.stopPropagation();
                                  selectTemplate(template.id, e);
                                  toggleExpanded(template.id);
                                }
                              }}
                            >
                              {instances.length > 0 ? (
                                isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                              ) : null}
                            </td>
                            <td className={cn('px-4 py-3 font-medium', isOverdue && 'text-fidra-warning')}>
                              {template.description}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground truncate max-w-[150px]">{template.party || ''}</td>
                            <td className={cn(
                              'px-4 py-3 text-right tabular-nums font-mono',
                              isOverdue ? 'text-fidra-warning' : template.type === 'income' ? 'text-fidra-positive' : 'text-fidra-negative',
                            )}>
                              {isOverdue && (template.type === 'income' ? '+' : '\u2212')}
                              {formatCurrency(template.amount)}
                            </td>
                            {showSheetColumn && (
                              <td className="px-4 py-3 text-muted-foreground">{template.target_sheet}</td>
                            )}
                            <td className="px-4 py-3 text-muted-foreground">{capitalise(template.frequency)}</td>
                            <td className={cn('px-4 py-3', isOverdue ? 'text-fidra-warning' : 'text-muted-foreground')}>
                              {isOverdue && (
                                <span className="inline-flex items-center rounded-md bg-fidra-warning/15 text-fidra-warning px-1.5 py-0.5 text-[10px] font-medium mr-1.5">
                                  Overdue
                                </span>
                              )}
                              {nextDue ? formatDate(nextDue) : isOverdue ? formatDate(overdueDate) : 'Completed'}
                            </td>
                          </tr>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem onClick={() => {
                            if (selectedTemplateIds.has(template.id) && selectedTemplates.length > 1) {
                              setShowBulkEditDialog(true);
                            } else {
                              setEditingTemplate(template);
                              setShowEditDialog(true);
                            }
                          }}>
                            <Pencil className="h-3.5 w-3.5 mr-2" /> {selectedTemplateIds.has(template.id) && selectedTemplates.length > 1 ? `Bulk Edit (${selectedTemplates.length})` : 'Edit'}
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => selectedTemplateIds.has(template.id) && selectedTemplates.length > 1
                            ? handleDuplicateTemplates(selectedTemplates)
                            : handleDuplicate(template)}>
                            <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate{selectedTemplateIds.has(template.id) && selectedTemplates.length > 1 ? ` (${selectedTemplates.length})` : ''}
                          </ContextMenuItem>
                          {instances.length > 0 && (
                            <ContextMenuItem onClick={() => handleConvert(template, instances[0])}>
                              <ArrowRightLeft className="h-3.5 w-3.5 mr-2" /> Convert to Transaction
                            </ContextMenuItem>
                          )}
                          {template.type === 'income' && (
                            <ContextMenuItem onClick={() => handleCreateInvoice(template)}>
                              <FileText className="h-3.5 w-3.5 mr-2" /> {linkedInvoiceTemplateIds.has(template.id) ? 'View Invoice' : 'Create Invoice'}
                            </ContextMenuItem>
                          )}
                          {template.activity && (
                            <ContextMenuItem onClick={() => navigate('/activities', { state: { selectActivity: template.activity } })}>
                              View Activity
                            </ContextMenuItem>
                          )}
                          <ContextMenuSeparator />
                          <ContextMenuItem className="text-destructive" onClick={() => selectedTemplateIds.has(template.id) && selectedTemplates.length > 1
                            ? handleDeleteTemplates(selectedTemplates)
                            : handleDelete(template)}>
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete{selectedTemplateIds.has(template.id) && selectedTemplates.length > 1 ? ` (${selectedTemplates.length})` : ''}
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>

                      {/* Instance rows */}
                      {isExpanded && instances.map((inst) => {
                        const isInstanceSelected = selectedInstance?.templateId === template.id && selectedInstance.instanceDate === inst.instanceDate;
                        return (
                          <ContextMenu key={inst.transaction.id}>
                            <ContextMenuTrigger asChild>
                              <tr
                                data-planned-instance={inst.instanceDate}
                                {...(isInstanceSelected ? { 'data-row-selected': '', 'data-row-focused': '' } : {})}
                                className="border-b border-border-subtle bg-surface-inset/50 hover:bg-fidra-teal/5 cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  selectInstance(template.id, inst.instanceDate);
                                }}
                                onDoubleClick={() => {
                                  setEditingTemplate(template);
                                  setShowEditDialog(true);
                                }}
                              >
                                <td className="px-4 py-2" />
                                <td className="px-4 py-2 text-muted-foreground pl-10">
                                  {formatDate(inst.instanceDate)}
                                </td>
                                <td className="px-4 py-2" />
                                <td className={cn(
                                  'px-4 py-2 text-right tabular-nums font-mono',
                                  template.type === 'income' ? 'text-fidra-positive/70' : 'text-fidra-negative/70',
                                )}>
                                  {formatCurrency(inst.transaction.amount)}
                                </td>
                                {showSheetColumn && <td className="px-4 py-2" />}
                                <td className="px-4 py-2 text-muted-foreground text-xs">{capitalise(inst.transaction.type)}</td>
                                <td className="px-4 py-2">
                                  <div className="flex items-center gap-1">
                                    <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-fidra-teal/15 text-fidra-teal">
                                      Planned
                                    </span>
                                    {inst.instanceDate < today && (
                                      <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-fidra-warning/15 text-fidra-warning">
                                        Overdue
                                      </span>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0"
                                      title="Convert to actual transaction"
                                      onClick={(e) => { e.stopPropagation(); handleConvert(template, inst); }}
                                    >
                                      <ArrowRightLeft className="h-3 w-3" />
                                    </Button>
                                    {template.type === 'income' && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0"
                                        title={linkedInvoiceTemplateIds.has(template.id) ? 'View invoice' : 'Create invoice from this instance'}
                                        onClick={(e) => { e.stopPropagation(); handleCreateInvoice(template, inst.instanceDate); }}
                                      >
                                        <FileText className="h-3 w-3" />
                                      </Button>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0 text-destructive"
                                      title="Skip this occurrence"
                                      onClick={(e) => { e.stopPropagation(); handleSkipInstance(template, inst.instanceDate); }}
                                    >
                                      <X className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              <ContextMenuItem onClick={() => { setEditingTemplate(template); setShowEditDialog(true); }}>
                                <Pencil className="h-3.5 w-3.5 mr-2" /> Edit Linked Group
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => requestInstanceGroupAction('duplicate', template, inst.instanceDate)}>
                                <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate Linked Group
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem className="text-destructive" onClick={() => requestInstanceGroupAction('delete', template, inst.instanceDate)}>
                                <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete Linked Group
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        );
                      })}
                    </React.Fragment>
                  );
                  });
                })()}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* Right card: Planned Summary */}
        <div className="w-[220px] shrink-0 overflow-y-auto rounded-xl border border-border-subtle bg-surface-raised p-4">
          <div className="flex flex-col gap-4">
            {/* Net — hero section */}
            <div className="border-t-[3px] border-t-fidra-teal pt-3">
              <p className="text-xs font-display font-medium uppercase tracking-[0.05em] text-muted-foreground mb-1">
                Net Planned
              </p>
              <p className={cn(
                'text-2xl font-display font-bold tabular-nums',
                plannedSummary.net > 0 ? 'text-fidra-positive' : plannedSummary.net < 0 ? 'text-fidra-negative' : 'text-foreground',
              )}>
                {plannedSummary.net > 0 ? '+' : ''}{formatCurrency(plannedSummary.net)}
              </p>
            </div>

            {/* Income */}
            <div>
              <p className="text-xs font-display font-medium uppercase tracking-[0.05em] text-muted-foreground mb-1">
                Income
              </p>
              <p className="text-lg font-display font-semibold tabular-nums text-fidra-positive">
                {formatCurrency(plannedSummary.totalIncome)}
              </p>
            </div>

            {/* Expenses */}
            <div>
              <p className="text-xs font-display font-medium uppercase tracking-[0.05em] text-muted-foreground mb-1">
                Expenses
              </p>
              <p className="text-lg font-display font-semibold tabular-nums text-fidra-negative">
                {formatCurrency(plannedSummary.totalExpenses)}
              </p>
            </div>

            {/* Horizon info */}
            <div className="text-[10px] text-muted-foreground">
              Next {HORIZON_DAYS} days
            </div>

            {/* Selection summary */}
            {selectedTemplateDetails && (
              <div className="border-t border-border-subtle pt-3">
                <p className="text-xs font-display font-medium uppercase tracking-[0.05em] text-muted-foreground mb-2">
                  Selection
                </p>
                <p className={cn(
                  'text-xl font-display font-bold tabular-nums',
                  selectedTemplateDetails.type === 'income' ? 'text-fidra-positive' : 'text-fidra-negative',
                )}>
                  {formatCurrency(selectedTemplateDetails.amount)}
                </p>
                <p className="text-xs text-foreground mt-2 truncate" title={selectedTemplateDetails.description}>
                  {selectedTemplateDetails.description}
                </p>
                {selectedTemplateDetails.party && (
                  <p className="text-xs text-muted-foreground mt-1 truncate" title={selectedTemplateDetails.party}>
                    {selectedTemplateDetails.party}
                  </p>
                )}
                {selectedTemplateDetails.nextDue && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Next: {formatDate(selectedTemplateDetails.nextDue)}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <AddPlannedDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        sheets={sheetNames}
        currentSheet={currentSheet}
        descriptionSuggestions={descriptionSuggestions}
        partySuggestions={partySuggestions}
        activitySuggestions={activitySuggestions}
        onSave={handleAdd}
      />
      <EditPlannedDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        template={editingTemplate}
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        sheets={sheetNames}
        descriptionSuggestions={descriptionSuggestions}
        partySuggestions={partySuggestions}
        activitySuggestions={activitySuggestions}
        affectsMultipleInstances={editingTemplate ? (() => {
          const entry = orderedExpanded.find(({ template }) => template.id === editingTemplate.id);
          return entry ? plannedGroupHasMultipleInstances(entry.template, entry.instances.length) : false;
        })() : false}
        onSave={handleEdit}
      />
      <BulkEditPlannedDialog
        open={showBulkEditDialog}
        onOpenChange={setShowBulkEditDialog}
        templates={selectedTemplates}
        multiInstanceGroupCount={multiInstanceSelectionCount}
        onSave={handleBulkEditSave}
      />
      <PlannedGroupWarningDialog
        open={groupWarning !== null}
        onOpenChange={(open) => { if (!open) setGroupWarning(null); }}
        action={groupWarning?.action ?? 'duplicate'}
        template={groupWarning?.template ?? null}
        instanceDate={groupWarning?.instanceDate ?? null}
        onConfirm={async () => {
          if (!groupWarning) return;
          if (groupWarning.action === 'duplicate') await handleDuplicate(groupWarning.template);
          else await handleDelete(groupWarning.template);
        }}
      />
      <EditTransactionDialog
        open={showConvertDialog}
        onOpenChange={(open) => {
          setShowConvertDialog(open);
          if (!open) convertingInstanceRef.current = null;
        }}
        transaction={convertingTransaction}
        isConversion
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        sheets={sheetNames}
        descriptionSuggestions={descriptionSuggestions}
        partySuggestions={partySuggestions}
        activitySuggestions={activitySuggestions}
        onSave={handleConvertSave}
      />
    </div>
  );
}
