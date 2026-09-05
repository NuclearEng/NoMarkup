'use client';

// Wave 5 — power-seller analytics dashboard. Renders daily revenue
// chart, sell-through pill, average sale price, top categories, and a
// CSV-export button.
//
// Data source: useSellerAnalytics() against
// `GET /api/v1/me/seller-analytics?range=Xd`. CSV export uses the
// authenticated download helper since the export route returns text/csv
// behind the bearer-token gate.

import { Download, FileBarChart, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { PerformanceChart } from '@/components/seller/PerformanceChart';
import { TopCategoriesChart } from '@/components/seller/TopCategoriesChart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useSellerAnalytics,
  type SellerAnalyticsRange,
} from '@/hooks/useSellerAnalytics';
import { downloadAuthenticated } from '@/lib/api';
import { formatCents } from '@/lib/utils';

const RANGES: ReadonlyArray<{ value: SellerAnalyticsRange; label: string }> = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

export default function SellerAnalyticsPage() {
  const [range, setRange] = useState<SellerAnalyticsRange>('30d');
  const [exporting, setExporting] = useState(false);
  const { data, isLoading, isError, refetch } = useSellerAnalytics(range);

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadAuthenticated(
        '/api/v1/me/sales.csv',
        `nomarkup-sales-${new Date().toISOString().slice(0, 10)}.csv`,
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="container mx-auto max-w-6xl space-y-6 px-4 py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Seller analytics</h1>
          <p className="text-sm text-muted-foreground">
            Track your revenue, sell-through, and top-performing categories.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Range tabs */}
          <div className="inline-flex rounded-lg border bg-muted/30 p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => {
                  setRange(r.value);
                }}
                className={
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors ' +
                  (range === r.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground')
                }
                aria-pressed={range === r.value}
              >
                {r.label}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void handleExport();
            }}
            disabled={exporting}
          >
            {exporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            Export CSV
          </Button>
        </div>
      </header>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-64 w-full" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      ) : isError || !data ? (
        <EmptyState
          icon={<FileBarChart className="h-8 w-8" aria-hidden="true" />}
          title="Failed to load analytics"
          description="We couldn't pull your sales data. Try again."
          action={
            <Button variant="outline" onClick={() => void refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <>
          {/* Top stat row — sell-through, avg sale price, total listed */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Sell-through rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold tabular-nums">
                  {Math.round(data.sell_through_rate * 100)}%
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.total_sold} sold of {data.total_listed} listed
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Avg sale price
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold tabular-nums">
                  {formatCents(data.avg_sale_price_cents)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Across {data.total_sold} sold orders
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total listed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold tabular-nums">{data.total_listed}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  In the last {data.range_days} days
                </p>
              </CardContent>
            </Card>
          </div>

          <PerformanceChart data={data.daily_revenue} rangeDays={data.range_days} />

          <TopCategoriesChart data={data.top_categories} />
        </>
      )}
    </div>
  );
}
