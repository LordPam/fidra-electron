import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import type { CategoryBreakdownRow } from '@/services/report-analysis';

const DEFAULT_VISIBLE = 8;

type SortColumn = 'category' | 'count' | 'total' | 'change' | 'pct';
type SortDirection = 'asc' | 'desc';

function SortIcon({ column, sortColumn, sortDirection }: { column: SortColumn; sortColumn: SortColumn; sortDirection: SortDirection }) {
  if (column !== sortColumn) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
  return sortDirection === 'asc'
    ? <ArrowUp className="h-3 w-3 ml-1" />
    : <ArrowDown className="h-3 w-3 ml-1" />;
}

function StatusBadge({ status }: { status: CategoryBreakdownRow['status'] }) {
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

function DeltaCell({ delta }: { delta: { absolute: number; percent: number } | null }) {
  if (!delta) return <td className="text-right px-4 py-2" />;
  const isPositive = delta.percent >= 0;
  const flagged = Math.abs(delta.percent) >= 25;
  return (
    <td className={`text-right px-4 py-2 tabular-nums text-xs ${flagged ? (isPositive ? 'text-fidra-positive font-semibold' : 'text-fidra-negative font-semibold') : 'text-muted-foreground'}`}>
      {isPositive ? '+' : ''}{Math.round(delta.percent)}%
    </td>
  );
}

interface CategoryTableProps {
  title: string;
  rows: CategoryBreakdownRow[];
  barColor: string;
  showParens: boolean;
}

function CategoryTable({ title, rows, barColor, showParens }: CategoryTableProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [sortColumn, setSortColumn] = useState<SortColumn>('total');
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
        case 'category': return dir * a.category.localeCompare(b.category);
        case 'count': return dir * (a.count - b.count);
        case 'total': return dir * (a.total - b.total);
        case 'change': {
          const aP = a.delta?.percent ?? 0;
          const bP = b.delta?.percent ?? 0;
          return dir * (aP - bP);
        }
        case 'pct': return dir * (a.pct - b.pct);
        default: return 0;
      }
    });
    return sorted;
  }, [rows, sortColumn, sortDirection]);

  const visibleRows = showAll ? sortedRows : sortedRows.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = sortedRows.length - visibleRows.length;

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const fmt = (n: number) => (showParens ? `(${formatCurrency(n)})` : formatCurrency(n));
  const grandTotal = rows.reduce((s, r) => s + r.total, 0);
  const totalCount = rows.reduce((s, r) => s + r.count, 0);
  const hasDelta = rows.some((r) => r.delta !== null);

  return (
    <div className="rounded-lg border border-border-subtle">
      <div className="px-4 py-3 border-b border-border-subtle">
        <h3 className="text-sm font-display font-semibold">{title}</h3>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-xs text-muted-foreground uppercase tracking-wider">
            <th className="text-left px-4 py-2 font-medium">
              <button type="button" className="flex items-center hover:text-foreground" onClick={() => toggleSort('category')}>
                Category <SortIcon column="category" sortColumn={sortColumn} sortDirection={sortDirection} />
              </button>
            </th>
            <th className="text-right px-4 py-2 font-medium">
              <button type="button" className="flex items-center justify-end hover:text-foreground ml-auto" onClick={() => toggleSort('count')}>
                Count <SortIcon column="count" sortColumn={sortColumn} sortDirection={sortDirection} />
              </button>
            </th>
            <th className="text-right px-4 py-2 font-medium">
              <button type="button" className="flex items-center justify-end hover:text-foreground ml-auto" onClick={() => toggleSort('total')}>
                Amount <SortIcon column="total" sortColumn={sortColumn} sortDirection={sortDirection} />
              </button>
            </th>
            {hasDelta && (
              <th className="text-right px-4 py-2 font-medium">
                <button type="button" className="flex items-center justify-end hover:text-foreground ml-auto" onClick={() => toggleSort('change')}>
                  Change <SortIcon column="change" sortColumn={sortColumn} sortDirection={sortDirection} />
                </button>
              </th>
            )}
            <th className="text-right px-4 py-2 font-medium w-[140px]">
              <button type="button" className="flex items-center justify-end hover:text-foreground ml-auto" onClick={() => toggleSort('pct')}>
                Share <SortIcon column="pct" sortColumn={sortColumn} sortDirection={sortDirection} />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((r, idx) => {
            const isExpanded = expandedCategories.has(r.category);
            const hasSubItems = r.subItems.length > 1;
            const rowBg = idx % 2 === 0 ? 'bg-[#EEEEE9] dark:bg-[#2A2D32]' : 'bg-[#E8E8E3] dark:bg-[#252830]';
            return (
              <tr key={r.category} className={`${rowBg} hover:bg-fidra-teal/5 transition-colors`}>
                <td className="px-4 py-2">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      className={`text-left font-medium flex items-center ${hasSubItems ? 'hover:text-fidra-teal cursor-pointer' : ''}`}
                      onClick={() => hasSubItems && toggleCategory(r.category)}
                    >
                      {hasSubItems && (
                        <span className="w-4 shrink-0 text-muted-foreground">
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </span>
                      )}
                      {!hasSubItems && <span className="w-4 shrink-0" />}
                      {r.category}
                      <StatusBadge status={r.status} />
                    </button>
                    {isExpanded &&
                      r.subItems.map((sub) => (
                        <div
                          key={sub.description}
                          className="flex items-center justify-between pl-6 py-0.5 text-xs text-muted-foreground"
                        >
                          <span>
                            {sub.description}{' '}
                            <span className="text-muted-foreground/60">({sub.count})</span>
                          </span>
                          <span className="tabular-nums">{fmt(sub.amount)}</span>
                        </div>
                      ))}
                  </div>
                </td>
                <td className="text-right px-4 py-2 tabular-nums">
                  {r.count}
                </td>
                <td className="text-right px-4 py-2 tabular-nums">
                  {fmt(r.total)}
                </td>
                {hasDelta && <DeltaCell delta={r.delta} />}
                <td className="text-right px-4 py-2">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-2 rounded-full bg-muted/50 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(3, Math.round(r.pct))}%`,
                          backgroundColor: barColor,
                        }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
                      {Math.round(r.pct)}%
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
          <tr className="font-semibold border-t-2 border-border-subtle">
            <td className="px-4 py-2">Total</td>
            <td className="text-right px-4 py-2 tabular-nums">{totalCount}</td>
            <td className="text-right px-4 py-2 tabular-nums">{fmt(grandTotal)}</td>
            {hasDelta && <td />}
            <td className="text-right px-4 py-2 text-xs text-muted-foreground">100%</td>
          </tr>
        </tbody>
      </table>
      {hiddenCount > 0 && !showAll && (
        <div className="px-4 py-2 border-t border-border-subtle">
          <button
            type="button"
            className="text-xs text-fidra-teal hover:underline"
            onClick={() => setShowAll(true)}
          >
            Show all {sortedRows.length} categories
          </button>
        </div>
      )}
      {showAll && rows.length > DEFAULT_VISIBLE && (
        <div className="px-4 py-2 border-t border-border-subtle">
          <button
            type="button"
            className="text-xs text-fidra-teal hover:underline"
            onClick={() => setShowAll(false)}
          >
            Show top {DEFAULT_VISIBLE}
          </button>
        </div>
      )}
    </div>
  );
}

interface CategoryBreakdownProps {
  incomeRows: CategoryBreakdownRow[];
  expenseRows: CategoryBreakdownRow[];
}

export function CategoryBreakdown({ incomeRows, expenseRows }: CategoryBreakdownProps) {
  const [collapsed, setCollapsed] = useState(true);

  if (incomeRows.length === 0 && expenseRows.length === 0) return null;

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
        <h2 className="text-base font-display font-semibold">Category Breakdown</h2>
      </button>
      {!collapsed && (
        <div className="grid grid-cols-2 gap-4">
          <CategoryTable
            title="Income by Category"
            rows={incomeRows}
            barColor="#89B0AE"
            showParens={false}
          />
          <CategoryTable
            title="Expenditure by Category"
            rows={expenseRows}
            barColor="#C07A72"
            showParens={true}
          />
        </div>
      )}
    </section>
  );
}
