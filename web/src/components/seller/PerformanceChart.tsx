'use client';

// Wave 5 — daily revenue bar chart for the seller analytics dashboard.
// Pure SVG (no recharts dependency) so it ships without bloat. Renders
// a 30-day grid by default; the parent picks the range and the chart
// stretches to fit. The chart fills missing days with zero bars so the
// X-axis is contiguous.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/utils';
import type { SellerAnalyticsDailyPoint } from '@/types';

interface PerformanceChartProps {
  data: SellerAnalyticsDailyPoint[];
  rangeDays: number;
  className?: string;
}

/**
 * Fills any missing dates between firstDate and today with zero-bar
 * placeholders so the chart shows a continuous X-axis.
 */
function fillGaps(data: SellerAnalyticsDailyPoint[], rangeDays: number): SellerAnalyticsDailyPoint[] {
  const byDate = new Map<string, SellerAnalyticsDailyPoint>();
  data.forEach((p) => byDate.set(p.date, p));

  const out: SellerAnalyticsDailyPoint[] = [];
  const today = new Date();
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const existing = byDate.get(iso);
    out.push(
      existing ?? {
        date: iso,
        gross_cents: 0,
        order_count: 0,
      },
    );
  }
  return out;
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function PerformanceChart({ data, rangeDays, className }: PerformanceChartProps) {
  const filled = fillGaps(data, rangeDays);
  const maxGross = Math.max(...filled.map((d) => d.gross_cents), 1);
  const totalGross = filled.reduce((sum, p) => sum + p.gross_cents, 0);
  const totalOrders = filled.reduce((sum, p) => sum + p.order_count, 0);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-baseline justify-between text-lg">
          <span>Revenue</span>
          <span className="text-sm font-normal text-muted-foreground">
            Last {rangeDays} days
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Top-line stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Gross</p>
            <p className="text-xl font-bold tabular-nums">{formatCents(totalGross)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Orders</p>
            <p className="text-xl font-bold tabular-nums">{totalOrders}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Avg / day</p>
            <p className="text-xl font-bold tabular-nums">
              {formatCents(Math.round(totalGross / Math.max(rangeDays, 1)))}
            </p>
          </div>
        </div>

        {totalOrders === 0 ? (
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed bg-muted/30">
            <p className="text-sm text-muted-foreground">
              No sales yet in the last {rangeDays} days.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Bars row */}
            <div
              className="flex h-40 items-end gap-[2px]"
              role="img"
              aria-label={`Daily revenue for the last ${String(rangeDays)} days, total ${formatCents(totalGross)}`}
            >
              {filled.map((point) => {
                const heightPct = (point.gross_cents / maxGross) * 100;
                return (
                  <div
                    key={point.date}
                    className="group relative flex h-full flex-1 flex-col items-center justify-end"
                  >
                    {/* Tooltip */}
                    {point.gross_cents > 0 ? (
                      <div
                        className={cn(
                          'pointer-events-none absolute -top-1 z-10 -translate-y-full',
                          'rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap shadow-md',
                          'opacity-0 transition-opacity group-hover:opacity-100',
                        )}
                      >
                        <p className="font-semibold">{formatDayLabel(point.date)}</p>
                        <p>{formatCents(point.gross_cents)}</p>
                        <p className="text-muted-foreground">
                          {point.order_count} {point.order_count === 1 ? 'order' : 'orders'}
                        </p>
                      </div>
                    ) : null}
                    <div
                      className={cn(
                        'w-full rounded-t transition-all',
                        point.gross_cents > 0
                          ? 'bg-emerald-500 group-hover:bg-emerald-400'
                          : 'bg-muted',
                      )}
                      style={{ height: `${String(Math.max(heightPct, 1))}%` }}
                    />
                  </div>
                );
              })}
            </div>

            {/* X-axis sample labels (first, middle, last). Skip middle on
                short ranges to avoid overlap on narrow screens. */}
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{formatDayLabel(filled[0]?.date ?? '')}</span>
              {rangeDays >= 14 ? (
                <span>{formatDayLabel(filled[Math.floor(rangeDays / 2)]?.date ?? '')}</span>
              ) : null}
              <span>{formatDayLabel(filled[filled.length - 1]?.date ?? '')}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
