'use client';

import { ArrowLeft, Download, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useProviderEarnings } from '@/hooks/useAnalytics';
import { formatCents } from '@/lib/utils';

const SE_TAX_RATE = 0.153; // 15.3% self-employment tax
const ESTIMATED_INCOME_TAX_RATE = 0.22; // 22% estimated federal income tax bracket

const THRESHOLD_1099 = 60000; // $600 in cents

function getCurrentYear(): number {
  return new Date().getFullYear();
}

export default function TaxCenterPage() {
  const currentYear = getCurrentYear();
  const [taxYear, setTaxYear] = useState(String(currentYear));

  const startDate = `${taxYear}-01-01`;
  const endDate = `${taxYear}-12-31`;

  const { data: earnings, isLoading } = useProviderEarnings(startDate, endDate, 'quarter');

  const ytdEarnings = earnings?.net_earnings_cents ?? 0;
  const totalJobs = earnings?.total_jobs ?? 0;
  const totalFees = earnings?.total_fees_cents ?? 0;

  const will1099 = ytdEarnings >= THRESHOLD_1099;

  // Quarterly estimates
  const quarterlyEarnings = ytdEarnings / 4;
  const quarterlySETax = Math.round(quarterlyEarnings * SE_TAX_RATE);
  const quarterlyIncomeTax = Math.round(quarterlyEarnings * ESTIMATED_INCOME_TAX_RATE);
  const quarterlyTotal = quarterlySETax + quarterlyIncomeTax;

  function handlePrint() {
    window.print();
  }

  const yearOptions = Array.from({ length: 3 }, (_, i) => currentYear - i);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/provider/business"
            className="flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Business Services
          </Link>
        </div>
        <Button
          variant="outline"
          className="no-print min-h-[44px] gap-2"
          onClick={handlePrint}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Download Summary
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tax Center</h1>
          <p className="mt-1 text-muted-foreground">
            Track earnings and estimate tax obligations.
          </p>
        </div>
        <Select value={taxYear} onValueChange={setTaxYear}>
          <SelectTrigger className="w-[120px] min-h-[44px]" aria-label="Select tax year">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map((year) => (
              <SelectItem key={year} value={String(year)}>
                {String(year)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={`skel-tax-${String(i)}`} className="h-32" />
          ))}
        </div>
      ) : (
        <>
          {/* YTD Earnings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {taxYear} Earnings Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Gross Earnings</span>
                <span className="text-sm font-bold tabular-nums">
                  {formatCents(ytdEarnings + totalFees)}
                </span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Platform Fees</span>
                <span className="text-sm tabular-nums text-destructive">
                  -{formatCents(totalFees)}
                </span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="font-medium">Net Earnings</span>
                <span className="text-lg font-bold tabular-nums">{formatCents(ytdEarnings)}</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Jobs Completed</span>
                <span className="text-sm font-medium">{String(totalJobs)}</span>
              </div>
            </CardContent>
          </Card>

          {/* 1099 Threshold */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">1099-NEC Threshold</CardTitle>
              <Badge variant={will1099 ? 'default' : 'secondary'}>
                {will1099 ? 'Will Receive 1099' : 'Below Threshold'}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                You will receive a 1099-NEC form if your earnings exceed $600 for the tax year.
              </p>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Your Earnings</span>
                <span className="text-sm font-bold tabular-nums">{formatCents(ytdEarnings)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Threshold</span>
                <span className="text-sm tabular-nums">{formatCents(THRESHOLD_1099)}</span>
              </div>
              {!will1099 ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Remaining</span>
                  <span className="text-sm tabular-nums">
                    {formatCents(THRESHOLD_1099 - ytdEarnings)}
                  </span>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Quarterly Tax Estimates */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <CardTitle className="text-base">Quarterly Tax Estimates</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Estimated quarterly tax payments based on your current earnings pace. These are
                estimates only — consult a tax professional for accurate figures.
              </p>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Self-Employment Tax (15.3%)
                </span>
                <span className="text-sm tabular-nums">{formatCents(quarterlySETax)}/quarter</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Estimated Income Tax (22%)
                </span>
                <span className="text-sm tabular-nums">
                  {formatCents(quarterlyIncomeTax)}/quarter
                </span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="font-medium">Est. Quarterly Payment</span>
                <span className="text-lg font-bold tabular-nums">
                  {formatCents(quarterlyTotal)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Quarterly due dates: Apr 15, Jun 15, Sep 15, Jan 15 (following year)
              </p>
            </CardContent>
          </Card>

          {/* Quarterly breakdown */}
          {earnings?.data_points && earnings.data_points.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Quarterly Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {earnings.data_points.map((dp) => (
                    <div key={dp.period_start} className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        {new Date(dp.period_start).toLocaleDateString('en-US', {
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                      <div className="text-right">
                        <span className="text-sm font-medium tabular-nums">
                          {formatCents(dp.earnings_cents)}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({String(dp.job_count)} job{dp.job_count !== 1 ? 's' : ''})
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
