'use client';

import { ArrowLeft, ChevronDown, ChevronUp, Printer } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { InvoiceTemplate } from '@/components/providers/InvoiceTemplate';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useContracts } from '@/hooks/useContracts';
import { useProviderProfile } from '@/hooks/useProviderProfile';
import { formatCents } from '@/lib/utils';
import type { Contract } from '@/types';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function InvoiceRow({ contract, providerName, providerAddress }: {
  contract: Contract;
  providerName: string;
  providerAddress?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  function handlePrint() {
    window.print();
  }

  return (
    <div className="border-b last:border-0">
      <button
        type="button"
        onClick={() => { setExpanded(!expanded); }}
        className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/50 min-h-[44px]"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-4">
          <div>
            <p className="text-sm font-medium">{contract.contract_number}</p>
            <p className="text-xs text-zinc-400">
              {contract.job_title || contract.job_id.slice(0, 8)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm font-bold tabular-nums">{formatCents(contract.amount_cents)}</p>
            <p className="text-xs text-zinc-400">
              {contract.completed_at ? formatDate(contract.completed_at) : formatDate(contract.created_at)}
            </p>
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-zinc-400" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4 text-zinc-400" aria-hidden="true" />
          )}
        </div>
      </button>

      {expanded ? (
        <div className="border-t bg-muted/20 p-4">
          <div className="mb-4 flex justify-end no-print">
            <Button
              variant="outline"
              size="sm"
              className="min-h-[44px] gap-2"
              onClick={handlePrint}
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print Invoice
            </Button>
          </div>
          <InvoiceTemplate
            contract={contract}
            providerName={providerName}
            providerAddress={providerAddress}
          />
        </div>
      ) : null}
    </div>
  );
}

export default function InvoicesPage() {
  const { data: contractsData, isLoading: contractsLoading } = useContracts({
    status: 'completed',
    page_size: 50,
  });
  const { data: profile, isLoading: profileLoading } = useProviderProfile();

  const isLoading = contractsLoading || profileLoading;

  const contracts = contractsData?.contracts ?? [];
  const providerName = profile?.businessName ?? 'Provider';
  const providerAddress = profile?.serviceAddress ?? undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/provider/business"
          className="flex min-h-[44px] items-center gap-1 text-sm text-zinc-400 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Business Services
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
        <p className="mt-1 text-zinc-400">
          View and print invoices for your completed contracts.
        </p>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={`skel-inv-${String(i)}`} className="h-16 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : contracts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-zinc-400">
              No completed contracts found. Invoices will appear here after you complete jobs.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Completed Contracts ({String(contracts.length)})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {contracts.map((contract) => (
              <InvoiceRow
                key={contract.id}
                contract={contract}
                providerName={providerName}
                providerAddress={providerAddress}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
