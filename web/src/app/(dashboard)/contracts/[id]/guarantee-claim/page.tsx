'use client';

import { ArrowLeft, ShieldCheck } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import { GuaranteeClaimForm } from '@/components/contracts/GuaranteeClaimForm';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTransition } from '@/components/ui/page-transition';
import { Skeleton } from '@/components/ui/skeleton';
import { useContract } from '@/hooks/useContracts';
import { useGuaranteeClaim } from '@/hooks/useGuarantee';
import { GUARANTEE_STATUS_CLASSES } from '@/lib/status-badge-classes';
import { formatCents } from '@/lib/utils';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const CLAIM_STATUS_LABELS: Record<string, string> = {
  open: 'Submitted',
  under_review: 'Under Review',
  resolved: 'Resolved',
  escalated: 'Escalated',
  closed: 'Closed',
};

export default function GuaranteeClaimPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const contractId = params.id;
  const { data: contractData, isLoading: contractLoading, isError: contractError } = useContract(contractId);
  const { data: claimData, isLoading: claimLoading } = useGuaranteeClaim(contractId);

  function handleSuccess() {
    router.push(`/contracts/${contractId}` as Route);
  }

  if (contractLoading || claimLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (contractError || !contractData) {
    return (
      <div className="space-y-4">
        <Link
          href={`/contracts/${contractId}` as Route}
          className="flex min-h-[44px] items-center gap-1 text-sm text-zinc-400 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Contract
        </Link>
        <EmptyState
          icon={<AnimatedIllustration type="error" size="sm" />}
          title="Failed to load contract"
          description="Something went wrong loading contract details. Please try again."
          className="glass border-destructive/30"
        />
      </div>
    );
  }

  const existingClaim = claimData?.guarantee_claim;

  return (
    <PageTransition>
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href={`/contracts/${contractId}` as Route}
        className="flex min-h-[44px] items-center gap-1 text-sm text-zinc-400 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Contract {contractData.contract.contract_number}
      </Link>

      {/* Show existing claim status if one exists */}
      {existingClaim ? (
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
              <CardTitle className="gold-text text-base">Guarantee Claim Status</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400">Status</span>
              <Badge variant="outline" className={GUARANTEE_STATUS_CLASSES[existingClaim.status]}>
                {CLAIM_STATUS_LABELS[existingClaim.status] ?? existingClaim.status}
              </Badge>
            </div>
            <div>
              <span className="text-sm text-zinc-400">Filed</span>
              <p className="mt-1 text-sm">{formatDate(existingClaim.created_at)}</p>
            </div>
            <div>
              <span className="text-sm text-zinc-400">Description</span>
              <p className="mt-1 text-sm">{existingClaim.description}</p>
            </div>
            {existingClaim.resolution_notes ? (
              <div>
                <span className="text-sm text-zinc-400">Resolution</span>
                <p className="mt-1 text-sm">{existingClaim.resolution_notes}</p>
              </div>
            ) : null}
            {existingClaim.refund_amount_cents !== undefined && existingClaim.refund_amount_cents > 0 ? (
              <div>
                <span className="text-sm text-zinc-400">Payout</span>
                <p className="mt-1 text-sm font-medium tabular-nums">
                  {formatCents(existingClaim.refund_amount_cents)}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <GuaranteeClaimForm contractId={contractId} onSuccess={handleSuccess} />
      )}
    </div>
    </PageTransition>
  );
}
