import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import type { RowSelectionState } from '@tanstack/react-table';
import type { TransactionRow } from '../../shared/ipc-types';

import { useTransactionStore } from '@/stores/transaction-store';
import { useSheetStore } from '@/stores/sheet-store';
import { useCategoryStore } from '@/stores/category-store';
import { useUiStore } from '@/stores/ui-store';
import { useUndoStore } from '@/stores/undo-store';
import { usePlannedStore } from '@/stores/planned-store';
import { useAttachmentSignal } from '@/stores/attachment-signal';

import { useViewData } from '@/hooks/useViewData';
import { useViewZoom } from '@/hooks/useViewZoom';
import { useSheetFiltered } from '@/hooks/useSheetFiltered';
import { searchTransactions } from '@/services/search';
import { computeTotal, computeRunningBalances, computePendingTotal } from '@/services/balance';
import { expandTemplate, projectBalance, type PlannedInstance } from '@/services/forecast';
import {
  createAddTransactionCommand,
  createEditTransactionCommand,
  createDeleteTransactionCommand,
  createBulkDeleteCommand,
  createBulkEditCommand,
  createConvertPlannedCommand,
  createAddSheetCommand,
  createRenameSheetCommand,
  createReorderSheetsCommand,
  createMergeSheetCommand,
  createDeleteSheetWithDataCommand,
  createSetCategoriesCommand,
  createCsvImportCommand,
} from '@/services/undo';
import type { PlannedTemplateRow } from '../../shared/ipc-types';
import { defaultStatusForType } from '../../shared/transaction-rules';
import { getUniqueValues } from '@/lib/autocomplete';
import { cn } from '@/lib/utils';

import { useNavigate } from 'react-router-dom';
import { TransactionTable, type TransactionTableHandle } from '@/components/TransactionTable';
import { AddTransactionForm } from '@/components/AddTransactionForm';
import { SearchBar } from '@/components/SearchBar';
import { BalanceDisplay } from '@/components/BalanceDisplay';
import { EditTransactionDialog } from '@/dialogs/EditTransactionDialog';
import { BulkEditDialog } from '@/dialogs/BulkEditDialog';
import { ManageSheetsDialog } from '@/dialogs/ManageSheetsDialog';
import { ManageCategoriesDialog } from '@/dialogs/ManageCategoriesDialog';
import { CsvImportDialog } from '@/dialogs/CsvImportDialog';

import { AttachmentPanel } from '@/components/AttachmentPanel';

import { UndoRedoButtons } from '@/components/UndoRedoButtons';
import { Button } from '@/components/ui/button';
import { Layers, Tags, PanelLeftClose, PanelLeft, RotateCcw, CalendarDays, Import } from 'lucide-react';
import { ZoomControls } from '@/components/ZoomControls';
import { useUndoRedoShortcuts } from '@/hooks/useUndoRedoShortcuts';


export default function TransactionsView() {
  const navigate = useNavigate();
  // Stores
  const { transactions, loading, loadAll } = useTransactionStore();
  const { sheets, currentSheet, loadAll: loadSheets } = useSheetStore();
  const {
    incomeCategories,
    expenseCategories,
    loadAll: loadCategories,
  } = useCategoryStore();
  const { searchQuery, filteredBalanceMode, setSearchQuery, toggleFilteredBalance, showAddForm, toggleAddForm, addFormWidth, setAddFormWidth, showPlanned, horizonDays, toggleShowPlanned, setHorizonDays } = useUiStore();
  const { execute } = useUndoStore();
  useUndoRedoShortcuts();
  const { zoom: tableZoom, zoomIn: zoomTableIn, zoomOut: zoomTableOut, resetZoom: resetTableZoom } = useViewZoom('tableZoom');
  const { templates, loadAll: loadPlanned } = usePlannedStore();

  // Local state
  const [editingTransaction, setEditingTransaction] = useState<TransactionRow | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  // When converting a planned instance, track the source so we can mark fulfilled on save
  const convertingInstanceRef = useRef<PlannedInstance | null>(null);
  const [showBulkEditDialog, setShowBulkEditDialog] = useState(false);
  const [showSheetsDialog, setShowSheetsDialog] = useState(false);
  const [showCategoriesDialog, setShowCategoriesDialog] = useState(false);
  const [showCsvImportDialog, setShowCsvImportDialog] = useState(false);
  const [selectedIds, setSelectedIds] = useState<RowSelectionState>({});
  const [attachmentCounts, setAttachmentCounts] = useState<Record<string, number>>({});
  const attachmentRevision = useAttachmentSignal((s) => s.revision);
  const [attachmentPanelTxId, setAttachmentPanelTxId] = useState<string | null>(null);

  // Focus is managed imperatively via the table handle (no React state)
  const tableRef = useRef<TransactionTableHandle>(null);
  const focusedRowIdRef = useRef<string | null>(null);
  // Anchor row for shift+arrow range selection (by ID)
  const selectionAnchorRef = useRef<string | null>(null);
  // RAF handle for batching React selection state updates during key-hold
  const selectionRafRef = useRef<number>(0);
  // Display-ordered row IDs from TransactionTable (follows sort + planned pinning)
  const displayedRowIdsRef = useRef<string[]>([]);
  // Form resize drag state
  const [isResizingForm, setIsResizingForm] = useState(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingForm(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = addFormWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - resizeStartX.current;
      setAddFormWidth(resizeStartWidth.current + delta);
    };

    const handleMouseUp = () => {
      setIsResizingForm(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [addFormWidth, setAddFormWidth]);

  // Load data on mount and when sheet changes
  useViewData([loadSheets, loadCategories, loadPlanned], loadAll, currentSheet);

  // Load attachment counts when the set of transaction IDs changes
  const transactionIdKey = useMemo(() => {
    const ids = transactions.map((t) => t.id);
    ids.sort();
    return ids.join(',');
  }, [transactions]);

  useEffect(() => {
    if (!transactionIdKey) {
      setAttachmentCounts({});
      return;
    }
    const ids = transactionIdKey.split(',');
    window.api.getAttachmentCounts(ids).then(setAttachmentCounts);
  }, [transactionIdKey, attachmentRevision]);

  // Reload attachment counts for a single transaction (e.g. after edit dialog closes)
  const reloadAttachmentCounts = useCallback(async () => {
    if (!transactionIdKey) return;
    const ids = transactionIdKey.split(',');
    const counts = await window.api.getAttachmentCounts(ids);
    setAttachmentCounts(counts);
  }, [transactionIdKey]);

  const handleAttachmentCountChange = useCallback((txId: string, count: number) => {
    setAttachmentCounts((prev) => {
      if (count === 0) {
        const next = { ...prev };
        delete next[txId];
        return next;
      }
      return { ...prev, [txId]: count };
    });
  }, []);

  // Reload attachment counts when the edit dialog closes (attachments may have changed)
  useEffect(() => {
    if (!showEditDialog) {
      reloadAttachmentCounts();
    }
  }, [showEditDialog, reloadAttachmentCounts]);

  // When the attachment panel is open, follow the selected row
  useEffect(() => {
    if (!attachmentPanelTxId) return;
    const ids = Object.keys(selectedIds).filter((id) => selectedIds[id]);
    if (ids.length === 1 && ids[0] !== attachmentPanelTxId) {
      // Only follow if the selected row is a real transaction (not planned)
      const tx = transactions.find((t) => t.id === ids[0]);
      if (tx && tx.status !== 'planned') {
        setAttachmentPanelTxId(ids[0]);
      }
    }
  }, [selectedIds, attachmentPanelTxId, transactions]);

  // Filter pipeline
  const getSheet = useCallback((t: TransactionRow) => t.sheet, []);
  const sheetFiltered = useSheetFiltered(transactions, currentSheet, getSheet);

  // Always expand planned templates so DOM is stable for height transitions
  // Also build a lookup map from planned transaction ID → PlannedInstance for conversion
  const plannedInstanceMapRef = useRef<Map<string, PlannedInstance>>(new Map());
  const mergedTransactions = useMemo(() => {
    const today = new Date();
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + horizonDays);
    const horizonDate = `${horizon.getFullYear()}-${String(horizon.getMonth() + 1).padStart(2, '0')}-${String(horizon.getDate()).padStart(2, '0')}`;

    const filteredTemplates = currentSheet === 'All Sheets'
      ? templates
      : templates.filter((t) => t.target_sheet === currentSheet);

    const plannedInstances = filteredTemplates.flatMap((t) => expandTemplate(t, horizonDate));

    const instanceMap = new Map<string, PlannedInstance>();
    for (const inst of plannedInstances) {
      instanceMap.set(inst.transaction.id, inst);
    }
    plannedInstanceMapRef.current = instanceMap;

    const plannedTransactions = plannedInstances.map((inst) => inst.transaction);
    const sortedPlanned = plannedTransactions.sort((a, b) => a.date.localeCompare(b.date));
    return [...sortedPlanned, ...sheetFiltered];
  }, [sheetFiltered, horizonDays, templates, currentSheet]);

  const searchFiltered = useMemo(() => {
    return searchTransactions(mergedTransactions, searchQuery);
  }, [mergedTransactions, searchQuery]);

  // Balances
  const balanceSource = filteredBalanceMode ? searchFiltered : sheetFiltered;
  const balance = useMemo(() => computeTotal(balanceSource), [balanceSource]);
  const pending = useMemo(() => computePendingTotal(balanceSource), [balanceSource]);
  const runningBalances = useMemo(() => computeRunningBalances(sheetFiltered), [sheetFiltered]);

  // Projected balance (current balance + planned instances up to horizon)
  const projectedBalance = useMemo(() => {
    if (!showPlanned) return null;

    // Start from balance minus pending expenses
    const base = balance - pending;

    if (filteredBalanceMode && searchQuery) {
      // When filtered balance is on, sum planned transactions visible in searchFiltered
      let projected = base;
      for (const t of searchFiltered) {
        if (t.status === 'planned') {
          const amount = parseFloat(t.amount) || 0;
          projected += t.type === 'income' ? amount : -amount;
        }
      }
      return projected;
    }

    const today = new Date();
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + horizonDays);
    const horizonDate = `${horizon.getFullYear()}-${String(horizon.getMonth() + 1).padStart(2, '0')}-${String(horizon.getDate()).padStart(2, '0')}`;

    const filteredTemplates = currentSheet === 'All Sheets'
      ? templates
      : templates.filter((t) => t.target_sheet === currentSheet);

    const instances = filteredTemplates.flatMap((t) => expandTemplate(t, horizonDate));
    return projectBalance(base, instances, horizonDate);
  }, [showPlanned, horizonDays, templates, currentSheet, balance, pending, filteredBalanceMode, searchQuery, searchFiltered]);

  // Selected transactions for summary & bulk operations
  const selectedTransactions = useMemo(() => {
    const ids = Object.keys(selectedIds).filter((id) => selectedIds[id]);
    if (ids.length === 0) return [];
    return searchFiltered.filter((t) => ids.includes(t.id));
  }, [selectedIds, searchFiltered]);

  // Autocomplete data
  const descriptionSuggestions = useMemo(() => getUniqueValues(transactions, 'description'), [transactions]);
  const partySuggestions = useMemo(() => getUniqueValues(transactions, 'party'), [transactions]);
  const activitySuggestions = useMemo(() => getUniqueValues(transactions, 'activity'), [transactions]);

  const sheetNames = useMemo(() => sheets.map((s) => s.name), [sheets]);
  const showSheetColumn = currentSheet === 'All Sheets' && sheets.length >= 2;

  // Handlers
  const handleAddTransaction = useCallback(
    async (transaction: TransactionRow, pendingFiles?: { path: string; name: string }[]) => {
      await execute(createAddTransactionCommand(transaction));
      if (pendingFiles && pendingFiles.length > 0) {
        for (const file of pendingFiles) {
          await window.api.addAttachment(transaction.id, file.path, file.name);
        }
      }
    },
    [execute],
  );

  const handleEditTransaction = useCallback(
    async (_original: TransactionRow, updated: TransactionRow) => {
      const instance = convertingInstanceRef.current;
      if (instance) {
        // Converting a planned instance: add as new transaction + mark fulfilled
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
          await execute(createConvertPlannedCommand(template, updatedTemplate, updated));
        } else {
          // Template not found — just add the transaction
          await execute(createAddTransactionCommand(updated));
        }
      } else {
        // Skip no-op edits (e.g. user only added/removed attachments without
        // changing any transaction fields). Without this guard, the undo stack
        // would contain a meaningless edit command that the user has to Cmd+Z
        // through before reaching the attachment command.
        const fieldsChanged =
          _original.type !== updated.type ||
          _original.amount !== updated.amount ||
          _original.date !== updated.date ||
          _original.description !== updated.description ||
          _original.category !== updated.category ||
          _original.party !== updated.party ||
          _original.reference !== updated.reference ||
          _original.activity !== updated.activity ||
          _original.notes !== updated.notes ||
          _original.sheet !== updated.sheet ||
          _original.status !== updated.status;
        if (fieldsChanged) {
          await execute(createEditTransactionCommand(_original, updated));
        }
      }
    },
    [execute, templates],
  );

  const handleDeleteTransactions = useCallback(
    async (toDelete: TransactionRow[]) => {
      if (toDelete.length === 1) {
        await execute(createDeleteTransactionCommand(toDelete[0]));
      } else {
        await execute(createBulkDeleteCommand(toDelete));
      }
      setSelectedIds({});
    },
    [execute],
  );

  const handleDuplicate = useCallback(
    (transaction: TransactionRow) => {
      const now = new Date().toISOString();
      const duplicate: TransactionRow = {
        ...transaction,
        id: crypto.randomUUID(),
        version: 1,
        created_at: now,
        modified_at: null,
        modified_by: null,
      };
      execute(createAddTransactionCommand(duplicate));
    },
    [execute],
  );

  const handleApprove = useCallback(
    async (toApprove: TransactionRow[]) => {
      const txSettings = await window.api.getTransactionSettings();
      const now = new Date().toISOString();
      const updated = toApprove.map((t) => ({
        ...t,
        status: 'approved' as const,
        version: t.version + 1,
        modified_at: now,
        modified_by: 'local',
        ...(txSettings.dateOnApprove ? { date: now.slice(0, 10) } : {}),
      }));
      await execute(createBulkEditCommand(toApprove, updated));
    },
    [execute],
  );

  const handleReject = useCallback(
    async (toReject: TransactionRow[]) => {
      const updated = toReject.map((t) => ({
        ...t,
        status: 'rejected' as const,
        version: t.version + 1,
        modified_at: new Date().toISOString(),
        modified_by: 'local',
      }));
      await execute(createBulkEditCommand(toReject, updated));
    },
    [execute],
  );

  const handleEdit = useCallback((transaction: TransactionRow) => {
    if (transaction.status === 'planned') {
      // Convert planned instance to a new real transaction
      const instance = plannedInstanceMapRef.current.get(transaction.id);
      if (!instance) return;
      convertingInstanceRef.current = instance;
      const now = new Date().toISOString();
      const newTx: TransactionRow = {
        ...transaction,
        id: crypto.randomUUID(),
        status: defaultStatusForType(transaction.type),
        version: 1,
        created_at: now,
        modified_at: null,
        modified_by: null,
      };
      setEditingTransaction(newTx);
      setShowEditDialog(true);
    } else {
      convertingInstanceRef.current = null;
      setEditingTransaction(transaction);
      setShowEditDialog(true);
    }
  }, []);

  const handleBulkEdit = useCallback((txns: TransactionRow[]) => {
    if (txns.length < 2) return;
    setShowBulkEditDialog(true);
  }, []);

  const handleBulkEditSave = useCallback(
    async (originals: TransactionRow[], updated: TransactionRow[]) => {
      await execute(createBulkEditCommand(originals, updated));
      setShowBulkEditDialog(false);
    },
    [execute],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      const tag = (document.activeElement?.tagName ?? '').toUpperCase();
      const isInputFocused = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      // Cmd+A: select all visible rows
      if (isMod && e.key === 'a' && !isInputFocused) {
        e.preventDefault();
        const allIds: RowSelectionState = {};
        for (const t of searchFiltered) {
          allIds[t.id] = true;
        }
        setSelectedIds(allIds);
        return;
      }

      // Everything below is guarded by "not in input/form"
      if (isInputFocused) return;
      // Also guard against focus inside a form (e.g. Select triggers are <button> not <input>)
      // Include Radix portalled content (Select/Combobox dropdowns render outside the form DOM)
      if (document.activeElement?.closest('form, [role="dialog"], [role="listbox"], [data-radix-popper-content-wrapper]')) return;

      // ArrowDown / ArrowUp: navigate rows in display order
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const allIds = displayedRowIdsRef.current;
        if (allIds.length === 0) return;

        // Build a lookup set of planned IDs for skipping when hidden
        const plannedIdSet = showPlanned ? null : new Set(
          searchFiltered.filter((t) => t.status === 'planned').map((t) => t.id),
        );

        const previousId = focusedRowIdRef.current;
        const currentIdx = previousId ? allIds.indexOf(previousId) : -1;

        // Cmd+Shift+Arrow: select from current row to top/bottom
        if (isMod && e.shiftKey) {
          if (currentIdx < 0) return;
          if (selectionAnchorRef.current === null) {
            selectionAnchorRef.current = previousId ?? allIds[currentIdx];
          }
          const anchorIdx = allIds.indexOf(selectionAnchorRef.current);
          const targetIdx = e.key === 'ArrowDown' ? allIds.length - 1 : 0;
          // Move focus to the target end
          let focusIdx = targetIdx;
          // Skip planned rows at the edge if hidden
          if (plannedIdSet) {
            const step = e.key === 'ArrowDown' ? -1 : 1;
            while (focusIdx >= 0 && focusIdx < allIds.length && plannedIdSet.has(allIds[focusIdx])) {
              focusIdx += step;
            }
            if (focusIdx < 0 || focusIdx >= allIds.length) focusIdx = currentIdx;
          }
          const nextId = allIds[focusIdx];
          focusedRowIdRef.current = nextId;
          tableRef.current?.setFocusedRow(nextId);

          const start = Math.min(anchorIdx, focusIdx);
          const end = Math.max(anchorIdx, focusIdx);
          const rangeIds: string[] = [];
          for (let i = start; i <= end; i++) {
            if (!plannedIdSet?.has(allIds[i])) {
              rangeIds.push(allIds[i]);
            }
          }
          // Instant DOM highlight, batch React state via RAF
          tableRef.current?.setSelectedRows(rangeIds);
          cancelAnimationFrame(selectionRafRef.current);
          selectionRafRef.current = requestAnimationFrame(() => {
            const sel: RowSelectionState = {};
            for (const id of rangeIds) sel[id] = true;
            setSelectedIds(sel);
          });
          return;
        }

        // Cmd/Ctrl+Arrow (without Shift): no table navigation, let OS handle
        if (isMod) return;

        // Single step navigation
        let nextIdx: number;
        if (currentIdx < 0) {
          nextIdx = plannedIdSet
            ? allIds.findIndex((id) => !plannedIdSet.has(id))
            : 0;
          if (nextIdx < 0) return;
        } else {
          const step = e.key === 'ArrowDown' ? 1 : -1;
          nextIdx = currentIdx;
          do {
            nextIdx += step;
          } while (
            nextIdx >= 0 && nextIdx < allIds.length &&
            plannedIdSet?.has(allIds[nextIdx])
          );
          if (nextIdx < 0 || nextIdx >= allIds.length) nextIdx = currentIdx;
        }

        const nextId = allIds[nextIdx];

        // Imperative focus ring — instant, no React re-render
        focusedRowIdRef.current = nextId;
        tableRef.current?.setFocusedRow(nextId);

        // Compute new selection
        let selectedRowIds: string[];
        if (e.shiftKey) {
          if (selectionAnchorRef.current === null) {
            selectionAnchorRef.current = previousId ?? nextId;
          }
          const anchorIdx = allIds.indexOf(selectionAnchorRef.current);
          const start = Math.min(anchorIdx, nextIdx);
          const end = Math.max(anchorIdx, nextIdx);
          selectedRowIds = [];
          for (let i = start; i <= end; i++) {
            if (!plannedIdSet?.has(allIds[i])) {
              selectedRowIds.push(allIds[i]);
            }
          }
        } else {
          selectionAnchorRef.current = null;
          selectedRowIds = !plannedIdSet?.has(nextId) ? [nextId] : [];
        }

        // Instant DOM highlight, batch React state via RAF
        tableRef.current?.setSelectedRows(selectedRowIds);
        cancelAnimationFrame(selectionRafRef.current);
        selectionRafRef.current = requestAnimationFrame(() => {
          const sel: RowSelectionState = {};
          for (const id of selectedRowIds) sel[id] = true;
          setSelectedIds(sel);
        });
        return;
      }

      // Enter: edit focused row (skip planned — use double-click or context menu to convert)
      if (e.key === 'Enter' && focusedRowIdRef.current !== null) {
        e.preventDefault(); // Prevent keyup from activating the first button in the dialog
        const t = searchFiltered.find((tx) => tx.id === focusedRowIdRef.current);
        if (t && t.status !== 'planned') handleEdit(t);
        return;
      }

      // Escape: close attachment panel, then clear selection
      if (e.key === 'Escape') {
        if (attachmentPanelTxId) {
          setAttachmentPanelTxId(null);
        } else {
          setSelectedIds({});
          focusedRowIdRef.current = null;
          tableRef.current?.setFocusedRow(null);
        }
        return;
      }

      // Delete: delete selected
      if (e.key === 'Delete') {
        const selected = Object.keys(selectedIds).filter((id) => selectedIds[id]);
        if (selected.length > 0) {
          const toDelete = transactions.filter((t) => selected.includes(t.id));
          if (toDelete.length > 0) handleDeleteTransactions(toDelete);
        }
        return;
      }

      // A: approve selected expenses
      if (e.key === 'a' || e.key === 'A') {
        if (selectedTransactions.length > 0) {
          const pendingExpenses = selectedTransactions.filter(
            (t) => t.type === 'expense' && t.status === 'pending',
          );
          if (pendingExpenses.length > 0) handleApprove(pendingExpenses);
        }
        return;
      }

      // R: reject selected expenses
      if (e.key === 'r' || e.key === 'R') {
        if (selectedTransactions.length > 0) {
          const pendingExpenses = selectedTransactions.filter(
            (t) => t.type === 'expense' && t.status === 'pending',
          );
          if (pendingExpenses.length > 0) handleReject(pendingExpenses);
        }
        return;
      }

      // E: edit (single, skip planned) or bulk edit (multiple real)
      if (e.key === 'e' || e.key === 'E') {
        if (selectedTransactions.length === 1 && selectedTransactions[0].status !== 'planned') {
          handleEdit(selectedTransactions[0]);
        } else if (selectedTransactions.length > 1) {
          const realTxns = selectedTransactions.filter((t) => t.status !== 'planned');
          if (realTxns.length > 1) handleBulkEdit(realTxns);
        }
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    selectedIds, transactions, searchFiltered,
    handleDeleteTransactions, handleApprove, handleReject, handleEdit, handleBulkEdit,
    selectedTransactions, attachmentPanelTxId, showPlanned,
  ]);

  // Sheet management handlers
  const handleAddSheet = useCallback(
    async (id: string, name: string) => {
      await execute(createAddSheetCommand({ id, name }));
    },
    [execute],
  );

  const handleRenameSheet = useCallback(
    async (oldName: string, newName: string) => {
      await execute(createRenameSheetCommand(oldName, newName));
    },
    [execute],
  );

  const handleDeleteSheet = useCallback(
    async (id: string, name: string, mergeTarget?: string) => {
      if (mergeTarget) {
        // Snapshot affected data before merge
        const affectedTxs = await window.api.getTransactionsOnSheet(name);
        const affectedPlanned = await window.api.getPlannedOnSheet(name);
        const sheet = sheets.find((s) => s.id === id);
        if (!sheet) return;
        await execute(createMergeSheetCommand(sheet, mergeTarget, affectedTxs, affectedPlanned));
      } else {
        // Snapshot all data before delete
        const deletedTxs = await window.api.getTransactionsOnSheet(name);
        const deletedPlanned = await window.api.getPlannedOnSheet(name);
        const deletedAttachments = await window.api.getAttachmentsOnSheet(name);
        const sheet = sheets.find((s) => s.id === id);
        if (!sheet) return;
        await execute(createDeleteSheetWithDataCommand(sheet, deletedTxs, deletedPlanned, deletedAttachments));
      }
    },
    [execute, sheets],
  );

  const handleReorderSheets = useCallback(
    async (orderedIds: string[]) => {
      const oldOrder = sheets.map((s) => s.id);
      await execute(createReorderSheetsCommand(oldOrder, orderedIds));
    },
    [execute, sheets],
  );

  const handleSaveCategories = useCallback(
    async (type: 'income' | 'expense', names: string[]) => {
      const oldNames = type === 'income' ? incomeCategories : expenseCategories;
      await execute(createSetCategoriesCommand(type, [...oldNames], names));
    },
    [execute, incomeCategories, expenseCategories],
  );

  // CSV import handler
  const handleCsvImported = useCallback(
    async (importedTransactions: TransactionRow[]) => {
      if (importedTransactions.length > 0) {
        await execute(createCsvImportCommand(importedTransactions));
      }
    },
    [execute],
  );

  // Menu: Import CSV
  useEffect(() => {
    return window.api.onMenuImportCsv(() => setShowCsvImportDialog(true));
  }, []);

  return (
    <div className="flex flex-col h-full bg-surface-base">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border-subtle bg-surface-raised">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-display font-semibold text-foreground">Transactions</h1>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleAddForm}
            title={showAddForm ? 'Hide form' : 'Show form'}
          >
            {showAddForm ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowCsvImportDialog(true)} title="Import CSV">
            <Import className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowSheetsDialog(true)} title="Manage Sheets">
            <Layers className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowCategoriesDialog(true)} title="Manage Categories">
            <Tags className="h-4 w-4" />
          </Button>
          <UndoRedoButtons />
          <ZoomControls
            zoom={tableZoom}
            onZoomIn={zoomTableIn}
            onZoomOut={zoomTableOut}
            onReset={resetTableZoom}
          />
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden px-5 pt-4 pb-5 gap-3">
        {/* Search bar — full width */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <SearchBar
              query={searchQuery}
              onSearch={setSearchQuery}
              totalCount={mergedTransactions.length}
              filteredCount={searchFiltered.length}
              filteredBalanceMode={filteredBalanceMode}
              onToggleFilteredBalance={toggleFilteredBalance}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleShowPlanned}
              title={showPlanned ? 'Hide planned transactions' : 'Show planned transactions'}
              className={cn('h-8', showPlanned && 'bg-fidra-teal/15 text-fidra-teal')}
            >
              <CalendarDays className="h-4 w-4" />
            </Button>
            <div
              className={cn(
                'flex items-center gap-1.5 overflow-hidden transition-all duration-200 ease-in-out',
                showPlanned ? 'max-w-[140px] opacity-100' : 'max-w-0 opacity-0',
              )}
            >
              <span className="text-[11px] font-mono text-muted-foreground whitespace-nowrap">{horizonDays}d</span>
              <input
                type="range"
                min={7}
                max={365}
                value={horizonDays}
                onChange={(e) => setHorizonDays(Number(e.target.value))}
                className="w-[80px] h-1 accent-fidra-teal cursor-pointer"
                title={`Horizon: ${horizonDays} days`}
              />
            </div>
          </div>
        </div>

        {/* Card row: form + table + balance */}
        <div className="flex-1 flex gap-3 overflow-hidden min-h-0">
          {/* Left card: Add form (resizable) */}
          <div
            className={cn(
              'shrink-0 overflow-hidden will-change-[width]',
              !isResizingForm && 'transition-[width] duration-150 ease-out',
            )}
            style={{ width: showAddForm ? addFormWidth : 0 }}
          >
            <div
              className={cn(
                'h-full overflow-y-auto rounded-xl border border-border-subtle bg-surface-raised relative p-4',
                !isResizingForm && 'transition-opacity duration-100 ease-out',
                showAddForm ? 'opacity-100' : 'opacity-0',
              )}
              onFocusCapture={() => {
                focusedRowIdRef.current = null;
                tableRef.current?.setFocusedRow(null);
              }}
            >
              <div style={{ width: addFormWidth - 32 }}>
                <AddTransactionForm
                  incomeCategories={incomeCategories}
                  expenseCategories={expenseCategories}
                  sheets={sheetNames}
                  currentSheet={currentSheet}
                  descriptionSuggestions={descriptionSuggestions}
                  partySuggestions={partySuggestions}
                  activitySuggestions={activitySuggestions}
                  onSubmit={handleAddTransaction}
                />
              </div>
              {/* Resize handle — right edge of widget */}
              <div
                className="absolute top-2 bottom-2 right-0 w-1.5 cursor-col-resize rounded-full hover:bg-fidra-teal/30 active:bg-fidra-teal/50 transition-colors"
                onMouseDown={handleResizeStart}
              />
            </div>
          </div>

          {/* Center card: Table */}
          {loading ? (
            <div className="flex-1 flex items-center justify-center rounded-xl border border-border-subtle">
              <p className="font-display text-sm text-muted-foreground">Loading transactions...</p>
            </div>
          ) : (
            <TransactionTable
              ref={tableRef}
              transactions={searchFiltered}
              runningBalances={runningBalances}
              showSheetColumn={showSheetColumn}
              showPlanned={showPlanned}
              onEdit={handleEdit}
              onDelete={handleDeleteTransactions}
              onDuplicate={handleDuplicate}
              onApprove={handleApprove}
              onReject={handleReject}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onBulkEdit={handleBulkEdit}
              attachmentCounts={attachmentCounts}
              onAttachmentClick={(txId) => {
                setAttachmentPanelTxId(txId);
                setSelectedIds({ [txId]: true });
                focusedRowIdRef.current = txId;
                tableRef.current?.setFocusedRow(txId);
                tableRef.current?.setSelectedRows([txId]);
              }}
              onFocusedRowChange={(id) => { focusedRowIdRef.current = id; selectionAnchorRef.current = null; }}
              onDisplayedRowIdsChange={(ids) => { displayedRowIdsRef.current = ids; }}
              onViewActivity={(activity) => navigate('/activities', { state: { selectActivity: activity } })}
              zoom={tableZoom}
            />
          )}

          {/* Attachment panel (slide-in) */}
          {attachmentPanelTxId && (
            <AttachmentPanel
              transactionId={attachmentPanelTxId}
              transactionDescription={
                transactions.find((t) => t.id === attachmentPanelTxId)?.description ?? ''
              }
              transactionDate={
                transactions.find((t) => t.id === attachmentPanelTxId)?.date ?? ''
              }
              onClose={() => setAttachmentPanelTxId(null)}
              onCountChange={handleAttachmentCountChange}
            />
          )}

          {/* Right card: Balance */}
          <div className="w-[240px] shrink-0 overflow-y-auto rounded-xl border border-border-subtle bg-surface-raised p-4">
            <BalanceDisplay
              balance={balance}
              pending={pending}
              projected={projectedBalance}
              selectedTransactions={selectedTransactions}
            />
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <EditTransactionDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        transaction={editingTransaction}
        isConversion={convertingInstanceRef.current !== null}
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        sheets={sheetNames}
        descriptionSuggestions={descriptionSuggestions}
        partySuggestions={partySuggestions}
        activitySuggestions={activitySuggestions}
        onSave={handleEditTransaction}
      />

      <BulkEditDialog
        open={showBulkEditDialog}
        onOpenChange={setShowBulkEditDialog}
        transactions={selectedTransactions}
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        sheets={sheetNames}
        descriptionSuggestions={descriptionSuggestions}
        partySuggestions={partySuggestions}
        activitySuggestions={activitySuggestions}
        onSave={handleBulkEditSave}
      />

      <ManageSheetsDialog
        open={showSheetsDialog}
        onOpenChange={setShowSheetsDialog}
        sheets={sheets}
        onAdd={handleAddSheet}
        onRename={handleRenameSheet}
        onDelete={handleDeleteSheet}
        onReorder={handleReorderSheets}
      />

      <ManageCategoriesDialog
        open={showCategoriesDialog}
        onOpenChange={setShowCategoriesDialog}
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        onSave={handleSaveCategories}
      />

      <CsvImportDialog
        open={showCsvImportDialog}
        onOpenChange={setShowCsvImportDialog}
        sheets={sheets.filter((s) => !s.is_virtual && !s.is_planned).map((s) => s.name)}
        currentSheet={currentSheet === 'All Sheets' ? (sheets.find((s) => !s.is_virtual && !s.is_planned)?.name ?? '') : currentSheet}
        categories={{ income: incomeCategories, expense: expenseCategories }}
        descriptionSuggestions={descriptionSuggestions}
        partySuggestions={partySuggestions}
        onImported={handleCsvImported}
      />
    </div>
  );
}
