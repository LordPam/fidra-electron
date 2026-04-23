import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTransactionStore } from '@/stores/transaction-store';
import { useSheetStore } from '@/stores/sheet-store';
import { usePlannedStore } from '@/stores/planned-store';
import { useUiStore } from '@/stores/ui-store';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import { parseActivityDate } from '@/lib/activity-parser';
import type { DatePrecision } from '@/lib/activity-parser';
import type { CategoryData } from '@/lib/chart-utils';
import { aggregateActivities, computeMonthView } from '@/services/activity-aggregation';
import { expandTemplate } from '@/services/forecast';
import { ExpensesByCategoryChart } from '@/components/ExpensesByCategoryChart';
import { NetPositionChart } from '@/components/ActualVsPlannedChart';
import { MonthSelector } from '@/components/MonthSelector';
import { MonthTracker } from '@/components/MonthTracker';
import type { MonthTrackerActivity } from '@/components/MonthTracker';
import { MetricCard } from '@/components/MetricCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { ZoomControls } from '@/components/ZoomControls';
import { useUndoRedoShortcuts } from '@/hooks/useUndoRedoShortcuts';
import { useViewData } from '@/hooks/useViewData';
import { useViewZoom } from '@/hooks/useViewZoom';
import { renameActivity, deleteActivity, persistActivityNote } from '@/services/activity';

const ACTIVITY_CHART_COLORS = ['#89B0AE', '#6B8F8D', '#455561'];

type SortBy = 'name' | 'date' | 'expense' | 'net' | 'count' | 'status';

const STATUS_ORDER: Record<string, number> = { Planned: 0, Active: 1, Complete: 2 };

export default function ActivitiesView() {
  const navigate = useNavigate();
  const { transactions, loadAll, bulkUpdate } = useTransactionStore();
  const { currentSheet, loadAll: loadSheets } = useSheetStore();
  const { templates, loadAll: loadPlanned, bulkUpdateTemplates } = usePlannedStore();
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  useUndoRedoShortcuts();
  const { zoom: activitiesTableZoom, zoomIn: zoomActivitiesTableIn, zoomOut: zoomActivitiesTableOut, resetZoom: resetActivitiesTableZoom } = useViewZoom('activitiesTableZoom');

  const today = useMemo(() => new Date(), []);
  const [selectedMonth, setSelectedMonth] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 });
  const [selectedActivity, setSelectedActivity] = useState<string | null>(null);
  const [notesText, setNotesText] = useState('');
  const [activityNotes, setActivityNotes] = useState<Record<string, string>>({});
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activityListRef = useRef<HTMLDivElement>(null);
  const [editingActivity, setEditingActivity] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [deletingActivities, setDeletingActivities] = useState<Set<string>>(new Set());
  const loadedNotesRef = useRef<Record<string, string>>({});

  const refreshNotes = useCallback(async () => {
    const notes = await window.api.getActivityNotes();
    setActivityNotes(notes);
    loadedNotesRef.current = notes;
  }, []);

  useViewData([loadSheets, loadPlanned], loadAll, currentSheet);

  useEffect(() => {
    window.api.getActivityNotes().then((notes) => {
      setActivityNotes(notes);
      loadedNotesRef.current = notes;
    });
  }, []);

  // ─── All-time activity rows (for table) ───────────────────────────
  const { allRows, allTotals } = useMemo(
    () => aggregateActivities(transactions, templates, currentSheet, activityNotes),
    [transactions, templates, currentSheet, activityNotes],
  );

  // ─── Month-view rows (for tracker, charts, metrics) ───────────────
  const { monthViewRows, monthViewTotals } = useMemo(
    () => computeMonthView(allRows, templates, currentSheet, selectedMonth),
    [allRows, templates, currentSheet, selectedMonth],
  );

  // Sorted table rows (all-time, default by date)
  const sortedRows = useMemo(() => {
    const sorted = [...allRows];
    switch (sortBy) {
      case 'date':
        sorted.sort((a, b) => {
          const aKey = a.parsedDate ?? '\uffff';
          const bKey = b.parsedDate ?? '\uffff';
          return aKey.localeCompare(bKey);
        });
        break;
      case 'expense':
        sorted.sort((a, b) => b.expenses - a.expenses);
        break;
      case 'net':
        sorted.sort((a, b) => a.net - b.net);
        break;
      case 'count':
        sorted.sort((a, b) => b.count - a.count);
        break;
      case 'status':
        sorted.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
        break;
      default:
        break;
    }
    return sorted;
  }, [allRows, sortBy]);

  // Forecast lookup: all-time planned net per activity (unfulfilled templates, all future instances)
  const forecastMap = useMemo(() => {
    // Expand all templates up to 1 year ahead to capture recurring planned amounts
    const horizon = new Date();
    horizon.setFullYear(horizon.getFullYear() + 1);
    const horizonStr = horizon.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);

    const filtered = currentSheet === 'All Sheets'
      ? templates
      : templates.filter((t) => t.target_sheet === currentSheet);

    const map = new Map<string, { plannedNet: number }>();
    for (const tmpl of filtered) {
      const activity = tmpl.activity?.trim();
      if (!activity) continue;
      const instances = expandTemplate(tmpl, horizonStr, true);
      for (const inst of instances) {
        if (inst.instanceDate < todayStr) continue; // only future instances
        const amount = parseFloat(inst.transaction.amount) || 0;
        const entry = map.get(activity) ?? { plannedNet: 0 };
        entry.plannedNet += inst.transaction.type === 'income' ? amount : -amount;
        map.set(activity, entry);
      }
    }
    // Remove zero entries
    for (const [k, v] of map) { if (v.plannedNet === 0) map.delete(k); }
    return map;
  }, [templates, currentSheet]);

  // Summary stats (from month-view activities)
  const summaryStats = useMemo(() => {
    const activeCount = monthViewRows.filter((r) => r.status === 'Active' || r.status === 'Complete').length;
    const largestExpense = monthViewRows.length > 0
      ? monthViewRows.reduce((max, r) => (r.expenses > max.expenses ? r : max), monthViewRows[0])
      : null;
    return { activeCount, totalCount: monthViewRows.length, largestExpense };
  }, [monthViewRows]);

  // Month tracker activities
  // Day-precision dates overlapping the month → span bars on the calendar.
  // Everything else (undated, year-only, month-matching, day-outside-month) → chip lane.
  const trackerActivities = useMemo((): MonthTrackerActivity[] => {
    const { year, month } = selectedMonth;
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const daysInMonth = new Date(year, month, 0).getDate();
    const monthStartDate = `${monthPrefix}-01`;
    const monthEndDate = `${monthPrefix}-${String(daysInMonth).padStart(2, '0')}`;

    return monthViewRows.map((r) => {
      let startDay: number | null = null;
      let endDay: number | null = null;
      let imprecise = false;

      if (r.datePrecision === 'day' && r.parsedDate) {
        // Day-precision: span bar on exact days
        const endDate = r.parsedEndDate ?? r.parsedDate;
        if (r.parsedDate <= monthEndDate && endDate >= monthStartDate) {
          const startInMonth = r.parsedDate.startsWith(monthPrefix + '-');
          const endInMonth = endDate.startsWith(monthPrefix + '-');
          startDay = startInMonth ? parseInt(r.parsedDate.slice(8, 10), 10) : 1;
          endDay = endInMonth ? parseInt(endDate.slice(8, 10), 10) : daysInMonth;
        }
      } else if (r.datePrecision === 'month' || r.datePrecision === 'year') {
        // Month/year precision: full-month dashed span bar
        startDay = 1;
        endDay = daysInMonth;
        imprecise = true;
      }
      // datePrecision === 'none': startDay/endDay stay null → chip lane

      let color: 'teal' | 'amber' | 'salmon';
      if (r.count === 0) {
        color = 'amber';
      } else if (r.net < 0 || r.projectedNet < 0) {
        color = 'salmon';
      } else {
        color = 'teal';
      }

      return {
        rawActivity: r.rawActivity,
        displayTitle: r.displayTitle,
        startDay,
        endDay,
        imprecise,
        color,
        status: r.status,
        net: r.net,
      };
    });
  }, [monthViewRows, selectedMonth]);

  // Chart data (from month-view activities)
  const spendingByActivity = useMemo((): CategoryData[] => {
    return [...monthViewRows]
      .sort((a, b) => b.expenses - a.expenses)
      .slice(0, 6)
      .map((r) => ({ category: r.displayTitle, total: r.expenses }));
  }, [monthViewRows]);

  const netPositionData = useMemo(() => {
    return [...monthViewRows]
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
      .slice(0, 8)
      .sort((a, b) => a.net - b.net)
      .map((r) => ({ activity: r.displayTitle, net: r.net }));
  }, [monthViewRows]);

  // --- Notes persistence ---
  const persistNotes = useCallback(
    (activity: string, text: string) => {
      const oldText = loadedNotesRef.current[activity] || '';
      // Update local state immediately
      if (text) {
        setActivityNotes((prev) => ({ ...prev, [activity]: text }));
        loadedNotesRef.current = { ...loadedNotesRef.current, [activity]: text };
      } else {
        setActivityNotes((prev) => {
          const next = { ...prev };
          delete next[activity];
          return next;
        });
        const updated = { ...loadedNotesRef.current };
        delete updated[activity];
        loadedNotesRef.current = updated;
      }
      persistActivityNote({ activity, text, oldText, refreshNotes });
    },
    [refreshNotes],
  );

  const handleNotesChange = useCallback(
    (text: string) => {
      setNotesText(text);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        if (selectedActivity) persistNotes(selectedActivity, text.trim());
      }, 500);
    },
    [selectedActivity, persistNotes],
  );

  const handleRowClick = useCallback(
    (activity: string) => {
      // Clear inline rename if clicking away from the edited row
      if (editingActivity && editingActivity !== activity) {
        setEditingActivity(null);
      }
      if (selectedActivity) {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        const previousNotes = loadedNotesRef.current[selectedActivity] || '';
        if (notesText.trim() !== previousNotes) {
          persistNotes(selectedActivity, notesText.trim());
        }
      }
      setSelectedActivity(activity);
      setNotesText(activityNotes[activity] || '');

      // Navigate month selector if the activity has at least month precision
      const parsed = parseActivityDate(activity);
      if (parsed.parsedDatePrefix && (parsed.datePrecision === 'day' || parsed.datePrecision === 'month')) {
        const [y, m] = parsed.parsedDatePrefix.split('-');
        const ym = { year: parseInt(y, 10), month: parseInt(m, 10) };
        if (ym.year !== selectedMonth.year || ym.month !== selectedMonth.month) {
          setSelectedMonth(ym);
        }
      }
    },
    [editingActivity, selectedActivity, notesText, activityNotes, persistNotes, selectedMonth],
  );

  const handleRowDoubleClick = useCallback(
    (activity: string) => {
      setSearchQuery(`"${activity}"`);
      navigate('/transactions');
    },
    [navigate, setSearchQuery],
  );

  const handleDeselect = useCallback(() => {
    if (editingActivity) setEditingActivity(null);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (selectedActivity) {
      const previousNotes = loadedNotesRef.current[selectedActivity] || '';
      if (notesText.trim() !== previousNotes) {
        persistNotes(selectedActivity, notesText.trim());
      }
    }
    setSelectedActivity(null);
  }, [editingActivity, selectedActivity, notesText, persistNotes]);

  // --- Activity CRUD ---
  const handleRenameStart = useCallback((activity: string) => {
    setEditingActivity(activity);
    setEditingValue(activity);
  }, []);

  const handleRenameCommit = useCallback(async () => {
    if (!editingActivity) return;
    const newName = editingValue.trim();
    const oldName = editingActivity;
    setEditingActivity(null);
    if (!newName || newName === oldName) return;

    await renameActivity({
      oldName, newName, transactions, templates, activityNotes, refreshNotes,
    });

    if (selectedActivity === oldName) {
      setSelectedActivity(newName);
    }
  }, [editingActivity, editingValue, transactions, templates, activityNotes, selectedActivity, refreshNotes]);

  const handleDeleteActivity = useCallback(async (activity: string) => {
    // Animate out
    setDeletingActivities((prev) => new Set(prev).add(activity));

    await deleteActivity({
      activity, transactions, templates, activityNotes, refreshNotes,
    });

    // Clear selection if it was this one
    if (selectedActivity === activity) {
      setSelectedActivity(null);
    }

    // Remove animation state after delay
    setTimeout(() => {
      setDeletingActivities((prev) => {
        const next = new Set(prev);
        next.delete(activity);
        return next;
      });
    }, 400);
  }, [transactions, templates, activityNotes, selectedActivity, refreshNotes]);


  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      if (e.key === 'Escape') {
        handleDeselect();
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      const tag = (active?.tagName ?? '').toUpperCase();
      const isInputFocused = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (isInputFocused) return;

      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !isMod) {
        e.preventDefault();
        e.stopPropagation();
        if (sortedRows.length === 0) return;

        const currentIdx = selectedActivity
          ? sortedRows.findIndex((r) => r.rawActivity === selectedActivity)
          : -1;

        let nextIdx: number;
        if (e.key === 'ArrowDown') {
          nextIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, sortedRows.length - 1);
        } else {
          nextIdx = currentIdx < 0 ? 0 : Math.max(currentIdx - 1, 0);
        }

        handleRowClick(sortedRows[nextIdx].rawActivity);

        requestAnimationFrame(() => {
          const container = activityListRef.current;
          if (!container) return;
          const row = container.querySelector(`[data-activity="${CSS.escape(sortedRows[nextIdx].rawActivity)}"]`);
          row?.scrollIntoView({ block: 'nearest' });
        });
        return;
      }

      if (e.key === 'Enter' && selectedActivity) {
        handleRowDoubleClick(selectedActivity);
        return;
      }
    };
    // Use capture phase so arrow/Enter handling runs before radix components
    // (e.g. Select trigger) can swallow the event via stopPropagation
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [handleDeselect, sortedRows, selectedActivity, handleRowClick, handleRowDoubleClick]);

  const formatNet = (n: number) => {
    const sign = n >= 0 ? '+' : '';
    return `${sign}${formatCurrency(n)}`;
  };

  const formatDateCol = (parsedDate: string | null, precision: DatePrecision): string => {
    if (!parsedDate || precision === 'none') return '\u2014';
    if (precision === 'day') {
      const [, m, d] = parsedDate.split('-');
      const date = new Date(parseInt(parsedDate.slice(0, 4)), parseInt(m) - 1, parseInt(d));
      return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }
    if (precision === 'month') {
      const [y, m] = parsedDate.split('-');
      const date = new Date(parseInt(y), parseInt(m) - 1, 1);
      return date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
    }
    return parsedDate;
  };

  const GRID_COLS = 'grid-cols-[12px_72px_minmax(0,1fr)_72px_48px_80px_80px_80px_80px]';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-3 border-b border-border-subtle bg-surface-raised shrink-0">
        <h1 className="text-xl font-display font-semibold">Activities</h1>
        <MonthSelector
          year={selectedMonth.year}
          month={selectedMonth.month}
          onChange={(year, month) => setSelectedMonth({ year, month })}
        />
        <div className="flex-1" />
        <ZoomControls
          zoom={activitiesTableZoom}
          onZoomIn={zoomActivitiesTableIn}
          onZoomOut={zoomActivitiesTableOut}
          onReset={resetActivitiesTableZoom}
        />
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
          <SelectTrigger className="w-[180px] h-8 text-xs">
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">By name</SelectItem>
            <SelectItem value="date">By date</SelectItem>
            <SelectItem value="expense">By total expense</SelectItem>
            <SelectItem value="net">By net</SelectItem>
            <SelectItem value="count">By transaction count</SelectItem>
            <SelectItem value="status">By status</SelectItem>
          </SelectContent>
        </Select>
      </header>

      <main className="flex-1 overflow-hidden p-6 flex flex-col gap-5">
        {allRows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            No activities found — tag transactions with an activity to track them here.
          </p>
        ) : (
          <>
            {/* Hero cards */}
            <div className="grid grid-cols-4 gap-4 shrink-0">
              <MetricCard
                title="Active Activities"
                value={String(summaryStats.activeCount)}
                subtitle={`${summaryStats.totalCount} total this month`}
                variant="default"
              />
              <MetricCard
                title="Largest Expense"
                value={summaryStats.largestExpense && summaryStats.largestExpense.expenses > 0
                  ? summaryStats.largestExpense.displayTitle
                  : 'None'}
                subtitle={summaryStats.largestExpense && summaryStats.largestExpense.expenses > 0
                  ? `${formatCurrency(summaryStats.largestExpense.expenses)} across ${summaryStats.largestExpense.count} txns`
                  : undefined}
                variant="negative"
              />
              {/* Month Net */}
              <div className="rounded-lg bg-card border border-border-subtle p-4 border-t-[3px] border-t-border-subtle min-w-0">
                <p className="text-xs font-display font-medium uppercase tracking-[0.05em] text-muted-foreground mb-1 truncate">
                  Month Net
                </p>
                <p
                  className={cn(
                    'text-xl font-display font-bold tabular-nums truncate',
                    monthViewTotals.net > 0 ? 'text-fidra-positive' : monthViewTotals.net < 0 ? 'text-fidra-negative' : '',
                  )}
                >
                  {formatNet(monthViewTotals.net)}
                </p>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {formatCurrency(monthViewTotals.income)} in · {formatCurrency(monthViewTotals.expenses)} out
                </p>
              </div>
              {/* Projected Net */}
              <div className={cn(
                'rounded-lg bg-card border border-border-subtle p-4 border-t-[3px] min-w-0',
                monthViewTotals.projectedNet < 0 ? 'border-t-fidra-negative' : 'border-t-fidra-warning',
              )}>
                <p className="text-xs font-display font-medium uppercase tracking-[0.05em] text-muted-foreground mb-1 truncate">
                  Projected Net
                </p>
                <p
                  className={cn(
                    'text-xl font-display font-bold tabular-nums truncate',
                    monthViewTotals.projectedNet > 0 ? 'text-fidra-positive' : monthViewTotals.projectedNet < 0 ? 'text-fidra-negative' : '',
                  )}
                >
                  {formatNet(monthViewTotals.projectedNet)}
                </p>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  Planned: {formatNet(monthViewTotals.plannedNet)}
                </p>
              </div>
            </div>

            {/* Month Tracker + Charts — 3:1 column split */}
            <div className="grid grid-cols-4 gap-4 items-stretch shrink-0">
              <div className="col-span-3 [&>div]:h-full">
                <MonthTracker
                  year={selectedMonth.year}
                  month={selectedMonth.month}
                  activities={trackerActivities}
                  selectedActivity={selectedActivity}
                  onActivityClick={handleRowClick}
                  onActivityDoubleClick={handleRowDoubleClick}
                />
              </div>

              <div className="col-span-1 flex flex-col gap-4">
                <div className="flex-1 rounded-lg bg-card border border-border-subtle p-4 flex flex-col">
                  <h3 className="text-sm font-display font-medium text-muted-foreground mb-2 shrink-0">
                    Spending by Activity
                  </h3>
                  <div className="flex-1 min-h-[140px]">
                    <ExpensesByCategoryChart data={spendingByActivity} title="Expenses" colors={ACTIVITY_CHART_COLORS} />
                  </div>
                </div>

                <div className="flex-1 rounded-lg bg-card border border-border-subtle p-4 flex flex-col">
                  <h3 className="text-sm font-display font-medium text-muted-foreground mb-2 shrink-0">
                    Net Position
                  </h3>
                  <div className="flex-1 min-h-[140px]">
                    <NetPositionChart data={netPositionData} />
                  </div>
                </div>
              </div>
            </div>

            {/* Activity table + notes — 3:1 column split */}
            <div className="grid grid-cols-4 gap-4 flex-1 min-h-0 overflow-hidden">
              <div className={cn('min-w-0 flex flex-col rounded-xl border border-border-subtle bg-[#EEEEE9] dark:bg-[#2A2D32] overflow-hidden min-h-0', selectedActivity ? 'col-span-3' : 'col-span-4')}>
                <div className="flex flex-col min-h-0 h-full" style={activitiesTableZoom !== 1 ? { zoom: activitiesTableZoom } : undefined}>
                {/* Table header */}
                <div className={cn('grid gap-1 px-4 py-3 bg-[#E4E4DF] dark:bg-[#32363B] border-b border-border-subtle text-xs font-display font-semibold text-muted-foreground shrink-0', GRID_COLS)}>
                  <span />
                  <span className="text-left">Date</span>
                  <span className="text-left">Activity</span>
                  <span className="text-left">Status</span>
                  <span className="text-right">Txns</span>
                  <span className="text-right">Income</span>
                  <span className="text-right">Expenses</span>
                  <span className="text-right">Net</span>
                  <span className="text-right">Forecast</span>
                </div>

                {/* Scrollable rows */}
                <div className="flex-1 min-h-0 overflow-auto" ref={activityListRef}>
                  {sortedRows.map((r) => {
                    const pct = allTotals.expenses > 0 ? (r.expenses / allTotals.expenses) * 100 : 0;
                    const isSelected = selectedActivity === r.rawActivity;
                    const isDeleting = deletingActivities.has(r.rawActivity);
                    const isEditing = editingActivity === r.rawActivity;

                    const dotColor = r.count === 0 ? 'bg-[#D4A03C]'
                      : (r.net < 0) ? 'bg-[#C07A72]'
                      : 'bg-[#89B0AE]';

                    return (
                      <ContextMenu key={r.rawActivity}>
                        <ContextMenuTrigger asChild>
                          <div
                            data-activity={r.rawActivity}
                            {...(isDeleting ? { 'data-row-deleting': '' } : {})}
                            {...(isSelected ? { 'data-row-selected': '', 'data-row-focused': '' } : {})}
                            className={cn(
                              'border-b border-border-subtle cursor-pointer transition-colors hover:bg-muted/30',
                            )}
                            onClick={() => handleRowClick(r.rawActivity)}
                            onDoubleClick={() => {
                              if (!isEditing) handleRowDoubleClick(r.rawActivity);
                            }}
                          >
                            <div className={cn('grid gap-1 px-4 py-3 items-center', GRID_COLS)}>
                              <span className={cn('h-2 w-2 rounded-full shrink-0', dotColor)} />
                              <span className="text-xs text-muted-foreground tabular-nums truncate">
                                {formatDateCol(r.parsedDate, r.datePrecision)}
                              </span>
                              {isEditing ? (
                                <input
                                  autoFocus
                                  className="text-sm bg-transparent border-b border-fidra-teal outline-none w-full"
                                  value={editingValue}
                                  onChange={(e) => setEditingValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleRenameCommit();
                                    if (e.key === 'Escape') setEditingActivity(null);
                                  }}
                                  onBlur={handleRenameCommit}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                <span className="text-sm truncate" title={r.rawActivity}>
                                  {r.displayTitle}
                                </span>
                              )}
                              <Badge
                                variant={r.status === 'Active' ? 'default' : r.status === 'Planned' ? 'secondary' : 'outline'}
                                className="text-[9px] px-1.5 py-0 w-fit"
                              >
                                {r.status}
                              </Badge>
                              <span className="text-xs text-muted-foreground text-right tabular-nums">{r.count}</span>
                              <span className="text-xs font-mono tabular-nums text-right">{formatCurrency(r.income)}</span>
                              <span className="text-xs font-mono tabular-nums text-right">{formatCurrency(r.expenses)}</span>
                              <span
                                className={cn(
                                  'text-xs font-mono tabular-nums text-right font-medium',
                                  r.net > 0 ? 'text-fidra-positive' : r.net < 0 ? 'text-fidra-negative' : '',
                                )}
                              >
                                {formatNet(r.net)}
                              </span>
                              {(() => {
                                const fc = forecastMap.get(r.rawActivity);
                                if (!fc) return <span />;
                                const projected = r.net + fc.plannedNet;
                                return (
                                  <span
                                    className={cn(
                                      'text-xs font-mono tabular-nums text-right opacity-70',
                                      projected > 0 ? 'text-fidra-positive' : projected < 0 ? 'text-fidra-negative' : '',
                                    )}
                                  >
                                    {formatNet(projected)}
                                  </span>
                                );
                              })()}
                            </div>
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem onClick={() => handleRenameStart(r.rawActivity)}>
                            Rename
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => handleRowDoubleClick(r.rawActivity)}>
                            View in Transactions
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem className="text-fidra-negative" onClick={() => handleDeleteActivity(r.rawActivity)}>
                            Delete
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    );
                  })}
                </div>

                {/* Pinned totals footer */}
                <div className={cn('grid gap-1 px-4 py-3 bg-[#E4E4DF] dark:bg-[#32363B] border-t border-border-subtle text-xs font-bold shrink-0', GRID_COLS)}>
                  <span />
                  <span />
                  <span className="text-sm font-display">Total</span>
                  <span />
                  <span className="text-right tabular-nums">{allTotals.count}</span>
                  <span className="font-mono tabular-nums text-right">{formatCurrency(allTotals.income)}</span>
                  <span className="font-mono tabular-nums text-right">{formatCurrency(allTotals.expenses)}</span>
                  <span
                    className={cn(
                      'font-mono tabular-nums text-right',
                      allTotals.net > 0 ? 'text-fidra-positive' : allTotals.net < 0 ? 'text-fidra-negative' : '',
                    )}
                  >
                    {formatNet(allTotals.net)}
                  </span>
                  {(() => {
                    let totalPlannedNet = 0;
                    for (const v of forecastMap.values()) totalPlannedNet += v.plannedNet;
                    if (totalPlannedNet === 0) return <span />;
                    const projectedTotal = allTotals.net + totalPlannedNet;
                    return (
                      <span
                        className={cn(
                          'font-mono tabular-nums text-right opacity-70',
                          projectedTotal > 0 ? 'text-fidra-positive' : projectedTotal < 0 ? 'text-fidra-negative' : '',
                        )}
                      >
                        {formatNet(projectedTotal)}
                      </span>
                    );
                  })()}
                </div>
                </div>
              </div>

              {/* Notes panel */}
              {selectedActivity && (
                <div className="col-span-1 rounded-lg border border-border-subtle p-3 flex flex-col">
                  <h3 className="text-xs font-display font-medium text-muted-foreground mb-1 truncate" title={selectedActivity}>
                    Notes — {selectedActivity}
                  </h3>
                  {(() => {
                    const r = allRows.find((r) => r.rawActivity === selectedActivity);
                    if (!r) return null;
                    return (
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-3 text-[10px]">
                        <div>
                          <span className="uppercase text-muted-foreground">All-time Net</span>
                          <p className={cn(
                            'font-mono tabular-nums text-xs',
                            r.net > 0 ? 'text-fidra-positive' : r.net < 0 ? 'text-fidra-negative' : 'text-muted-foreground',
                          )}>
                            {r.net !== 0 ? formatNet(r.net) : '-'}
                          </p>
                        </div>
                        <div>
                          <span className="uppercase text-muted-foreground">% of Expenses</span>
                          <p className="font-mono tabular-nums text-xs">
                            {allTotals.expenses > 0 ? ((r.expenses / allTotals.expenses) * 100).toFixed(0) : 0}%
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                  <textarea
                    className="flex-1 min-h-[80px] bg-muted/30 border border-border-subtle rounded-md p-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-fidra-teal"
                    placeholder="Add notes..."
                    value={notesText}
                    onChange={(e) => handleNotesChange(e.target.value)}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
