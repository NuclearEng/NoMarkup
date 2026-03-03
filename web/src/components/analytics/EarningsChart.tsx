'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/utils';
import type { EarningsDataPoint } from '@/types';

interface SummaryStatProps {
  label: string;
  value: string;
  subValue?: string;
}

function SummaryStat({ label, value, subValue }: SummaryStatProps) {
  return (
    <div className="text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold">{value}</p>
      {subValue ? (
        <p className="text-xs text-muted-foreground">{subValue}</p>
      ) : null}
    </div>
  );
}

function formatPeriodLabel(periodStart: string): string {
  const date = new Date(periodStart);
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

interface EarningsChartProps {
  data: EarningsDataPoint[];
  totalEarnings: number;
  totalFees: number;
  netEarnings: number;
  totalJobs: number;
  className?: string;
}

export function EarningsChart({
  data,
  totalEarnings,
  totalFees,
  netEarnings,
  totalJobs,
  className,
}: EarningsChartProps) {
  const maxEarnings = Math.max(...data.map((d) => d.earnings_cents), 1);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg">Earnings Overview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SummaryStat
            label="Total Earnings"
            value={formatCents(totalEarnings)}
          />
          <SummaryStat
            label="Total Fees"
            value={formatCents(totalFees)}
          />
          <SummaryStat
            label="Net Earnings"
            value={formatCents(netEarnings)}
          />
          <SummaryStat
            label="Total Jobs"
            value={String(totalJobs)}
          />
        </div>

        {/* Chart */}
        {data.length === 0 ? (
          <div className="flex h-48 items-center justify-center rounded-lg border bg-muted/50">
            <p className="text-sm text-muted-foreground">No earnings data available.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Y-axis labels + bars area */}
            <div className="flex items-end gap-1" style={{ minHeight: '200px' }}>
              {data.map((point) => {
                const earningsHeight =
                  (point.earnings_cents / maxEarnings) * 100;
                const feesHeight =
                  (point.fees_cents / maxEarnings) * 100;

                return (
                  <div
                    key={point.period_start}
                    className="group relative flex flex-1 flex-col items-center justify-end"
                    style={{ height: '200px' }}
                  >
                    {/* Tooltip on hover */}
                    <div
                      className={cn(
                        'pointer-events-none absolute -top-2 z-10 -translate-y-full rounded-md border bg-popover px-2 py-1 text-xs shadow-md',
                        'opacity-0 transition-opacity group-hover:opacity-100',
                      )}
                    >
                      <p className="font-semibold">
                        {formatPeriodLabel(point.period_start)}
                      </p>
                      <p>Earnings: {formatCents(point.earnings_cents)}</p>
                      <p>Fees: {formatCents(point.fees_cents)}</p>
                      <p>Jobs: {String(point.job_count)}</p>
                    </div>

                    {/* Stacked bar: fees on top of net */}
                    <div
                      className="relative w-full overflow-hidden rounded-t"
                      style={{ height: `${String(earningsHeight)}%` }}
                      role="img"
                      aria-label={`${formatPeriodLabel(point.period_start)}: earnings ${formatCents(point.earnings_cents)}, fees ${formatCents(point.fees_cents)}`}
                    >
                      {/* Net earnings portion */}
                      <div
                        className="absolute bottom-0 w-full bg-emerald-500 transition-all"
                        style={{
                          height:
                            earningsHeight > 0
                              ? `${String(((earningsHeight - feesHeight) / earningsHeight) * 100)}%`
                              : '0%',
                        }}
                      />
                      {/* Fees portion */}
                      <div
                        className="absolute top-0 w-full bg-amber-400 transition-all"
                        style={{
                          height:
                            earningsHeight > 0
                              ? `${String((feesHeight / earningsHeight) * 100)}%`
                              : '0%',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* X-axis labels */}
            <div className="flex gap-1">
              {data.map((point) => (
                <div
                  key={point.period_start}
                  className="flex-1 text-center text-[10px] text-muted-foreground"
                >
                  {formatPeriodLabel(point.period_start)}
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-4 pt-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-sm bg-emerald-500" aria-hidden="true" />
                <span>Net Earnings</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-sm bg-amber-400" aria-hidden="true" />
                <span>Fees</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
