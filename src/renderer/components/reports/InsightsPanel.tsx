import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import type { WhatChangedItem, KeyFact } from '@/services/report-insights';

interface InsightsPanelProps {
  whatChanged: WhatChangedItem[];
  keyFacts: KeyFact[];
}

export function InsightsPanel({ whatChanged, keyFacts }: InsightsPanelProps) {
  if (whatChanged.length === 0 && keyFacts.length === 0) return null;

  const hasChanged = whatChanged.length > 0;

  return (
    <div className={`grid gap-4 ${hasChanged ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {hasChanged && (
        <div className="rounded-lg bg-card border border-border-subtle p-4">
          <h3 className="text-sm font-display font-medium text-muted-foreground mb-3">
            What Changed
          </h3>
          <div className="space-y-2.5">
            {whatChanged.map((item, i) => (
              <div key={i} className="flex items-center gap-2.5">
                {item.direction === 'up' ? (
                  <TrendingUp className="h-3.5 w-3.5 shrink-0 text-fidra-positive" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5 shrink-0 text-fidra-negative" />
                )}
                <span className="text-sm">{item.label}</span>
                <span className={`ml-auto text-sm tabular-nums font-medium ${item.delta >= 0 ? 'text-fidra-positive' : 'text-fidra-negative'}`}>
                  {item.delta >= 0 ? '+' : ''}{formatCurrency(item.delta)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {keyFacts.length > 0 && (
        <div className="rounded-lg bg-card border border-border-subtle p-4">
          <h3 className="text-sm font-display font-medium text-muted-foreground mb-3">
            Key Facts
          </h3>
          <div className="space-y-3">
            {keyFacts.map((fact, i) => (
              <div key={i}>
                <p className="text-xs text-muted-foreground">{fact.label}</p>
                <p className="text-sm font-medium">{fact.value}</p>
                {fact.detail && (
                  <p className="text-xs text-muted-foreground">{fact.detail}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
