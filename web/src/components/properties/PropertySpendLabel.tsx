'use client';

import { useCustomerSpending } from '@/hooks/useAnalytics';
import { formatCents } from '@/lib/utils';

function trailingYearYmd(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  const toYmd = (d: Date) => d.toISOString().slice(0, 10);
  return { start: toYmd(start), end: toYmd(end) };
}

export interface PropertySpendLabelProps {
  propertyId: string;
  /** Extra classes on the outer span. */
  className?: string;
  /** When true, render a compact multi-metric card instead of a single line. */
  detailed?: boolean;
}

/**
 * Property-scoped services spend via
 * `GET /api/v1/analytics/customers/me/spending?property_id=`.
 * Soft-fails (shows n/a) when the analytics path is down or the property is empty.
 */
export function PropertySpendLabel({
  propertyId,
  className = 'text-sm font-medium text-zinc-200',
  detailed = false,
}: PropertySpendLabelProps) {
  const { start, end } = trailingYearYmd();
  const { data, isLoading, isError } = useCustomerSpending(
    start,
    end,
    'month',
    propertyId,
  );

  if (isLoading) {
    return (
      <span className="text-sm text-zinc-400" aria-busy="true">
        Loading spend…
      </span>
    );
  }

  if (isError || data == null) {
    return (
      <span className="text-sm text-zinc-400" title="Spend summary unavailable">
        Spend n/a
      </span>
    );
  }

  const total = data.total_spent_cents ?? 0;
  const jobs = data.total_jobs ?? 0;
  const avg = data.average_job_cost_cents ?? 0;
  const savings = data.total_savings_cents ?? 0;

  if (!detailed) {
    return (
      <span className={className}>
        {formatCents(total)} spent
        {jobs > 0 ? (
          <span className="ml-1 font-normal text-zinc-400">· {jobs} jobs</span>
        ) : null}
      </span>
    );
  }

  return (
    <div
      className="grid gap-3 sm:grid-cols-3"
      aria-label={`Total spend ${formatCents(total)}, ${jobs} jobs at this property`}
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Total spend
        </p>
        <p className="mt-1 text-lg font-semibold text-[var(--brand-gold)]">
          {formatCents(total)}
        </p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Jobs / avg
        </p>
        <p className="mt-1 text-lg font-semibold text-zinc-100">
          {jobs} · {formatCents(avg)}
        </p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Savings vs market
        </p>
        <p className="mt-1 text-lg font-semibold text-zinc-100">
          {formatCents(savings)}
        </p>
      </div>
    </div>
  );
}
