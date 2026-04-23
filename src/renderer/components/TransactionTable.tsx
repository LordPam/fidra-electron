import React, { useMemo, useState, useRef, useCallback, useEffect, useReducer, useImperativeHandle, forwardRef } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
  type OnChangeFn,
} from '@tanstack/react-table';
import type { TransactionRow } from '../../shared/ipc-types';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { ArrowUpDown, ArrowUp, ArrowDown, Paperclip, Check, X } from 'lucide-react';

export interface TransactionTableHandle {
  setFocusedRow: (id: string | null) => void;
  setSelectedRows: (ids: string[]) => void;
}

interface TransactionTableProps {
  transactions: TransactionRow[];
  runningBalances: Map<string, number>;
  showSheetColumn: boolean;
  showPlanned?: boolean;
  onEdit: (transaction: TransactionRow) => void;
  onDelete: (transactions: TransactionRow[]) => void;
  onDuplicate: (transaction: TransactionRow) => void;
  onApprove: (transactions: TransactionRow[]) => void;
  onReject: (transactions: TransactionRow[]) => void;
  selectedIds: RowSelectionState;
  onSelectionChange: OnChangeFn<RowSelectionState>;
  onBulkEdit?: (transactions: TransactionRow[]) => void;
  attachmentCounts?: Record<string, number>;
  onAttachmentClick?: (transactionId: string) => void;
  onFocusedRowChange?: (id: string) => void;
  /** Called whenever the displayed row order changes (after sort + planned pinning) */
  onDisplayedRowIdsChange?: (ids: string[]) => void;
  zoom?: number;
}

function StatusBadge({ status }: { status: string }) {
  const base = 'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium font-body';
  switch (status) {
    case '--':
      return <span className={cn(base, 'border border-border-subtle text-fidra-slate')}>Auto</span>;
    case 'pending':
      return <span className={cn(base, 'bg-fidra-warning/15 text-fidra-warning')}>Pending</span>;
    case 'approved':
      return <span className={cn(base, 'bg-fidra-positive/15 text-fidra-positive')}>Approved</span>;
    case 'rejected':
      return <span className={cn(base, 'bg-fidra-negative/15 text-fidra-negative')}>Rejected</span>;
    case 'planned':
      return <span className={cn(base, 'bg-fidra-teal/15 text-fidra-teal')}>Planned</span>;
    default:
      return <span className={cn(base, 'border border-border-subtle text-fidra-slate')}>{status}</span>;
  }
}

function SortIcon({ isSorted }: { isSorted: false | 'asc' | 'desc' }) {
  if (isSorted === 'asc') return <ArrowUp className="ml-1 h-3 w-3 inline" />;
  if (isSorted === 'desc') return <ArrowDown className="ml-1 h-3 w-3 inline" />;
  return <ArrowUpDown className="ml-1 h-3 w-3 inline opacity-20" />;
}

export const TransactionTable = forwardRef<TransactionTableHandle, TransactionTableProps>(
  function TransactionTable(
    {
      transactions,
      runningBalances,
      showSheetColumn,
      showPlanned = false,
      onEdit,
      onDelete,
      onDuplicate,
      onApprove,
      onReject,
      selectedIds,
      onSelectionChange,
      onBulkEdit,
      attachmentCounts,
      onAttachmentClick,
      onFocusedRowChange,
      onDisplayedRowIdsChange,
      zoom = 1,
    },
    ref,
  ) {
    const [sorting, setSorting] = useState<SortingState>([{ id: 'date', desc: true }]);
    const lastClickedIndex = useRef<number | null>(null);
    const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
    const tableElRef = useRef<HTMLTableElement>(null);

    // --- Imperative focus ring (DOM-based, no React re-render) ---
    const focusedIdRef = useRef<string | null>(null);
    const fadedIdRef = useRef<string | null>(null);

    const applyFocusRing = useCallback((id: string | null) => {
      // Clear any faded row
      if (fadedIdRef.current) {
        const fadedEl = rowRefs.current.get(fadedIdRef.current);
        if (fadedEl) fadedEl.removeAttribute('data-row-focused-faded');
        fadedIdRef.current = null;
      }
      // Remove from previous row
      if (focusedIdRef.current) {
        const prevEl = rowRefs.current.get(focusedIdRef.current);
        if (prevEl) {
          prevEl.removeAttribute('data-row-focused');
          if (id === null) {
            // Fade instead of fully removing when clearing focus
            prevEl.setAttribute('data-row-focused-faded', '');
            fadedIdRef.current = focusedIdRef.current;
          }
        }
      }
      focusedIdRef.current = id;
      // Add to new row
      if (id) {
        tableElRef.current?.removeAttribute('data-table-unfocused');
        const nextEl = rowRefs.current.get(id);
        if (nextEl) {
          nextEl.setAttribute('data-row-focused', '');
          nextEl.scrollIntoView({ block: 'nearest' });
        }
      } else {
        tableElRef.current?.setAttribute('data-table-unfocused', '');
      }
    }, []);

    // --- Imperative selection highlight (DOM-based, no React re-render) ---
    const imperativeSelectedRef = useRef<Set<string>>(new Set());

    const applySelectedRows = useCallback((ids: string[]) => {
      // Clear ALL data-row-selected in the table (catches React-set attributes too)
      const table = tableElRef.current;
      if (table) {
        const selected = table.querySelectorAll('tr[data-row-selected]');
        for (const el of selected) el.removeAttribute('data-row-selected');
      }
      // Apply to new selection
      const newSet = new Set(ids);
      for (const id of newSet) {
        const el = rowRefs.current.get(id);
        if (el) el.setAttribute('data-row-selected', '');
      }
      imperativeSelectedRef.current = newSet;
    }, []);

    useImperativeHandle(ref, () => ({
      setFocusedRow: applyFocusRing,
      setSelectedRows: applySelectedRows,
    }), [applyFocusRing, applySelectedRows]);

    // Use refs for attachment data so column defs stay stable
    const attachmentCountsRef = useRef(attachmentCounts);
    attachmentCountsRef.current = attachmentCounts;
    const onAttachmentClickRef = useRef(onAttachmentClick);
    onAttachmentClickRef.current = onAttachmentClick;
    // Trigger re-render of cells when counts change without rebuilding columns
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
    const prevCountsRef = useRef(attachmentCounts);
    useEffect(() => {
      if (prevCountsRef.current !== attachmentCounts) {
        prevCountsRef.current = attachmentCounts;
        forceUpdate();
      }
    }, [attachmentCounts]);

    // --- Approve & reject stamp animations ---
    const prevStatusMapRef = useRef<Map<string, string>>(new Map());
    const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());
    const [rejectingIds, setRejectingIds] = useState<Set<string>>(new Set());

    useEffect(() => {
      const prev = prevStatusMapRef.current;
      const newlyApproved: string[] = [];
      const newlyRejected: string[] = [];

      for (const txn of transactions) {
        const prevStatus = prev.get(txn.id);
        if (prevStatus === 'pending' && txn.status === 'approved') {
          newlyApproved.push(txn.id);
        } else if (prevStatus === 'pending' && txn.status === 'rejected') {
          newlyRejected.push(txn.id);
        }
      }

      // Update the map for next comparison
      const nextMap = new Map<string, string>();
      for (const txn of transactions) {
        nextMap.set(txn.id, txn.status);
      }
      prevStatusMapRef.current = nextMap;

      if (newlyApproved.length === 0 && newlyRejected.length === 0) return;

      const timers: ReturnType<typeof setTimeout>[] = [];

      if (newlyApproved.length > 0) {
        setAnimatingIds((prev) => {
          const next = new Set(prev);
          for (const id of newlyApproved) next.add(id);
          return next;
        });
        timers.push(setTimeout(() => {
          setAnimatingIds((prev) => {
            const next = new Set(prev);
            for (const id of newlyApproved) next.delete(id);
            return next;
          });
        }, 800));
      }

      if (newlyRejected.length > 0) {
        setRejectingIds((prev) => {
          const next = new Set(prev);
          for (const id of newlyRejected) next.add(id);
          return next;
        });
        timers.push(setTimeout(() => {
          setRejectingIds((prev) => {
            const next = new Set(prev);
            for (const id of newlyRejected) next.delete(id);
            return next;
          });
        }, 800));
      }

      return () => { for (const t of timers) clearTimeout(t); };
    }, [transactions]);

    // --- Delete sweep & new row entrance animations ---
    const prevTransactionsRef = useRef<TransactionRow[]>(transactions);
    const [deletingRows, setDeletingRows] = useState<Map<string, { row: TransactionRow; index: number }>>(new Map());
    const [newRowIds, setNewRowIds] = useState<Set<string>>(new Set());
    // Ghost row cleanup timers must survive effect re-runs. If stored in the
    // effect and returned as cleanup, a subsequent `transactions` change (e.g.
    // restoreTemplate after removeTransaction during undo) cancels the timer,
    // leaving ghost rows permanently visible.
    const animationTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    useEffect(() => {
      return () => { for (const t of animationTimersRef.current) clearTimeout(t); };
    }, []);
    useEffect(() => {
      const prevTxns = prevTransactionsRef.current;
      prevTransactionsRef.current = transactions;

      const prevIds = new Set(prevTxns.map((t) => t.id));
      const currIds = new Set(transactions.map((t) => t.id));

      // Detect deleted rows (only non-planned — planned rows use their own collapse animation)
      const gone: TransactionRow[] = [];
      for (const txn of prevTxns) {
        if (!currIds.has(txn.id) && txn.status !== 'planned') gone.push(txn);
      }

      // Detect new rows
      const added: string[] = [];
      for (const txn of transactions) {
        if (!prevIds.has(txn.id) && txn.status !== 'planned') added.push(txn.id);
      }

      // If rows reappeared (undo), immediately clear them from ghost/animation state
      if (added.length > 0) {
        const addedSet = new Set(added);
        setDeletingRows((prev) => {
          let changed = false;
          for (const id of addedSet) {
            if (prev.has(id)) { changed = true; break; }
          }
          if (!changed) return prev;
          const next = new Map(prev);
          for (const id of addedSet) next.delete(id);
          return next;
        });
      }

      // Undo/redo: rows move both directions simultaneously — skip animations
      const isUndoRedo = gone.length > 0 && added.length > 0;

      // Animate deletes (skip for undo/redo — restored rows appear instantly)
      if (gone.length > 0 && gone.length <= 5 && !isUndoRedo) {
        const prevIdToIndex = new Map(prevTxns.map((t, i) => [t.id, i]));
        setDeletingRows((prev) => {
          const next = new Map(prev);
          for (const txn of gone) {
            if (!next.has(txn.id)) {
              next.set(txn.id, { row: txn, index: prevIdToIndex.get(txn.id) ?? 0 });
            }
          }
          return next;
        });
        animationTimersRef.current.push(setTimeout(() => {
          setDeletingRows((prev) => {
            const next = new Map(prev);
            for (const txn of gone) next.delete(txn.id);
            return next;
          });
        }, 400));
      }

      // Animate new rows (skip undo/redo — restored rows appear instantly)
      if (added.length === 1 && !isUndoRedo) {
        setNewRowIds((prev) => new Set(prev).add(added[0]));
        animationTimersRef.current.push(setTimeout(() => {
          setNewRowIds((prev) => {
            const next = new Set(prev);
            next.delete(added[0]);
            return next;
          });
        }, 600));
      }
    }, [transactions]);

    const columns = useMemo<ColumnDef<TransactionRow>[]>(() => {
      const cols: ColumnDef<TransactionRow>[] = [
        {
          id: 'attachments',
          header: () => <Paperclip className="h-3 w-3 text-muted-foreground" />,
          cell: ({ row }) => {
            const count = attachmentCountsRef.current?.[row.original.id] ?? 0;
            if (count === 0) return null;
            return (
              <button
                type="button"
                className="flex items-center gap-0.5 text-fidra-teal hover:text-fidra-teal/80 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onAttachmentClickRef.current?.(row.original.id);
                }}
                title={`${count} attachment${count > 1 ? 's' : ''}`}
              >
                <Paperclip className="h-3.5 w-3.5" />
                {count > 1 && <span className="text-[10px] font-mono">{count}</span>}
              </button>
            );
          },
          enableSorting: false,
          size: 32,
        },
        {
          accessorKey: 'date',
          header: ({ column }) => (
            <button className="flex items-center" onClick={() => column.toggleSorting()}>
              Date<SortIcon isSorted={column.getIsSorted()} />
            </button>
          ),
          cell: ({ getValue }) => <span className="text-foreground">{formatDate(getValue<string>())}</span>,
          size: 110,
        },
        {
          accessorKey: 'description',
          header: ({ column }) => (
            <button className="flex items-center" onClick={() => column.toggleSorting()}>
              Description<SortIcon isSorted={column.getIsSorted()} />
            </button>
          ),
          cell: ({ getValue }) => <span className="text-foreground font-medium">{getValue<string>()}</span>,
          size: 200,
        },
        {
          accessorKey: 'amount',
          header: ({ column }) => (
            <button className="flex items-center" onClick={() => column.toggleSorting()}>
              Amount<SortIcon isSorted={column.getIsSorted()} />
            </button>
          ),
          cell: ({ row }) => {
            const amount = row.original.amount;
            const isIncome = row.original.type === 'income';
            return (
              <span className={cn('font-mono tabular-nums', isIncome ? 'text-fidra-positive' : 'text-fidra-negative')}>
                {isIncome ? '+' : '-'}{formatCurrency(amount)}
              </span>
            );
          },
          sortingFn: (a, b) => parseFloat(a.original.amount) - parseFloat(b.original.amount),
          size: 120,
        },
        {
          accessorKey: 'type',
          header: 'Type',
          cell: ({ getValue }) => <span className="capitalize">{getValue<string>()}</span>,
          size: 80,
        },
        {
          accessorKey: 'category',
          header: ({ column }) => (
            <button className="flex items-center" onClick={() => column.toggleSorting()}>
              Category<SortIcon isSorted={column.getIsSorted()} />
            </button>
          ),
          cell: ({ getValue }) => {
            const val = getValue<string | null>();
            return val ? <span>{val}</span> : <span className="text-fidra-slate/40">&mdash;</span>;
          },
          size: 120,
        },
        {
          accessorKey: 'party',
          header: 'Party',
          cell: ({ getValue }) => {
            const val = getValue<string | null>();
            return val ? <span>{val}</span> : <span className="text-fidra-slate/40">&mdash;</span>;
          },
          size: 120,
        },
        {
          accessorKey: 'reference',
          header: 'Reference',
          cell: ({ getValue }) => {
            const val = getValue<string | null>();
            return val ? <span className="font-mono text-xs">{val}</span> : <span className="text-fidra-slate/40">&mdash;</span>;
          },
          size: 100,
        },
        {
          accessorKey: 'activity',
          header: 'Activity',
          cell: ({ getValue }) => {
            const val = getValue<string | null>();
            return val ? <span>{val}</span> : <span className="text-fidra-slate/40">&mdash;</span>;
          },
          size: 100,
        },
      ];

      if (showSheetColumn) {
        cols.push({
          accessorKey: 'sheet',
          header: 'Sheet',
          size: 100,
        });
      }

      cols.push(
        {
          accessorKey: 'status',
          header: 'Status',
          cell: ({ getValue }) => <StatusBadge status={getValue<string>()} />,
          size: 90,
        },
        {
          id: 'balance',
          header: 'Balance',
          cell: ({ row }) => {
            const balance = runningBalances.get(row.original.id);
            if (balance === undefined) return <span className="text-fidra-slate/40">&mdash;</span>;
            return (
              <span className={cn('font-mono tabular-nums', balance >= 0 ? 'text-fidra-positive' : 'text-fidra-negative')}>
                {formatCurrency(balance)}
              </span>
            );
          },
          enableSorting: false,
          size: 110,
        },
        {
          accessorKey: 'notes',
          header: 'Notes',
          cell: ({ getValue }) => {
            const notes = getValue<string | null>();
            if (!notes) return null;
            return <span className="truncate max-w-[150px] block text-muted-foreground" title={notes}>{notes}</span>;
          },
          size: 150,
        },
      );

      return cols;
    }, [showSheetColumn, runningBalances]);

    const table = useReactTable({
      data: transactions,
      columns,
      state: { sorting, rowSelection: selectedIds },
      onSortingChange: setSorting,
      onRowSelectionChange: onSelectionChange,
      getCoreRowModel: getCoreRowModel(),
      getSortedRowModel: getSortedRowModel(),
      getRowId: (row) => row.id,
      enableRowSelection: (row) => row.original.status !== 'planned',
    });

    // Pin planned rows to top, preserving sort within each group
    const allRows = table.getRowModel().rows;
    const rows = useMemo(() => {
      const planned = allRows.filter((r) => r.original.status === 'planned');
      const actual = allRows.filter((r) => r.original.status !== 'planned');
      return [...planned, ...actual];
    }, [allRows]);

    // Index of the first actual row (for rendering the divider)
    const plannedDividerIndex = useMemo(() => {
      const count = rows.findIndex((r) => r.original.status !== 'planned');
      return count > 0 ? count : -1;
    }, [rows]);
    const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);

    // Report the display-ordered row IDs to the parent for keyboard navigation
    const onDisplayedRowIdsChangeRef = useRef(onDisplayedRowIdsChange);
    onDisplayedRowIdsChangeRef.current = onDisplayedRowIdsChange;
    useEffect(() => {
      const ids = rows.map((r) => r.original.id);
      onDisplayedRowIdsChangeRef.current?.(ids);
    }, [rows]);

    const handleRowClick = useCallback(
      (e: React.MouseEvent, rowIndex: number) => {
        // Don't interfere with checkbox clicks
        const target = e.target as HTMLElement;
        if (target.closest('button, [role="checkbox"]')) return;

        const row = rows[rowIndex];
        if (!row) return;

        // Planned rows can be focused but not checkbox-selected
        if (row.original.status === 'planned') {
          applyFocusRing(row.original.id);
          onFocusedRowChange?.(row.original.id);
          // Include in selection state so the balance panel can show it
          onSelectionChange({ [row.original.id]: true });
          return;
        }
        const rowId = row.original.id;
        const isMod = e.metaKey || e.ctrlKey;

        if (e.shiftKey && lastClickedIndex.current !== null) {
          // Text selection is prevented via onMouseDown
          // Shift+click: range select
          const start = Math.min(lastClickedIndex.current, rowIndex);
          const end = Math.max(lastClickedIndex.current, rowIndex);
          const newSelection: RowSelectionState = {};
          for (let i = start; i <= end; i++) {
            const r = rows[i];
            if (r) newSelection[r.original.id] = true;
          }
          // If Cmd is also held, merge with existing selection
          if (isMod) {
            onSelectionChange((prev: RowSelectionState) => ({ ...prev, ...newSelection }));
          } else {
            onSelectionChange(newSelection);
          }
        } else if (isMod) {
          // Cmd/Ctrl+click: toggle this row
          onSelectionChange((prev: RowSelectionState) => {
            const next = { ...prev };
            if (next[rowId]) {
              delete next[rowId];
            } else {
              next[rowId] = true;
            }
            return next;
          });
          lastClickedIndex.current = rowIndex;
        } else {
          // Plain click: select only this row
          onSelectionChange({ [rowId]: true });
          lastClickedIndex.current = rowIndex;
        }

        // Sync focused row with click
        applyFocusRing(rowId);
        onFocusedRowChange?.(rowId);
      },
      [rows, onSelectionChange, onFocusedRowChange, applyFocusRing],
    );

    return (
      <div
        className="flex-1 overflow-auto rounded-xl border border-border-subtle bg-[#EEEEE9] dark:bg-[#2A2D32]"
        style={zoom !== 1 ? { zoom } : undefined}
        onMouseDown={(e) => {
          // Click-off deselect: only when clicking empty space (not on a row)
          const target = e.target as HTMLElement;
          if (!target.closest('tr')) {
            onSelectionChange({});
            applyFocusRing(null);
          }
        }}
      >
        <table ref={tableElRef} className="w-full text-sm font-body">
          <thead className="bg-[#E4E4DF] dark:bg-[#32363B] sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-4 py-3 text-left font-display text-xs font-semibold text-muted-foreground border-b border-border-subtle"
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 && deletingRows.size === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center">
                  <p className="font-display font-medium text-fidra-slate">No transactions yet</p>
                  <p className="text-sm text-muted-foreground mt-1">Add one using the form on the left</p>
                </td>
              </tr>
            ) : (
              (() => {
                // Merge deleting ghost rows at their original positions
                type RenderItem = { type: 'live'; row: typeof rows[0]; idx: number } | { type: 'ghost'; row: TransactionRow };
                const items: RenderItem[] = rows.map((row, idx) => ({ type: 'live' as const, row, idx }));
                // Insert ghosts at their stored indices (clamped to current list length)
                // Skip ghosts whose ID is already in the live list (undo brought them back)
                const liveIds = new Set(rows.map((r) => r.original.id));
                const ghosts = Array.from(deletingRows.values())
                  .filter(({ row }) => !liveIds.has(row.id))
                  .sort((a, b) => a.index - b.index);
                let offset = 0;
                for (const { row, index } of ghosts) {
                  const insertAt = Math.min(index + offset, items.length);
                  items.splice(insertAt, 0, { type: 'ghost', row });
                  offset++;
                }
                return items.map((item) => {
                  if (item.type === 'ghost') {
                    const rowData = item.row;
                    return (
                      <tr key={`deleting-${rowData.id}`} data-row-deleting="" className="border-b border-border-subtle">
                        <td colSpan={columns.length} className="whitespace-nowrap px-4 py-3">
                          <div className="flex items-center gap-4">
                            <span className="text-foreground">{formatDate(rowData.date)}</span>
                            <span className="text-foreground font-medium">{rowData.description}</span>
                            <span className={cn('font-mono tabular-nums ml-auto', rowData.type === 'income' ? 'text-fidra-positive' : 'text-fidra-negative')}>
                              {rowData.type === 'income' ? '+' : '-'}{formatCurrency(rowData.amount)}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  const { row, idx } = item;
                  return (
                <React.Fragment key={row.id}>
                  {/* Planned/actual divider */}
                  {idx === plannedDividerIndex && (
                    <tr className="pointer-events-none">
                      <td colSpan={columns.length} className="p-0">
                        <div className={cn(
                          'overflow-hidden transition-[max-height,opacity,border-color] duration-500 ease-in-out border-t border-b',
                          showPlanned ? 'max-h-4 opacity-100 h-3 border-fidra-teal/25' : 'max-h-0 opacity-0 border-transparent',
                        )} />
                      </td>
                    </tr>
                  )}
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <tr
                      ref={(el) => {
                        if (el) rowRefs.current.set(row.original.id, el);
                        else rowRefs.current.delete(row.original.id);
                      }}
                      {...(row.getIsSelected() ? { 'data-row-selected': '' } : {})}
                      {...(animatingIds.has(row.original.id) ? { 'data-row-just-approved': '' } : {})}
                      {...(rejectingIds.has(row.original.id) ? { 'data-row-just-rejected': '' } : {})}
                      {...(newRowIds.has(row.original.id) ? { 'data-row-new': '' } : {})}
                      className={cn(
                        'border-b border-border-subtle cursor-pointer relative',
                        row.original.status === 'planned'
                          && 'transition-[background-color,border-color] duration-500 ease-in-out',
                        idx % 2 === 0 ? 'bg-[#EEEEE9] dark:bg-[#2A2D32]' : 'bg-[#E8E8E3] dark:bg-[#252830]',
                        'hover:bg-fidra-teal/5',
                        row.original.status === 'planned' && !showPlanned && 'border-b-transparent',
                        row.original.status === 'planned' && 'opacity-50',
                        row.original.status === 'pending' && 'bg-fidra-warning/5 border-l-2 border-l-fidra-warning',
                        row.original.status === 'rejected' && 'line-through opacity-60',
                      )}
                      onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
                      onClick={(e) => handleRowClick(e, idx)}
                      onDoubleClick={() => onEdit(row.original)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className={cn('whitespace-nowrap p-0', row.original.status !== 'planned' && 'px-4 py-3')}>
                          {row.original.status === 'planned' ? (
                            <div className={cn(
                              'overflow-hidden transition-[max-height,opacity,padding] duration-500 ease-in-out px-4',
                              showPlanned ? 'max-h-[48px] opacity-100 py-3' : 'max-h-0 opacity-0 py-0',
                            )}>
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </div>
                          ) : (
                            flexRender(cell.column.columnDef.cell, cell.getContext())
                          )}
                        </td>
                      ))}
                      {animatingIds.has(row.original.id) && (
                        <td className="absolute inset-0 pointer-events-none" aria-hidden>
                          <div className="flex items-center justify-center h-full">
                            <div
                              className="flex items-center justify-center w-10 h-10 rounded-full bg-fidra-positive text-white shadow-lg"
                              style={{ animation: 'checkStamp 800ms ease-out forwards' }}
                            >
                              <Check className="w-6 h-6" strokeWidth={3} />
                            </div>
                          </div>
                        </td>
                      )}
                      {rejectingIds.has(row.original.id) && (
                        <td className="absolute inset-0 pointer-events-none" aria-hidden>
                          <div className="flex items-center justify-center h-full">
                            <div
                              className="flex items-center justify-center w-10 h-10 rounded-full bg-fidra-negative text-white shadow-lg"
                              style={{ animation: 'rejectStamp 800ms ease-out forwards' }}
                            >
                              <X className="w-6 h-6" strokeWidth={3} />
                            </div>
                          </div>
                        </td>
                      )}
                    </tr>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    {row.original.status === 'planned' ? (
                      <ContextMenuItem onClick={() => onEdit(row.original)}>
                        Convert to Transaction
                      </ContextMenuItem>
                    ) : (
                      <>
                        <ContextMenuItem onClick={() => onEdit(row.original)}>Edit</ContextMenuItem>
                        <ContextMenuItem onClick={() => onDuplicate(row.original)}>Duplicate</ContextMenuItem>
                        {selectedRows.length > 1 && onBulkEdit && (
                          <>
                            <ContextMenuSeparator />
                            <ContextMenuItem onClick={() => onBulkEdit(selectedRows)}>
                              Bulk Edit ({selectedRows.length})
                            </ContextMenuItem>
                          </>
                        )}
                        <ContextMenuSeparator />
                        {row.original.type === 'expense' && row.original.status === 'pending' && (
                          <>
                            <ContextMenuItem onClick={() => onApprove(selectedRows.length > 1 ? selectedRows : [row.original])}>
                              Approve
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => onReject(selectedRows.length > 1 ? selectedRows : [row.original])}>
                              Reject
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                          </>
                        )}
                        <ContextMenuItem
                          className="text-fidra-negative"
                          onClick={() => onDelete(selectedRows.length > 1 ? selectedRows : [row.original])}
                        >
                          Delete{selectedRows.length > 1 ? ` (${selectedRows.length})` : ''}
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
                </React.Fragment>
                  );
                });
              })()
            )}
          </tbody>
        </table>
      </div>
    );
  },
);
