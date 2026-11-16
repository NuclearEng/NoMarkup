'use client';

import { ArrowLeft, ChevronDown, ChevronUp, Download, Loader2, Printer } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { InvoiceTemplate } from '@/components/providers/InvoiceTemplate';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageTransition } from '@/components/ui/page-transition';
import { Skeleton } from '@/components/ui/skeleton';
import { useContracts } from '@/hooks/useContracts';
import { useProviderProfile } from '@/hooks/useProviderProfile';
import { useGenerateInvoice } from '@/hooks/useTaxForms';
import { printAuthenticatedDocument } from '@/lib/print';
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
  const [printing, setPrinting] = useState(false);
  const generateInvoice = useGenerateInvoice();

  async function handlePrint() {
    setPrinting(true);
    try {
      // Print the server-generated invoice document (full data + its own
      // institutional print stylesheet), not the live dashboard page.
      await printAuthenticatedDocument(`/api/v1/contracts/${contract.id}/invoice/download`);
    } catch {
      toast.error('Could not open the invoice for printing. Please try again.');
    } finally {
      setPrinting(false);
    }
  }

  function handleGenerateInvoice() {
    // useGenerateInvoice fetches the invoice with auth headers and triggers
    // a blob download as part of the mutation, so there's no follow-up URL
    // to surface here.
    generateInvoice.mutate(contract.id);
  }

  return (
    <div className="border-b border-white/5 last:border-0">
      <button
        type="button"
        onClick={() => { setExpanded(!expanded); }}
        className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-white/[0.04] min-h-[44px]"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-4">
          <div>
            <p className="text-sm font-medium">{contract.contract_number}</p>
            <p className="text-xs text-zinc-300">
              {contract.job_title || contract.job_id.slice(0, 8)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm font-bold tabular-nums">{formatCents(contract.amount_cents)}</p>
            <p className="text-xs text-zinc-300">
              {contract.completed_at ? formatDate(contract.completed_at) : formatDate(contract.created_at)}
            </p>
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-zinc-300" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4 text-zinc-300" aria-hidden="true" />
          )}
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-white/5 bg-white/[0.02] p-4">
          <div className="mb-4 flex justify-end gap-2 no-print">
            <Button
              variant="outline"
              size="sm"
              className="min-h-[44px] gap-2"
              disabled={generateInvoice.isPending}
              onClick={handleGenerateInvoice}
            >
              {generateInvoice.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="h-4 w-4" aria-hidden="true" />
              )}
              Generate Invoice
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-h-[44px] gap-2"
              disabled={printing}
              onClick={() => void handlePrint()}
            >
              {printing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Printer className="h-4 w-4" aria-hidden="true" />
              )}
              Print Invoice
            </Button>
          </div>
          {generateInvoice.isError ? (
            <div className="mb-3 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              Failed to generate invoice. Please try again.
            </div>
          ) : null}
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
  const providerName = profile?.business_name ?? 'Provider';
  const providerAddress = profile?.service_address ?? undefined;

  return (
    <PageTransition>
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/provider/business"
          className="flex min-h-[44px] items-center gap-1 text-sm text-zinc-300 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Business Services
        </Link>
      </div>

      <div>
        <h1 className="gold-text text-2xl font-bold tracking-tight">Invoices</h1>
        <p className="mt-1 text-zinc-300">
          View and print invoices for your completed contracts.
        </p>
      </div>

      {isLoading ? (
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardContent className="space-y-3 pt-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={`skel-inv-${String(i)}`} className="h-16 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : contracts.length === 0 ? (
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardContent className="py-12 text-center">
            <p className="text-sm text-zinc-300">
              No completed contracts found. Invoices will appear here after you complete jobs.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <CardTitle className="gold-text text-base">
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
    </PageTransition>
  );
}
