import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import { formatDate } from '@/lib/format';
import type { DescriptionBreakdownRow } from '@/services/report-analysis';

type SortColumn = 'description' | 'count' | 'totalAmount' | 'avgAmount';
type SortDirection = 'asc' | 'desc';

function SortIcon({ column, sortColumn, sortDirection }: { column: SortColumn; sortColumn: SortColumn; sortDirection: SortDirection }) {
  if (column !== sortColumn) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
  return sortDirection === 'asc'
    ? <ArrowUp className="h-3 w-3 ml-1" />
    : <ArrowDown className="h-3 w-3 ml-1" />;
}

function TypeBadge({ type }: { type: 'income' | 'expense' | 'mixed' }) {
  const styles = {
    income: 'bg-fidra-positive/15 text-fidra-positive',
    expense: 'bg-fidra-negative/15 text-fidra-negative',
    mixed: 'bg-fidra-warning/15 text-fidra-warning',
  };
  return (
    <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${styles[type]}`}>
      {type}
    </span>
  );
}

function FlagBadges({ row }: { row: DescriptionBreakdownRow }) {
  return (
    <span className="flex items-center gap-1">
      {row.recurring && (
        <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-fidra-teal/15 text-fidra-teal">
          Recurring
        </span>
      )}
      {row.highValue && (
        <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-fidra-warning/15 text-fidra-warning">
          High Value
        </span>
      )}
      {row.status === 'new' && (
        <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-fidra-positive/15 text-fidra-positive">
          New
        </span>
      )}
    </span>
  );
}

interface DescriptionBreakdownProps {
  rows: DescriptionBreakdownRow[];
}

export function DescriptionBreakdown({ rows }: DescriptionBreakdownProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [expandedDescs, setExpandedDescs] = useState<Set<string>>(new Set());
  const [sortColumn, setSortColumn] = useState<SortColumn>('totalAmount');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

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
        case 'description': return dir * a.description.localeCompare(b.description);
        case 'count': return dir * (a.count - b.count);
        case 'totalAmount': return dir * (a.totalAmount - b.totalAmount);
        case 'avgAmount': return dir * (a.avgAmount - b.avgAmount);
        default: return 0;
      }
    });
    return sorted;
  }, [rows, sortColumn, sortDirection]);

  if (rows.length === 0) return null;

  // By default only show recurring or high-value or new; "Show all" expands to full list
  const visibleRows = showAll ? sortedRows : sortedRows.filter((r) => r.recurring || r.highValue || r.status === 'new');
  const hiddenCount = sortedRows.length - visibleRows.length;

  const toggleDesc = (desc: string) => {
    setExpandedDescs((prev) => {
      const next = new Set(prev);
      if (next.has(desc)) next.delete(desc);
      else next.add(desc);
      return next;
    });
  };

  return (
    <section>
      <button
        type="button"
        className="flex items-center gap-2 mb-3 hover:text-fidra-teal transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
        <h2 className="text-base font-display font-semibold">Description Breakdown</h2>
        <span className="text-xs text-muted-foreground font-normal">
          ({rows.filter((r) => r.recurring).length} recurring, {rows.filter((r) => r.highValue).length} high-value)
        </span>
      </button>
      {!collapsed && (
        <div className="rounded-lg border border-border-subtle">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-xs text-muted-foreground uppercase tracking-wider">
                <th className="text-left px-4 py-2 font-medium">
                  <button type="button" className="flex items-center hover:text-foreground" onClick={() => toggleSort('description')}>
                    Description <SortIcon column="description" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </button>
                </th>
                <th className="text-right px-4 py-2 font-medium">
                  <button type="button" className="flex items-center justify-end hover:text-foreground ml-auto" onClick={() => toggleSort('count')}>
                    Count <SortIcon column="count" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </button>
                </th>
                <th className="text-right px-4 py-2 font-medium">
                  <button type="button" className="flex items-center justify-end hover:text-foreground ml-auto" onClick={() => toggleSort('totalAmount')}>
                    Total <SortIcon column="totalAmount" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </button>
                </th>
                <th className="text-right px-4 py-2 font-medium">
                  <button type="button" className="flex items-center justify-end hover:text-foreground ml-auto" onClick={() => toggleSort('avgAmount')}>
                    Avg <SortIcon column="avgAmount" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </button>
                </th>
                <th className="text-center px-4 py-2 font-medium">Type</th>
                <th className="text-right px-4 py-2 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r, idx) => {
                const isExpanded = expandedDescs.has(r.description);
                const rowBg = idx % 2 === 0 ? 'bg-[#EEEEE9] dark:bg-[#2A2D32]' : 'bg-[#E8E8E3] dark:bg-[#252830]';
                return (
                  <tr key={r.description} className={`${rowBg} hover:bg-fidra-teal/5 transition-colors`}>
                    <td className="px-4 py-2">
                      <div className="flex flex-col">
                        <button
                          type="button"
                          className="text-left font-medium flex items-center hover:text-fidra-teal cursor-pointer"
                          onClick={() => toggleDesc(r.description)}
                        >
                          <span className="w-4 shrink-0 text-muted-foreground">
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </span>
                          {r.description}
                        </button>
                        {isExpanded &&
                          r.transactions.map((t) => (
                            <div
                              key={t.id}
                              className="flex items-center justify-between pl-6 py-0.5 text-xs text-muted-foreground"
                            >
                              <span>{formatDate(t.date)}</span>
                              <span className="tabular-nums">
                                {t.type === 'expense' ? '(' : ''}
                                {formatCurrency(t.amount)}
                                {t.type === 'expense' ? ')' : ''}
                              </span>
                            </div>
                          ))}
                      </div>
                    </td>
                    <td className="text-right px-4 py-2 tabular-nums">{r.count}</td>
                    <td className="text-right px-4 py-2 tabular-nums">
                      {formatCurrency(r.totalAmount)}
                    </td>
                    <td className="text-right px-4 py-2 tabular-nums">
                      {formatCurrency(r.avgAmount)}
                    </td>
                    <td className="text-center px-4 py-2">
                      <TypeBadge type={r.type} />
                    </td>
                    <td className="text-right px-4 py-2">
                      <FlagBadges row={r} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hiddenCount > 0 && !showAll && (
            <div className="px-4 py-2 border-t border-border-subtle">
              <button
                type="button"
                className="text-xs text-fidra-teal hover:underline"
                onClick={() => setShowAll(true)}
              >
                Show all ({hiddenCount} more)
              </button>
            </div>
          )}
          {showAll && hiddenCount > 0 && (
            <div className="px-4 py-2 border-t border-border-subtle">
              <button
                type="button"
                className="text-xs text-fidra-teal hover:underline"
                onClick={() => setShowAll(false)}
              >
                Show flagged only
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
