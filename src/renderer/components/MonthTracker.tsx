import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatCurrency } from '@/lib/format';

export interface MonthTrackerActivity {
  rawActivity: string;
  displayTitle: string;
  startDay: number | null;  // 1–31, null = undated
  endDay: number | null;    // 1–31, null = same as startDay (single day)
  imprecise?: boolean;      // true for month/year precision — renders dashed
  color: 'teal' | 'amber' | 'salmon';
  status: 'Planned' | 'Active' | 'Complete';
  net: number;
}

interface MonthTrackerProps {
  year: number;
  month: number; // 1–12
  activities: MonthTrackerActivity[];
  selectedActivity: string | null;
  onActivityClick: (rawActivity: string) => void;
  onActivityDoubleClick: (rawActivity: string) => void;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const COLOR_DOT = {
  teal: 'bg-[#89B0AE]',
  amber: 'bg-[#D4A03C]',
  salmon: 'bg-[#C07A72]',
} as const;

const COLOR_RING = {
  teal: 'ring-[#89B0AE]/50',
  amber: 'ring-[#D4A03C]/50',
  salmon: 'ring-[#C07A72]/50',
} as const;

// Active/precise bars: light fill + dashed border (previously the imprecise look)
const COLOR_BG_ACTIVE = {
  teal: 'bg-[#89B0AE]/20',
  amber: 'bg-[#D4A03C]/20',
  salmon: 'bg-[#C07A72]/20',
} as const;

const COLOR_BORDER_ACTIVE = {
  teal: 'border-[#89B0AE]/60',
  amber: 'border-[#D4A03C]/60',
  salmon: 'border-[#C07A72]/60',
} as const;

const COLOR_TEXT_ACTIVE = {
  teal: 'text-[#89B0AE]',
  amber: 'text-[#D4A03C]',
  salmon: 'text-[#C07A72]',
} as const;

// Imprecise/multi-month bars: thin line with oblique ticks
const COLOR_LINE_RAW = {
  teal: '#89B0AE',
  amber: '#D4A03C',
  salmon: '#C07A72',
} as const;

interface SpanSegment {
  activity: MonthTrackerActivity;
  startCol: number;  // 0–6 within the week
  endCol: number;    // 0–6 within the week
  isStart: boolean;  // true if this segment contains the activity's actual start day
  isEnd: boolean;    // true if this segment contains the activity's actual end day
  lane: number;
}

function buildWeekSegments(
  activities: MonthTrackerActivity[],
  weekStartDay: number,  // first calendar day in this week row (can be < 1)
  daysInMonth: number,
): SpanSegment[] {
  const weekEndDay = weekStartDay + 6;

  // Collect activities that intersect this week
  const candidates: { activity: MonthTrackerActivity; startCol: number; endCol: number; isStart: boolean; isEnd: boolean }[] = [];

  for (const a of activities) {
    if (a.startDay === null) continue;
    const aStart = a.startDay;
    const aEnd = a.endDay ?? a.startDay;
    // Does this activity overlap with this week?
    if (aEnd < weekStartDay || aStart > weekEndDay) continue;
    // Clamp to week boundaries
    const clampedStart = Math.max(aStart, weekStartDay);
    const clampedEnd = Math.min(aEnd, weekEndDay, daysInMonth);
    // Also clamp to valid days (1..daysInMonth)
    if (clampedStart > daysInMonth || clampedEnd < 1) continue;
    const startCol = Math.max(clampedStart - weekStartDay, 0);
    const endCol = Math.min(clampedEnd - weekStartDay, 6);

    candidates.push({
      activity: a,
      startCol,
      endCol,
      isStart: aStart >= weekStartDay,
      isEnd: aEnd <= weekEndDay,
    });
  }

  // Sort by start column then by span width (wider first for nicer stacking)
  candidates.sort((a, b) => a.startCol - b.startCol || (b.endCol - b.startCol) - (a.endCol - a.startCol));

  // Assign lanes (greedy, first-fit)
  const lanes: number[] = []; // lanes[i] = last endCol used in lane i
  const segments: SpanSegment[] = [];

  for (const c of candidates) {
    let lane = -1;
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] < c.startCol) {
        lane = i;
        break;
      }
    }
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(-1);
    }
    lanes[lane] = c.endCol;
    segments.push({ ...c, lane });
  }

  return segments;
}

export function MonthTracker({
  year,
  month,
  activities,
  selectedActivity,
  onActivityClick,
  onActivityDoubleClick,
}: MonthTrackerProps) {
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const todayDay = isCurrentMonth ? today.getDate() : -1;

  const { daysInMonth, offset } = useMemo(() => {
    const days = new Date(year, month, 0).getDate();
    // Monday-start: 0=Mon … 6=Sun
    const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7;
    return { daysInMonth: days, offset: firstDow };
  }, [year, month]);

  // Separate dated vs undated
  const { dated, undated } = useMemo(() => {
    const d: MonthTrackerActivity[] = [];
    const u: MonthTrackerActivity[] = [];
    for (const a of activities) {
      if (a.startDay !== null && a.startDay >= 1 && a.startDay <= daysInMonth) {
        d.push(a);
      } else {
        u.push(a);
      }
    }
    return { dated: d, undated: u };
  }, [activities, daysInMonth]);

  // Build week rows
  const weeks = useMemo(() => {
    const totalCells = offset + daysInMonth;
    const rowCount = Math.ceil(totalCells / 7);
    const result: { weekStartDay: number; segments: SpanSegment[] }[] = [];

    for (let row = 0; row < rowCount; row++) {
      const weekStartDay = row * 7 - offset + 1;
      const segments = buildWeekSegments(dated, weekStartDay, daysInMonth);
      result.push({ weekStartDay, segments });
    }
    return result;
  }, [dated, offset, daysInMonth]);

  const LANE_HEIGHT = 18;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="rounded-lg bg-card border border-border-subtle p-3 flex flex-col min-h-0">
        <h3 className="text-sm font-display font-medium text-muted-foreground mb-2 shrink-0">
          Month Tracker
        </h3>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 gap-px mb-1 shrink-0">
          {DAY_LABELS.map((d) => (
            <div key={d} className="text-[10px] font-medium text-muted-foreground text-center py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid — week rows (scrollable when constrained) */}
        <div className="bg-border-subtle/40 rounded overflow-auto flex-1 min-h-0" style={{ display: 'grid', gap: '1px', gridAutoRows: '1fr' }}>
          {weeks.map(({ weekStartDay, segments }, rowIdx) => {
            const maxLane = segments.length > 0
              ? Math.max(...segments.map((s) => s.lane)) + 1
              : 0;
            const laneAreaHeight = maxLane * LANE_HEIGHT;

            return (
              <div key={rowIdx} className="relative flex flex-col">
                {/* Activity span bars */}
                {laneAreaHeight > 0 && (
                  <div className="relative grid grid-cols-7 shrink-0" style={{ height: laneAreaHeight }}>
                    {/* Invisible column grid for alignment */}
                    {Array.from({ length: 7 }, (_, col) => {
                      const dayNum = weekStartDay + col;
                      const isValid = dayNum >= 1 && dayNum <= daysInMonth;
                      return (
                        <div key={col} className={isValid ? 'bg-card' : 'bg-muted/50 dark:bg-muted/30'} />
                      );
                    })}
                    {/* Span bars overlaid */}
                    {segments.map((seg) => {
                      const isSelected = selectedActivity === seg.activity.rawActivity;
                      const leftPct = (seg.startCol / 7) * 100;
                      const widthPct = ((seg.endCol - seg.startCol + 1) / 7) * 100;
                      const imp = seg.activity.imprecise;
                      const { color } = seg.activity;

                      // Imprecise bars: top line with oblique ticks above text, no line before text
                      if (imp) {
                        const lineColor = COLOR_LINE_RAW[color];
                        const lineThickness = 2;
                        const tickPattern = `repeating-linear-gradient(
                          -55deg,
                          transparent,
                          transparent 4px,
                          ${lineColor}90 4px,
                          ${lineColor}90 5px
                        )`;
                        return (
                          <Tooltip key={`${seg.activity.rawActivity}-${rowIdx}`}>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="absolute cursor-pointer"
                                style={{
                                  left: `${leftPct}%`,
                                  width: `${widthPct}%`,
                                  top: seg.lane * LANE_HEIGHT + 1,
                                  height: LANE_HEIGHT - 2,
                                }}
                                onClick={(e) => { e.stopPropagation(); onActivityClick(seg.activity.rawActivity); }}
                                onDoubleClick={(e) => { e.stopPropagation(); onActivityDoubleClick(seg.activity.rawActivity); }}
                              >
                                {/* Line spans full width at top */}
                                <span
                                  className="absolute top-0 left-0 w-full"
                                  style={{
                                    height: lineThickness,
                                    backgroundImage: tickPattern,
                                    backgroundColor: `${lineColor}50`,
                                  }}
                                />
                                {/* Text below the line, offset so dashes are visible before it */}
                                {seg.isStart && (
                                  <span
                                    className={cn(
                                      'absolute text-[9px] leading-none font-medium truncate max-w-[70%]',
                                      isSelected && 'underline decoration-1 underline-offset-2',
                                    )}
                                    style={{ color: lineColor, top: lineThickness + 2, left: 8 }}
                                  >
                                    {seg.activity.displayTitle}
                                  </span>
                                )}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              <p className="font-medium">{seg.activity.displayTitle}</p>
                              <p className="text-muted-foreground">
                                {seg.activity.status} · Net: {formatNet(seg.activity.net)}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        );
                      }

                      // Precise bars: Complete = solid, Active/Planned = light fill + dashed border
                      const isComplete = seg.activity.status === 'Complete';
                      return (
                        <Tooltip key={`${seg.activity.rawActivity}-${rowIdx}`}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                'absolute flex items-center px-1 cursor-pointer text-[9px] leading-none font-medium truncate',
                                isComplete
                                  ? [COLOR_DOT[color], 'text-white']
                                  : [COLOR_BG_ACTIVE[color], 'border border-dashed', COLOR_BORDER_ACTIVE[color], COLOR_TEXT_ACTIVE[color]],
                                seg.isStart && seg.isEnd && 'rounded',
                                seg.isStart && !seg.isEnd && 'rounded-l',
                                !seg.isStart && seg.isEnd && 'rounded-r',
                                !seg.isStart && !seg.isEnd && 'rounded-none',
                                isSelected && 'ring-2',
                                isSelected && COLOR_RING[color],
                              )}
                              style={{
                                left: `${leftPct}%`,
                                width: `${widthPct}%`,
                                top: seg.lane * LANE_HEIGHT + 1,
                                height: LANE_HEIGHT - 2,
                              }}
                              onClick={(e) => { e.stopPropagation(); onActivityClick(seg.activity.rawActivity); }}
                              onDoubleClick={(e) => { e.stopPropagation(); onActivityDoubleClick(seg.activity.rawActivity); }}
                            >
                              {seg.isStart && seg.activity.displayTitle}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            <p className="font-medium">{seg.activity.displayTitle}</p>
                            <p className="text-muted-foreground">
                              {seg.activity.status} · Net: {formatNet(seg.activity.net)}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                )}

                {/* Day number cells */}
                <div className="grid grid-cols-7 gap-px flex-1">
                  {Array.from({ length: 7 }, (_, col) => {
                    const dayNum = weekStartDay + col;
                    const isValid = dayNum >= 1 && dayNum <= daysInMonth;
                    const isToday = isCurrentMonth && dayNum === todayDay;

                    return (
                      <div
                        key={col}
                        className={cn(
                          'min-h-6 px-1 flex items-end pb-0.5',
                          isValid ? 'bg-card' : 'bg-muted/50 dark:bg-muted/30',
                          isToday && 'ring-2 ring-inset ring-fidra-teal/40',
                        )}
                      >
                        {isValid && (
                          <span className={cn(
                            'text-[10px] leading-none text-muted-foreground',
                            isToday && 'font-bold text-fidra-teal',
                          )}>
                            {dayNum}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Undated lane */}
        {undated.length > 0 && (
          <div className="mt-2.5 pt-2.5 border-t border-border-subtle">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Activities
            </span>
            <div className="flex flex-wrap gap-1 mt-1">
              {undated.map((a) => (
                <UndatedChip
                  key={a.rawActivity}
                  activity={a}
                  isSelected={selectedActivity === a.rawActivity}
                  onClick={onActivityClick}
                  onDoubleClick={onActivityDoubleClick}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function formatNet(n: number) {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${formatCurrency(n)}`;
}

function UndatedChip({
  activity,
  isSelected,
  onClick,
  onDoubleClick,
}: {
  activity: MonthTrackerActivity;
  isSelected: boolean;
  onClick: (raw: string) => void;
  onDoubleClick: (raw: string) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1 min-w-0 cursor-pointer rounded px-1.5 py-0.5',
            isSelected && 'ring-2',
            isSelected && COLOR_RING[activity.color],
          )}
          onClick={(e) => { e.stopPropagation(); onClick(activity.rawActivity); }}
          onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(activity.rawActivity); }}
        >
          <span className={cn('h-1.5 w-3 rounded-full shrink-0', COLOR_DOT[activity.color])} />
          <span className="text-[9px] truncate max-w-[100px]">
            {activity.displayTitle}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <p className="font-medium">{activity.displayTitle}</p>
        <p className="text-muted-foreground">
          {activity.status} · Net: {formatNet(activity.net)}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
