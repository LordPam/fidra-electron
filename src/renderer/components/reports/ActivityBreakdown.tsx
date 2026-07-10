import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import type { ActivityBreakdownRow } from '@/services/report-analysis';

const DEFAULT_VISIBLE = 8;

type SortColumn = 'activity' | 'count' | 'income' | 'expenditure' | 'net' | 'change';
type SortDirection = 'asc' | 'desc';

function SortIcon({ column, sortColumn, sortDirection }: { column: SortColumn; sortColumn: SortColumn; sortDirection: SortDirection }) {
  if (column !== sortColumn) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
  return sortDirection === 'asc'
    ? <ArrowUp className="h-3 w-3 ml-1" />
    : <ArrowDown className="h-3 w-3 ml-1" />;
}

function StatusBadge({ status }: { status: ActivityBreakdownRow['status'] }) {
  if (status === 'new') {
    return (
      <span className="ml-1.5 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-fidra-positive/15 text-fidra-positive">
        New
      </span>
    );
  }
  if (status === 'gone') {
    return (
      <span className="ml-1.5 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-fidra-negative/15 text-fidra-negative">
        Gone
      </span>
    );
  }
  return null;
}

interface ActivityBreakdownProps {
  rows: ActivityBreakdownRow[];
  collapsible?: boolean;
  title?: string;
}

export function ActivityBreakdown({ rows, collapsible = true, title = 'Activity Breakdown' }: ActivityBreakdownProps) {
  const [collapsed, setCollapsed] = useState(collapsible);
  const [sortColumn, setSortColumn] = useState<SortColumn>('net');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showAll, setShowAll] = useState(false);

  const toggleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDirection('desc');
    }
  };

  const sortedRows = useMemo(() => {
    const sorted = [...rows];
    const dir = sortDirection === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
      switch (sortColumn) {
        case 'activity': return dir * a.activity.localeCompare(b.activity);
        case 'count': return dir * (a.count - b.count);
        case 'income': return dir * (a.income - b.income);
        case 'expenditure': return dir * (a.expenditure - b.expenditure);
        case 'net': return dir * (a.net - b.net);
        case 'change': {
          const aP = a.delta?.percent ?? 0;
          const bP = b.delta?.percent ?? 0;
          return dir * (aP - bP);
        }
        default: return 0;
      }
    });
    return sorted;
  }, [rows, sortColumn, sortDirection]);

  if (rows.length === 0) return null;

  const visibleRows = showAll ? sortedRows : sortedRows.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = sortedRows.length - visibleRows.length;

  const totals = rows.reduce(
    (acc, r) => ({
      count: acc.count + r.count,
      income: acc.income + r.income,
      expenditure: acc.expenditure + r.expenditure,
      net: acc.net + r.net,
    }),
    { count: 0, income: 0, expenditure: 0, net: 0 },
  );

  const hasDelta = rows.some((r) => r.delta !== null);

  const tableContent = (
    <>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-xs text-muted-foreground uppercase tracking-wider">
            <th className="text-left px-4 py-2 font-medium">
              <button type="button" className="flex items-center hover:text-foreground" onClick={() => toggleSort('activity')}>
                Activity <SortIcon column="activity" sortColumn={sortColumn} sortDirection={sortDirection} />
              </button>
            </th>
            <th className="text-right px-4 py-2 font-medium">
              <button type="button" className="flex items-center justify-end hover:text-foreground ml-auto" onClick={() => toggleSort('income')}>
                Income <SortIcon column="income" sortColumn={sortColumn} sortDirection={sortDirection} />
              </button>
            </th>
            <th className="text-right px-4 py-2 font-medium">
              <button type="button" className="flex items-center justify-end hover:text-foreground ml-auto" onClick={() => toggleSort('expenditure')}>
                Expenses <SortIcon column="expenditure" sortColumn={sortColumn} sortDirection={sortDirection} />
              </button>
            </th>
            <th className="text-right px-4 py-2 font-medium">
              <button type="button" className="flex items-center justify-end hover:text-foreground ml-auto" onClick={() => toggleSort('net')}>
                Net <SortIcon column="net" sortColumn={sortColumn} sortDirection={sortDirection} />
              </button>
            </th>
            {hasDelta && (
              <th className="text-right px-4 py-2 font-medium">
                <button type="button" className="flex items-center justify-end hover:text-foreground ml-auto" onClick={() => toggleSort('change')}>
                  Change <SortIcon column="change" sortColumn={sortColumn} sortDirection={sortDirection} />
                </button>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((r, idx) => {
            const rowBg = idx % 2 === 0 ? '' : 'bg-surface-inset/40';
            return (
              <tr key={r.activity} className={`${rowBg} hover:bg-fidra-teal/5 transition-colors`}>
                <td className="px-4 py-2.5 font-medium">
                  {r.activity}
                  <StatusBadge status={r.status} />
                </td>
                <td className="text-right px-4 py-2.5 tabular-nums">{formatCurrency(r.income)}</td>
                <td className="text-right px-4 py-2.5 tabular-nums text-muted-foreground">
                  ({formatCurrency(r.expenditure)})
                </td>
                <td
                  className={`text-right px-4 py-2.5 tabular-nums font-medium ${r.net >= 0 ? 'text-fidra-positive' : 'text-fidra-negative'}`}
                >
                  {r.net >= 0 ? '+' : '-'}{formatCurrency(Math.abs(r.net))}
                </td>
                {hasDelta && (
                  <td className={`text-right px-4 py-2.5 tabular-nums text-xs ${r.delta && Math.abs(r.delta.percent) >= 25 ? (r.delta.percent >= 0 ? 'text-fidra-positive font-semibold' : 'text-fidra-negative font-semibold') : 'text-muted-foreground'}`}>
                    {r.delta
                      ? `${r.delta.percent >= 0 ? '+' : ''}${Math.round(r.delta.percent)}%`
                      : ''}
                  </td>
                )}
              </tr>
            );
          })}
          <tr className="font-semibold border-t border-border-subtle">
            <td className="px-4 py-2.5">Total</td>
            <td className="text-right px-4 py-2.5 tabular-nums">
              {formatCurrency(totals.income)}
            </td>
            <td className="text-right px-4 py-2.5 tabular-nums text-muted-foreground">
              ({formatCurrency(totals.expenditure)})
            </td>
            <td
              className={`text-right px-4 py-2.5 tabular-nums ${totals.net >= 0 ? 'text-fidra-positive' : 'text-fidra-negative'}`}
            >
              {totals.net >= 0 ? '+' : '-'}{formatCurrency(Math.abs(totals.net))}
            </td>
            {hasDelta && <td />}
          </tr>
        </tbody>
      </table>
      {hiddenCount > 0 && !showAll && (
        <div className="px-4 py-2 border-t border-border-subtle">
          <button type="button" className="text-xs text-fidra-teal hover:underline" onClick={() => setShowAll(true)}>
            Show all {sortedRows.length} activities
          </button>
        </div>
      )}
      {showAll && rows.length > DEFAULT_VISIBLE && (
        <div className="px-4 py-2 border-t border-border-subtle">
          <button type="button" className="text-xs text-fidra-teal hover:underline" onClick={() => setShowAll(false)}>
            Show top {DEFAULT_VISIBLE}
          </button>
        </div>
      )}
    </>
  );

  // Non-collapsible: wrap in a card
  if (!collapsible) {
    return (
      <div className="rounded-lg bg-card border border-border-subtle">
        <div className="px-4 py-3 border-b border-border-subtle">
          <h3 className="text-sm font-display font-medium text-muted-foreground">{title}</h3>
        </div>
        {tableContent}
      </div>
    );
  }

  // Collapsible: section with toggle
  return (
    <section>
      <button
        type="button"
        className="flex items-center gap-2 mb-3 hover:text-fidra-teal transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        <h2 className="text-base font-display font-semibold">{title}</h2>
      </button>
      {!collapsed && (
        <div className="rounded-lg bg-card border border-border-subtle">
          {tableContent}
        </div>
      )}
    </section>
  );
}
