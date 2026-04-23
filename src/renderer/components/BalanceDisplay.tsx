import { useMemo, useEffect, useRef, useState } from 'react';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { TransactionRow } from '../../shared/ipc-types';

const TICK_DURATION = 350; // ms

function useAnimatedNumber(target: number): number {
  const [display, setDisplay] = useState(target);
  const rafRef = useRef<number>(0);
  const startRef = useRef({ value: target, time: 0 });
  const prevTarget = useRef(target);

  useEffect(() => {
    if (target === prevTarget.current) return;
    const from = display;
    prevTarget.current = target;
    startRef.current = { value: from, time: performance.now() };

    const tick = (now: number) => {
      const elapsed = now - startRef.current.time;
      const t = Math.min(elapsed / TICK_DURATION, 1);
      // ease-out cubic
      const eased = 1 - (1 - t) ** 3;
      const current = startRef.current.value + (target - startRef.current.value) * eased;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(target);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return display;
}

function AnimatedCurrency({ value, prefix }: { value: number; prefix?: string }) {
  const animated = useAnimatedNumber(value);
  return <>{prefix}{formatCurrency(animated)}</>;
}

interface BalanceDisplayProps {
  balance: number;
  pending: number;
  projected?: number | null;
  selectedTransactions?: TransactionRow[];
}

function formatShortDate(iso: string): string {
  if (!iso) return '';
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatFullDate(iso: string): string {
  if (!iso) return '';
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function BalanceDisplay({ balance, pending, projected, selectedTransactions = [] }: BalanceDisplayProps) {
  const available = balance - pending;

  const selectionSummary = useMemo(() => {
    if (selectedTransactions.length === 0) return null;

    // Total: income positive, expense negative
    let total = 0;
    for (const t of selectedTransactions) {
      const amount = parseFloat(t.amount);
      total += t.type === 'income' ? amount : -amount;
    }

    // Description
    const descriptions = new Set(selectedTransactions.map((t) => t.description).filter(Boolean));
    const description = descriptions.size === 1
      ? [...descriptions][0]
      : descriptions.size > 1
        ? 'Various items'
        : null;

    // Date range
    const dates = [...new Set(selectedTransactions.map((t) => t.date))].sort();
    const dateDisplay = dates.length === 1
      ? formatFullDate(dates[0])
      : `${formatShortDate(dates[0])} \u2013 ${formatFullDate(dates[dates.length - 1])}`;

    // Party
    const parties = new Set(selectedTransactions.map((t) => t.party).filter(Boolean));
    const party = parties.size === 1
      ? [...parties][0]
      : parties.size > 1
        ? 'Various parties'
        : null;

    // Notes (only shown for single selection)
    const notes = selectedTransactions.length === 1
      ? selectedTransactions[0].notes ?? null
      : null;

    return { total, description, dateDisplay, party, notes, count: selectedTransactions.length };
  }, [selectedTransactions]);

  return (
    <div className="flex flex-col gap-4">
      {/* Balance — hero section with teal accent */}
      <div className="border-t-[3px] border-t-fidra-teal pt-3">
        <p className="text-xs font-display font-medium uppercase tracking-[0.05em] text-muted-foreground mb-1">
          Balance
        </p>
        <p className={cn(
          'text-2xl font-display font-bold tabular-nums',
          balance >= 0 ? 'text-foreground' : 'text-fidra-negative'
        )}>
          <AnimatedCurrency value={balance} />
        </p>
      </div>

      {pending > 0 && (
        <div>
          <p className="text-xs font-display font-medium uppercase tracking-[0.05em] text-muted-foreground mb-1">
            Pending
          </p>
          <p className="text-lg font-display font-semibold tabular-nums text-fidra-warning">
            <AnimatedCurrency value={pending} />
          </p>
        </div>
      )}

      {projected != null && (
        <div>
          <p className="text-xs font-display font-medium uppercase tracking-[0.05em] text-fidra-teal mb-1">
            Projected
          </p>
          <p className={cn(
            'text-lg font-display font-semibold tabular-nums',
            projected >= 0 ? 'text-fidra-teal' : 'text-fidra-negative'
          )}>
            <AnimatedCurrency value={projected} />
          </p>
        </div>
      )}

      <div>
        <p className="text-xs font-display font-medium uppercase tracking-[0.05em] text-muted-foreground mb-1">
          Available
        </p>
        <p className={cn(
          'text-lg font-display font-semibold tabular-nums',
          available >= 0 ? 'text-fidra-positive' : 'text-fidra-negative'
        )}>
          <AnimatedCurrency value={available} />
        </p>
      </div>

      {/* Selection summary */}
      {selectionSummary && (
        <div className="border-t border-border-subtle pt-3">
          <p className="text-xs font-display font-medium uppercase tracking-[0.05em] text-muted-foreground mb-2">
            Selection
          </p>
          <p className={cn(
            'text-xl font-display font-bold tabular-nums',
            selectionSummary.total > 0 ? 'text-fidra-positive' : selectionSummary.total < 0 ? 'text-fidra-negative' : 'text-foreground'
          )}>
            {selectionSummary.total > 0 ? '+' : ''}{formatCurrency(selectionSummary.total)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {selectionSummary.count} transaction{selectionSummary.count !== 1 ? 's' : ''}
          </p>
          {selectionSummary.description && (
            <p className="text-xs text-foreground mt-2 truncate" title={selectionSummary.description}>
              {selectionSummary.description}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">{selectionSummary.dateDisplay}</p>
          {selectionSummary.party && (
            <p className="text-xs text-muted-foreground mt-1 truncate" title={selectionSummary.party}>
              {selectionSummary.party}
            </p>
          )}
          {selectionSummary.notes && (
            <p className="text-xs text-muted-foreground mt-2 whitespace-pre-wrap break-words" title={selectionSummary.notes}>
              {selectionSummary.notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
