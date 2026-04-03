'use client';

import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';

import { GuaranteeClaimReview } from '@/components/admin/GuaranteeClaimReview';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTransition } from '@/components/ui/page-transition';
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
      <div className="mx-auto max-w-3xl space-y-6">
        <Skeleton variant="text" className="h-4 w-64" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-7 w-40" />
          </div>
          <Skeleton className="h-6 w-24" />
        </div>
        <div className="space-y-4 rounded-lg border p-6">
          <Skeleton className="h-5 w-28" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton variant="text" className="h-3 w-20" />
                <Skeleton variant="text" className="h-4 w-32" />
              </div>
            ))}
          </div>
          <Skeleton variant="text" className="mt-2 h-3 w-20" />
          <Skeleton className="h-16 w-full" />
        </div>
        <div className="space-y-4 rounded-lg border p-6">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-full" />
          <div className="flex gap-3">
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-10 flex-1" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !data?.dispute) {
    return (
      <div className="space-y-6">
        <Breadcrumb
          items={[
            { label: 'Admin', href: '/admin' },
            { label: 'Guarantee Claims', href: '/admin/guarantee' },
            { label: 'Detail' },
          ]}
        />
        <EmptyState
          icon={<AnimatedIllustration type="error" size="sm" />}
          title="Failed to load guarantee claim"
          description="Something went wrong loading claim details."
          className="glass border-destructive/30"
        />
      </div>
    );
  }

  return (
    <PageTransition>
    <div className="mx-auto max-w-3xl space-y-6">
      <Breadcrumb
        items={[
          { label: 'Admin', href: '/admin' },
          { label: 'Guarantee Claims', href: '/admin/guarantee' },
          { label: `Claim ${data.dispute.id.slice(0, 8)}...` },
        ]}
      />

      <GuaranteeClaimReview claim={data.dispute} onResolved={handleResolved} />
    </div>
    </PageTransition>
  );
}
