'use client';

import { ArrowLeft, Shield } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTransition } from '@/components/ui/page-transition';
import { Skeleton } from '@/components/ui/skeleton';
import { useMyPolicies } from '@/hooks/useInsurance';
import { cn, formatCents, humanizeStatus } from '@/lib/utils';

// A policy can also be `pending_payment` before its premium is charged (DB
// state machine), which is not part of the typed InsurancePolicyStatus union.
// Key on plain strings so every backend status maps to a class + friendly
// label, and humanize any unknown status rather than leaking the raw slug.
const POLICY_STATUS_CLASSES: Record<string, string> = {
  active: 'bg-green-500/10 text-green-300 border-green-500/30',
  pending_payment: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30',
  expired: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
  cancelled: 'bg-red-500/10 text-red-300 border-red-500/30',
  claimed: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
};

const POLICY_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  pending_payment: 'Pending Payment',
  expired: 'Expired',
  cancelled: 'Cancelled',
  claimed: 'Claimed',
};

const POLICY_STATUS_FALLBACK_CLASS = 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30';

function statusClass(status: string): string {
  return POLICY_STATUS_CLASSES[status] ?? POLICY_STATUS_FALLBACK_CLASS;
}

function statusLabel(status: string): string {
  return POLICY_STATUS_LABELS[status] ?? humanizeStatus(status);
}

export default function InsurancePoliciesPage() {
  const { data, isLoading, isError } = useMyPolicies();

  return (
    <PageTransition>
      <div className="space-y-6">
        {/* Back link */}
        <Link
          href={'/contracts' as Route}
          className="flex min-h-[44px] items-center gap-1 text-sm text-zinc-300 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Contracts
        </Link>

        {/* Header */}
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-[var(--brand-gold)]" aria-hidden="true" />
          <h1 className="gold-text text-2xl font-bold tracking-tight">My Policies</h1>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : isError ? (
          <EmptyState
            icon={<AnimatedIllustration type="error" size="sm" />}
            title="Failed to load policies"
            description="Something went wrong. Please try again."
            className="glass border-destructive/30"
          />
        ) : !data || data.policies.length === 0 ? (
          <EmptyState
            icon={<AnimatedIllustration type="no-contracts" size="sm" />}
            title="No insurance policies yet"
            description="Buy per-job insurance from an active contract to protect your project."
            className="glass"
          />
        ) : (
          <div className="space-y-3">
            {data.policies.map((policy) => (
              <Link key={policy.id} href={`/insurance/${policy.id}` as Route} className="block">
                <Card className="glass glass-highlight border border-[var(--brand-gold)]/10 transition-colors hover:border-[var(--brand-gold)]/30">
                  <CardContent className="flex items-center justify-between gap-4 pt-6">
                    <div>
                      <p className="font-semibold">{policy.policy_number}</p>
                      <p className="mt-1 text-sm text-zinc-400">
                        Coverage {formatCents(policy.coverage_amount_cents)} · Premium{' '}
                        {formatCents(policy.premium_cents)}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn('text-xs', statusClass(policy.status))}
                    >
                      {statusLabel(policy.status)}
                    </Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PageTransition>
  );
}
