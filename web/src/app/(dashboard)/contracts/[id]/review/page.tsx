'use client';

import { ArrowLeft, CheckCircle, Clock, Loader2, XCircle } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import { ReviewForm } from '@/components/forms/ReviewForm';
import { Card, CardContent } from '@/components/ui/card';
import { useContract } from '@/hooks/useContracts';
import { useReviewEligibility } from '@/hooks/useReviews';
import { useAuthStore } from '@/stores/auth-store';
import { REVIEW_DIRECTION } from '@/types';

export default function ReviewPage() {
  const params = useParams<{ id: string }>();
  const contractId = params.id;
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  const { data: contractData, isLoading: contractLoading } = useContract(contractId);
  const { data: eligibility, isLoading: eligibilityLoading } = useReviewEligibility(contractId);

  const isLoading = contractLoading || eligibilityLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (!contractData || !eligibility) {
    return (
      <div className="space-y-4">
        <Link
          href={`/contracts/${contractId}` as Route}
          className="flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Contract
        </Link>
        <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load review information. Please try again.
        </div>
      </div>
    );
  }

  const contract = contractData.contract;
  const isCustomer = user?.id === contract.customer_id;
  const direction = isCustomer
    ? REVIEW_DIRECTION.CUSTOMER_TO_PROVIDER
    : REVIEW_DIRECTION.PROVIDER_TO_CUSTOMER;

  function handleSuccess() {
    router.push(`/contracts/${contractId}` as Route);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href={`/contracts/${contractId}` as Route}
        className="flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Contract
      </Link>

      <h1 className="text-2xl font-bold tracking-tight">Review - {contract.contract_number}</h1>

      {/* Already reviewed */}
      {eligibility.already_reviewed ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle className="h-12 w-12 text-green-500" aria-hidden="true" />
            <p className="mt-4 text-lg font-medium">Already Reviewed</p>
            <p className="mt-1 text-sm text-muted-foreground">
              You have already submitted a review for this contract.
            </p>
            <Link
              href={`/contracts/${contractId}` as Route}
              className="mt-4 text-sm text-primary hover:underline"
            >
              Return to contract
            </Link>
          </CardContent>
        </Card>
      ) : !eligibility.eligible ? (
        /* Window closed */
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            {new Date(eligibility.review_window_closes_at) < new Date() ? (
              <>
                <XCircle className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
                <p className="mt-4 text-lg font-medium">Review Window Closed</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  The review window for this contract has closed.
                </p>
              </>
            ) : (
              <>
                <Clock className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
                <p className="mt-4 text-lg font-medium">Not Eligible</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  You are not eligible to review this contract at this time.
                </p>
              </>
            )}
            <Link
              href={`/contracts/${contractId}` as Route}
              className="mt-4 text-sm text-primary hover:underline"
            >
              Return to contract
            </Link>
          </CardContent>
        </Card>
      ) : (
        /* Eligible: show review form */
        <ReviewForm
          contractId={contractId}
          direction={direction}
          reviewWindowClosesAt={eligibility.review_window_closes_at}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}
