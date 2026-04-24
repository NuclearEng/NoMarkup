'use client';

import { ArrowLeft, Download, FileText, Loader2, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { PageTransition } from '@/components/ui/page-transition';

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
import { useGenerateTaxForm, useTaxForms } from '@/hooks/useTaxForms';
import { downloadAuthenticated } from '@/lib/api';
import { formatCents } from '@/lib/utils';
import { toast } from 'sonner';

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
  const { data: taxFormsData, isLoading: taxFormsLoading } = useTaxForms();
  const generateTaxForm = useGenerateTaxForm();

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
    <PageTransition>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/provider/business"
            className="flex min-h-[44px] items-center gap-1 text-sm text-zinc-300 hover:text-foreground"
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
          <h1 className="gold-text text-2xl font-bold tracking-tight">Tax Center</h1>
          <p className="mt-1 text-zinc-300">
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
          <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
            <CardHeader>
              <CardTitle className="gold-text text-base">
                {taxYear} Earnings Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-300">Gross Earnings</span>
                <span className="text-sm font-bold tabular-nums">
                  {formatCents(ytdEarnings + totalFees)}
                </span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-300">Platform Fees</span>
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
                <span className="text-sm text-zinc-300">Jobs Completed</span>
                <span className="text-sm font-medium">{String(totalJobs)}</span>
              </div>
            </CardContent>
          </Card>

          {/* 1099 Threshold */}
          <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="gold-text text-base">1099-NEC Threshold</CardTitle>
              <Badge variant={will1099 ? 'default' : 'secondary'}>
                {will1099 ? 'Will Receive 1099' : 'Below Threshold'}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-zinc-300">
                You will receive a 1099-NEC form if your earnings exceed $600 for the tax year.
              </p>
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-300">Your Earnings</span>
                <span className="text-sm font-bold tabular-nums">{formatCents(ytdEarnings)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-300">Threshold</span>
                <span className="text-sm tabular-nums">{formatCents(THRESHOLD_1099)}</span>
              </div>
              {!will1099 ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-300">Remaining</span>
                  <span className="text-sm tabular-nums">
                    {formatCents(THRESHOLD_1099 - ytdEarnings)}
                  </span>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Quarterly Tax Estimates */}
          <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
            <CardHeader>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-zinc-300" aria-hidden="true" />
                <CardTitle className="gold-text text-base">Quarterly Tax Estimates</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-zinc-300">
                Estimated quarterly tax payments based on your current earnings pace. These are
                estimates only — consult a tax professional for accurate figures.
              </p>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-300">
                  Self-Employment Tax (15.3%)
                </span>
                <span className="text-sm tabular-nums">{formatCents(quarterlySETax)}/quarter</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-300">
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
              <p className="text-xs text-white/50">
                Quarterly due dates: Apr 15, Jun 15, Sep 15, Jan 15 (following year)
              </p>
            </CardContent>
          </Card>

          {/* Quarterly breakdown */}
          {earnings?.data_points && earnings.data_points.length > 0 ? (
            <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
              <CardHeader>
                <CardTitle className="gold-text text-base">Quarterly Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {earnings.data_points.map((dp) => (
                    <div key={dp.period_start} className="flex items-center justify-between">
                      <span className="text-sm text-zinc-300">
                        {new Date(dp.period_start).toLocaleDateString('en-US', {
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                      <div className="text-right">
                        <span className="text-sm font-medium tabular-nums">
                          {formatCents(dp.earnings_cents)}
                        </span>
                        <span className="ml-2 text-xs text-zinc-300">
                          ({String(dp.job_count)} job{dp.job_count !== 1 ? 's' : ''})
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Generate 1099-NEC */}
          <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="gold-text text-base">1099-NEC Tax Forms</CardTitle>
              <Button
                variant="outline"
                className="min-h-[44px] gap-2"
                disabled={generateTaxForm.isPending}
                onClick={() => {
                  generateTaxForm.mutate(parseInt(taxYear, 10));
                }}
              >
                {generateTaxForm.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <FileText className="h-4 w-4" aria-hidden="true" />
                )}
                Generate 1099-NEC
              </Button>
            </CardHeader>
            <CardContent>
              {generateTaxForm.isError ? (
                <div className="mb-3 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                  Failed to generate tax form. Please try again.
                </div>
              ) : null}

              {taxFormsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : (taxFormsData?.forms ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-300">
                  No tax forms generated yet. Click the button above to generate a 1099-NEC for the selected year.
                </p>
              ) : (
                <div className="space-y-2">
                  {(taxFormsData?.forms ?? []).map((form) => (
                    <div
                      key={form.id}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] p-3"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {form.form_type} - {String(form.tax_year)}
                        </p>
                        <p className="text-xs text-zinc-300">
                          Generated:{' '}
                          {new Date(form.generated_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={form.status === 'ready' ? 'default' : 'secondary'}>
                          {form.status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                        </Badge>
                        <button
                          type="button"
                          onClick={() => {
                            void downloadAuthenticated(
                              `/api/v1/providers/me/tax-forms/${String(form.tax_year)}/download`,
                              `1099-NEC-${String(form.tax_year)}.html`,
                            ).catch((err) => {
                              toast.error(
                                err instanceof Error ? err.message : 'Failed to download tax form',
                              );
                            });
                          }}
                          className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-white/10 px-3 py-2 text-sm hover:bg-white/[0.06]"
                        >
                          <Download className="h-4 w-4" aria-hidden="true" />
                          Download
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
    </PageTransition>
  );
}
