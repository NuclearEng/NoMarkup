'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { PreferredProvider } from '@/hooks/useProperties';

/** PRD FR-19.2 threshold (mirrors gateway PreferredProviderMinCompletions). */
const DEFAULT_PREFERRED_THRESHOLD = 3;
import { cn } from '@/lib/utils';

const TOP_LIMIT = 5;

export interface PreferredProvidersSectionProps {
  providers: PreferredProvider[] | undefined;
  isLoading: boolean;
  isError: boolean;
  /** Account-wide vs property-scoped copy. */
  scope?: 'account' | 'property';
  /** Server threshold (defaults to PRD 3). */
  preferredThreshold?: number;
  className?: string;
}

function countLabel(count: number): string {
  return count === 1 ? '1 completed job' : `${String(count)} completed jobs`;
}

/**
 * FR-19.2 preferred / top providers list.
 * Shows top 5 by completed count, Preferred badge at threshold (default 3),
 * fail-soft empty and error states (no toast — parent owns soft-fail).
 */
export function PreferredProvidersSection({
  providers,
  isLoading,
  isError,
  scope = 'account',
  preferredThreshold = DEFAULT_PREFERRED_THRESHOLD,
  className,
}: PreferredProvidersSectionProps) {
  const title =
    scope === 'property' ? 'Providers at this property' : 'Providers · all properties';
  const footer =
    scope === 'property'
      ? `From completed contracts linked to jobs at this address. “Preferred” means ${String(preferredThreshold)}+ completed jobs with the same provider.`
      : `From completed service contracts on your account. “Preferred” means ${String(preferredThreshold)}+ completed jobs with that provider. Open a property for property-scoped counts.`;

  if (isLoading) {
    return (
      <Card
        className={cn(
          'glass glass-highlight border border-[var(--brand-gold)]/10',
          className,
        )}
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-zinc-100">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card
        className={cn(
          'glass glass-highlight border border-[var(--brand-gold)]/10',
          className,
        )}
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-zinc-100">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-400">
            Provider summary unavailable right now.
          </p>
        </CardContent>
      </Card>
    );
  }

  const list = (providers ?? []).slice(0, TOP_LIMIT);

  // Property detail matches iOS: hide section entirely when empty (no soft copy).
  if (list.length === 0 && scope === 'property') {
    return null;
  }

  if (list.length === 0) {
    return (
      <Card
        className={cn(
          'glass glass-highlight border border-[var(--brand-gold)]/10',
          className,
        )}
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-zinc-100">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-400">
            No completed contracts yet — preferred providers appear after{' '}
            {String(preferredThreshold)}+ jobs with the same provider.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        'glass glass-highlight border border-[var(--brand-gold)]/10',
        className,
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-zinc-100">{title}</CardTitle>
        <p className="text-xs text-zinc-400">{footer}</p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-white/5" role="list">
          {list.map((provider) => {
            const isPreferred =
              provider.is_preferred ||
              provider.completed_count >= preferredThreshold;
            const name =
              provider.display_name.trim() ||
              `Provider ${provider.provider_id.slice(0, 8)}`;
            return (
              <li
                key={provider.provider_id}
                className="flex min-h-11 items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-100">{name}</p>
                  <p className="text-xs tabular-nums text-zinc-400">
                    {countLabel(provider.completed_count)}
                  </p>
                </div>
                {isPreferred ? (
                  <Badge
                    variant="default"
                    className="shrink-0 border-transparent bg-[var(--brand-gold)]/20 text-[var(--brand-gold)]"
                    aria-label="Preferred provider"
                  >
                    Preferred
                  </Badge>
                ) : (
                  <span
                    className="shrink-0 text-xs font-semibold tabular-nums text-zinc-400"
                    aria-label={`${String(provider.completed_count)} of ${String(preferredThreshold)} jobs toward preferred`}
                  >
                    {String(provider.completed_count)}/{String(preferredThreshold)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
