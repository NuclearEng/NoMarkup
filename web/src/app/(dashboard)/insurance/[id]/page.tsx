'use client';

import { ArrowLeft, Calendar, FileText, Shield } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { InsuranceClaimForm } from '@/components/insurance/InsuranceClaimForm';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTransition } from '@/components/ui/page-transition';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useInsurancePolicy } from '@/hooks/useInsurance';
import { cn, formatCents } from '@/lib/utils';
import type { InsuranceClaimStatus, InsurancePolicyStatus } from '@/types';
import { INSURANCE_POLICY_STATUS } from '@/types';

const POLICY_STATUS_CLASSES: Record<InsurancePolicyStatus, string> = {
  active: 'bg-green-500/10 text-green-300 border-green-500/30',
  expired: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
  cancelled: 'bg-red-500/10 text-red-300 border-red-500/30',
  claimed: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
};

const POLICY_STATUS_LABELS: Record<InsurancePolicyStatus, string> = {
  active: 'Active',
  expired: 'Expired',
  cancelled: 'Cancelled',
  claimed: 'Claimed',
};

const _CLAIM_STATUS_CLASSES: Record<InsuranceClaimStatus, string> = {
  filed: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  under_review: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
  approved: 'bg-green-500/10 text-green-300 border-green-500/30',
  denied: 'bg-red-500/10 text-red-300 border-red-500/30',
  paid: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
};

const _CLAIM_STATUS_LABELS: Record<InsuranceClaimStatus, string> = {
  filed: 'Filed',
  under_review: 'Under Review',
  approved: 'Approved',
  denied: 'Denied',
  paid: 'Paid',
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function InsurancePolicyDetailPage() {
  const params = useParams<{ id: string }>();
  const policyId = params.id;
  const { data, isLoading, isError } = useInsurancePolicy(policyId);
  const [showClaimForm, setShowClaimForm] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-48" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-4">
        <Link
          href={'/insurance' as Route}
          className="flex min-h-[44px] items-center gap-1 text-sm text-zinc-300 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Policies
        </Link>
        <EmptyState
          icon={<AnimatedIllustration type="error" size="sm" />}
          title="Failed to load policy"
          description="Something went wrong. Please try again."
          className="glass border-destructive/30"
        />
      </div>
    );
  }

  const policy = data.policy;
  const isActive = policy.status === INSURANCE_POLICY_STATUS.ACTIVE;
  const policyStatus = policy.status as InsurancePolicyStatus;

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
          <div>
            <div className="flex items-center gap-3">
              <h1 className="gold-text text-2xl font-bold tracking-tight">
                {policy.policy_number}
              </h1>
              <Badge
                variant="outline"
                className={cn('text-xs', POLICY_STATUS_CLASSES[policyStatus])}
              >
                {POLICY_STATUS_LABELS[policyStatus]}
              </Badge>
            </div>
            <p className="mt-1 text-zinc-300">{policy.product.name}</p>
          </div>
        </div>

        {/* Policy Details */}
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <CardTitle className="gold-text text-base">Coverage Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-300">Coverage Amount</span>
              <span className="text-lg font-bold tabular-nums">
                {formatCents(policy.coverage_amount_cents)}
              </span>
            </div>
            <Separator className="bg-white/5" />
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-300">Premium Paid</span>
              <span className="text-sm font-medium tabular-nums">
                {formatCents(policy.premium_cents)}
              </span>
            </div>
            <Separator className="bg-white/5" />
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-300">Deductible</span>
              <span className="text-sm tabular-nums">
                {formatCents(policy.deductible_cents)}
              </span>
            </div>
            <Separator className="bg-white/5" />
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-300">Coverage Type</span>
              <span className="text-sm">{policy.product.coverage_type}</span>
            </div>
          </CardContent>
        </Card>

        {/* Dates */}
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-zinc-300" aria-hidden="true" />
              <CardTitle className="gold-text text-base">Policy Period</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-300">Effective Date</span>
              <span className="text-sm font-medium">{formatDate(policy.effective_date)}</span>
            </div>
            <Separator className="bg-white/5" />
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-300">Expiration Date</span>
              <span className="text-sm font-medium">{formatDate(policy.expiration_date)}</span>
            </div>
            <Separator className="bg-white/5" />
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-300">Purchased</span>
              <span className="text-sm">{formatDate(policy.created_at)}</span>
            </div>
          </CardContent>
        </Card>

        {/* File a Claim button */}
        {isActive && !showClaimForm ? (
          <Button
            className="min-h-[44px] w-full gap-2"
            onClick={() => {
              setShowClaimForm(true);
            }}
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            File a Claim
          </Button>
        ) : null}

        {/* Claim Form */}
        {showClaimForm ? (
          <InsuranceClaimForm
            policyId={policyId}
            coverageAmountCents={policy.coverage_amount_cents}
            onSuccess={() => {
              setShowClaimForm(false);
            }}
          />
        ) : null}

        {/* Product Description */}
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <CardTitle className="gold-text text-base">Product Details</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-zinc-300">{policy.product.description}</p>
          </CardContent>
        </Card>
      </div>
    </PageTransition>
  );
}
