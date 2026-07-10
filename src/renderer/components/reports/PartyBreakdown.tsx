import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import type { PartyBreakdownRow } from '@/services/report-analysis';

const DEFAULT_VISIBLE = 8;

type SortColumn = 'party' | 'count' | 'income' | 'expenditure' | 'net';
type SortDirection = 'asc' | 'desc';

function SortIcon({ column, sortColumn, sortDirection }: { column: SortColumn; sortColumn: SortColumn; sortDirection: SortDirection }) {
  if (column !== sortColumn) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
  return sortDirection === 'asc'
    ? <ArrowUp className="h-3 w-3 ml-1" />
    : <ArrowDown className="h-3 w-3 ml-1" />;
}

interface PartyBreakdownProps {
  rows: PartyBreakdownRow[];
}

export function PartyBreakdown({ rows }: PartyBreakdownProps) {
  const [collapsed, setCollapsed] = useState(true);
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
        case 'party': return dir * a.party.localeCompare(b.party);
        case 'count': return dir * (a.count - b.count);
        case 'income': return dir * (a.income - b.income);
        case 'expenditure': return dir * (a.expenditure - b.expenditure);
        case 'net': return dir * (a.net - b.net);
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

  return (
    <section>
      <button
        type="button"
        className="flex items-center gap-2 mb-3 hover:text-fidra-teal transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        <h2 className="text-base font-display font-semibold">Party Breakdown</h2>
      </button>
      {!collapsed && (
        <div className="rounded-lg border border-border-subtle">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-xs text-muted-foreground uppercase tracking-wider">
                <th className="text-left px-4 py-2 font-medium">
                  <button type="button" className="flex items-center hover:text-foreground" onClick={() => toggleSort('party')}>
                    Party <SortIcon column="party" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </button>
                </th>
                <th className="text-right px-4 py-2 font-medium">
                  <button type="button" className="flex items-center justify-end hover:text-foreground ml-auto" onClick={() => toggleSort('count')}>
                    Count <SortIcon column="count" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </button>
                </th>
                <th className="text-right px-4 py-2 font-medium">
                  <button type="button" className="flex items-center justify-end hover:text-foreground ml-auto" onClick={() => toggleSort('income')}>
                    Income <SortIcon column="income" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </button>
                </th>
                <th className="text-right px-4 py-2 font-medium">
                  <button type="button" className="flex items-center justify-end hover:text-foreground ml-auto" onClick={() => toggleSort('expenditure')}>
                    Expenditure <SortIcon column="expenditure" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </button>
                </th>
                <th className="text-right px-4 py-2 font-medium">
                  <button type="button" className="flex items-center justify-end hover:text-foreground ml-auto" onClick={() => toggleSort('net')}>
                    Net <SortIcon column="net" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r, idx) => {
                const rowBg = idx % 2 === 0 ? 'bg-[#EEEEE9] dark:bg-[#2A2D32]' : 'bg-[#E8E8E3] dark:bg-[#252830]';
                return (
                  <tr key={r.party} className={`${rowBg} hover:bg-fidra-teal/5 transition-colors`}>
                    <td className="px-4 py-2 font-medium">{r.party}</td>
                    <td className="text-right px-4 py-2 tabular-nums">{r.count}</td>
                    <td className="text-right px-4 py-2 tabular-nums">{formatCurrency(r.income)}</td>
                    <td className="text-right px-4 py-2 tabular-nums">({formatCurrency(r.expenditure)})</td>
                    <td className={`text-right px-4 py-2 tabular-nums font-medium ${r.net >= 0 ? 'text-fidra-positive' : 'text-fidra-negative'}`}>
                      {r.net >= 0 ? '' : '-'}{formatCurrency(Math.abs(r.net))}
                    </td>
                  </tr>
                );
              })}
              <tr className="font-semibold border-t-2 border-border-subtle">
                <td className="px-4 py-2">Total</td>
                <td className="text-right px-4 py-2 tabular-nums">{totals.count}</td>
                <td className="text-right px-4 py-2 tabular-nums">{formatCurrency(totals.income)}</td>
                <td className="text-right px-4 py-2 tabular-nums">({formatCurrency(totals.expenditure)})</td>
                <td className={`text-right px-4 py-2 tabular-nums ${totals.net >= 0 ? 'text-fidra-positive' : 'text-fidra-negative'}`}>
                  {totals.net >= 0 ? '' : '-'}{formatCurrency(Math.abs(totals.net))}
                </td>
              </tr>
            </tbody>
          </table>
          {hiddenCount > 0 && !showAll && (
            <div className="px-4 py-2 border-t border-border-subtle">
              <button type="button" className="text-xs text-fidra-teal hover:underline" onClick={() => setShowAll(true)}>
                Show all {sortedRows.length} parties
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
        </div>
      )}
    </section>
  );
}
