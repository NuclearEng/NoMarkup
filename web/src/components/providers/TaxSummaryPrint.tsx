import { formatCents } from '@/lib/utils';

interface QuarterlyPoint {
  periodStart: string;
  earningsCents: number;
  jobCount: number;
}

interface TaxSummaryPrintProps {
  taxYear: string;
  providerName: string;
  providerEmail: string;
  grossCents: number;
  feesCents: number;
  netCents: number;
  jobsCompleted: number;
  threshold1099Cents: number;
  will1099: boolean;
  quarterlySETaxCents: number;
  quarterlyIncomeTaxCents: number;
  quarterlyStateTaxCents: number;
  quarterlyTotalCents: number;
  effectiveRate: number;
  seTaxRate: number;
  stateCode: string;
  stateTaxRate: number;
  hasStateData: boolean;
  quarterlyPoints: QuarterlyPoint[];
}

function formatRatePercent(rate: number): string {
  if (!Number.isFinite(rate)) return '0%';
  return `${(rate * 100).toFixed(rate * 100 >= 10 ? 1 : 2)}%`;
}

function formatGeneratedOn(): string {
  return new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Institution-grade printable tax summary.
 *
 * Hidden on screen (`hidden`) and revealed only inside `@media print` via the
 * `tax-summary-print` class. It is rendered with explicit white-background /
 * black-text styling and deliberately avoids the app's dark theme, glass
 * effects, and `gold-text` (which uses `-webkit-text-fill-color: transparent`
 * and would print invisible). All figures come from the same data the live
 * Tax Center renders, so the PDF is always accurate.
 */
export function TaxSummaryPrint(props: TaxSummaryPrintProps) {
  const {
    taxYear,
    providerName,
    providerEmail,
    grossCents,
    feesCents,
    netCents,
    jobsCompleted,
    threshold1099Cents,
    will1099,
    quarterlySETaxCents,
    quarterlyIncomeTaxCents,
    quarterlyStateTaxCents,
    quarterlyTotalCents,
    effectiveRate,
    seTaxRate,
    stateCode,
    stateTaxRate,
    hasStateData,
    quarterlyPoints,
  } = props;

  return (
    <div
      className="tax-summary-print hidden text-black"
      aria-hidden="true"
      data-testid="tax-summary-print"
    >
      {/* Header */}
      <header className="mb-8 flex items-start justify-between border-b-2 border-black pb-4">
        <div>
          <p className="text-2xl font-bold tracking-tight">NoMarkup</p>
          <p className="mt-1 text-base font-semibold">Tax Summary {taxYear}</p>
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold">{providerName}</p>
          {providerEmail ? <p>{providerEmail}</p> : null}
          <p className="mt-1">Generated {formatGeneratedOn()}</p>
        </div>
      </header>

      {/* Earnings Summary */}
      <section className="mb-8 break-inside-avoid">
        <h2 className="mb-3 text-lg font-bold">{taxYear} Earnings Summary</h2>
        <table className="w-full border-collapse text-sm">
          <tbody>
            <tr className="border-b border-neutral-400">
              <td className="py-2">Gross Earnings</td>
              <td className="py-2 text-right tabular-nums">{formatCents(grossCents)}</td>
            </tr>
            <tr className="border-b border-neutral-400">
              <td className="py-2">Platform Fees</td>
              <td className="py-2 text-right tabular-nums">-{formatCents(feesCents)}</td>
            </tr>
            <tr className="border-b-2 border-black font-bold">
              <td className="py-2">Net Earnings</td>
              <td className="py-2 text-right tabular-nums">{formatCents(netCents)}</td>
            </tr>
            <tr className="border-b border-neutral-400">
              <td className="py-2">Jobs Completed</td>
              <td className="py-2 text-right tabular-nums">{String(jobsCompleted)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* 1099-NEC Threshold */}
      <section className="mb-8 break-inside-avoid">
        <h2 className="mb-3 text-lg font-bold">1099-NEC Threshold</h2>
        <p className="mb-3 text-sm">
          A 1099-NEC form is issued when net earnings exceed{' '}
          {formatCents(threshold1099Cents)} for the tax year.
        </p>
        <table className="w-full border-collapse text-sm">
          <tbody>
            <tr className="border-b border-neutral-400">
              <td className="py-2">Your Net Earnings</td>
              <td className="py-2 text-right tabular-nums">{formatCents(netCents)}</td>
            </tr>
            <tr className="border-b border-neutral-400">
              <td className="py-2">Threshold</td>
              <td className="py-2 text-right tabular-nums">{formatCents(threshold1099Cents)}</td>
            </tr>
            <tr className="border-b-2 border-black font-bold">
              <td className="py-2">Status</td>
              <td className="py-2 text-right">
                {will1099 ? 'Will receive 1099-NEC' : 'Below threshold'}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Quarterly Tax Estimates */}
      <section className="mb-8 break-inside-avoid">
        <h2 className="mb-3 text-lg font-bold">Estimated Tax</h2>
        <p className="mb-3 text-sm">
          Estimated full-year federal and state tax on net self-employment income (2025 tax
          code), shown per quarter. Estimated-tax due dates: Apr 15, Jun 15, Sep 15, and Jan 15
          (following year).
        </p>
        <table className="w-full border-collapse text-sm">
          <tbody>
            <tr className="border-b border-neutral-400">
              <td className="py-2">Self-Employment Tax ({formatRatePercent(seTaxRate)})</td>
              <td className="py-2 text-right tabular-nums">
                {formatCents(quarterlySETaxCents)}/quarter
              </td>
            </tr>
            <tr className="border-b border-neutral-400">
              <td className="py-2">Federal Income Tax</td>
              <td className="py-2 text-right tabular-nums">
                {formatCents(quarterlyIncomeTaxCents)}/quarter
              </td>
            </tr>
            <tr className="border-b border-neutral-400">
              <td className="py-2">
                State Income Tax
                {hasStateData && stateCode
                  ? ` (${stateCode}${stateTaxRate > 0 ? ` · ${formatRatePercent(stateTaxRate)}` : ''})`
                  : ''}
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatCents(quarterlyStateTaxCents)}/quarter
              </td>
            </tr>
            <tr className="border-b-2 border-black font-bold">
              <td className="py-2">
                Estimated Quarterly Payment
                <span className="ml-2 font-normal text-neutral-700">
                  ({formatRatePercent(effectiveRate)} effective)
                </span>
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatCents(quarterlyTotalCents)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Quarterly Breakdown */}
      {quarterlyPoints.length > 0 ? (
        <section className="mb-8 break-inside-avoid">
          <h2 className="mb-3 text-lg font-bold">Quarterly Breakdown</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-black text-left">
                <th className="py-2 font-semibold">Period</th>
                <th className="py-2 text-right font-semibold">Earnings</th>
                <th className="py-2 text-right font-semibold">Jobs</th>
              </tr>
            </thead>
            <tbody>
              {quarterlyPoints.map((dp) => (
                <tr key={dp.periodStart} className="border-b border-neutral-400">
                  <td className="py-2">
                    {new Date(dp.periodStart).toLocaleDateString('en-US', {
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCents(dp.earningsCents)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{String(dp.jobCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {/* Footer disclaimer */}
      <footer className="mt-12 border-t border-neutral-400 pt-4 text-xs text-neutral-700">
        <p>
          This summary is an estimate only and is not tax advice. Figures are derived from
          platform activity and may not reflect all income, deductions, or adjustments.
          Consult a qualified tax professional before filing.
        </p>
        <p className="mt-2">
          Generated by NoMarkup on {formatGeneratedOn()} for {providerName}.
        </p>
      </footer>
    </div>
  );
}
