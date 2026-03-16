'use client';

import { ArrowLeft } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import { GuaranteeClaimForm } from '@/components/contracts/GuaranteeClaimForm';
import { Skeleton } from '@/components/ui/skeleton';
import { useContract } from '@/hooks/useContracts';

export default function GuaranteeClaimPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const contractId = params.id;
  const { data, isLoading, isError } = useContract(contractId);

  function handleSuccess() {
    router.push(`/contracts/${contractId}` as Route);
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (isError || !data) {
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
          Failed to load contract details. Please try again.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href={`/contracts/${contractId}` as Route}
        className="flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Contract {data.contract.contract_number}
      </Link>

      <GuaranteeClaimForm contractId={contractId} onSuccess={handleSuccess} />
    </div>
  );
}
