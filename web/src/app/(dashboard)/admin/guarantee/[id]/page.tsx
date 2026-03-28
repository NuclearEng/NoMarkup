'use client';

import { ArrowLeft } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import { GuaranteeClaimReview } from '@/components/admin/GuaranteeClaimReview';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminDispute } from '@/hooks/useAdmin';

export default function AdminGuaranteeClaimDetailPage() {
  const params = useParams();
  const router = useRouter();
  const claimId = params.id as string;

  const { data, isLoading, isError } = useAdminDispute(claimId);

  function handleResolved() {
    router.push('/admin/guarantee' as Route);
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (isError || !data?.dispute) {
    return (
      <div className="space-y-6">
        <Link
          href={'/admin/guarantee' as Route}
          className="flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Guarantee Claims
        </Link>
        <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load guarantee claim details.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={'/admin/guarantee' as Route}
        className="flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Guarantee Claims
      </Link>

      <GuaranteeClaimReview
        claim={data.dispute}
        onResolved={handleResolved}
      />
    </div>
  );
}
