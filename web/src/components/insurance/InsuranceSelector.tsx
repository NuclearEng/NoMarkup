'use client';

import { CheckCircle2, Loader2, Shield } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useInsuranceProducts, useInsuranceQuote, usePurchaseInsurance } from '@/hooks/useInsurance';
import { formatCents } from '@/lib/utils';
import type { InsuranceProduct } from '@/types';

interface InsuranceSelectorProps {
  contractId: string;
  paymentMethodId: string;
  onComplete?: () => void;
  className?: string;
}

function InsuranceProductCard({
  product,
  contractId,
  paymentMethodId,
  onPurchased,
}: {
  product: InsuranceProduct;
  contractId: string;
  paymentMethodId: string;
  onPurchased: () => void;
}) {
  const { data: quoteData, isLoading: quoteLoading } = useInsuranceQuote(contractId, product.id);
  const purchaseInsurance = usePurchaseInsurance();
  const [purchased, setPurchased] = useState(false);

  const quote = quoteData?.quote;

  function handlePurchase() {
    purchaseInsurance.mutate(
      {
        contract_id: contractId,
        product_id: product.id,
        payment_method_id: paymentMethodId,
      },
      {
        onSuccess: () => {
          setPurchased(true);
          onPurchased();
        },
      },
    );
  }

  if (purchased) {
    return (
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <CardContent className="flex items-center gap-3 pt-6">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-emerald-300">{product.name} added</p>
            {quote ? (
              <p className="text-xs text-emerald-400/70">
                Premium: {formatCents(quote.premium_cents)}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-[var(--brand-gold)]" aria-hidden="true" />
            <CardTitle className="text-sm">{product.name}</CardTitle>
          </div>
          <Badge variant="outline" className="text-xs">
            {product.coverage_type}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-zinc-300">{product.description}</p>

        {quoteLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
        ) : quote ? (
          <div className="space-y-1.5 rounded-lg bg-white/[0.02] p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">Premium</span>
              <span className="font-bold tabular-nums">{formatCents(quote.premium_cents)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">Coverage</span>
              <span className="tabular-nums">{formatCents(quote.coverage_amount_cents)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">Deductible</span>
              <span className="tabular-nums">{formatCents(quote.deductible_cents)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">Duration</span>
              <span>{String(quote.coverage_duration_days)} days</span>
            </div>
          </div>
        ) : null}

        <Button
          className="min-h-[44px] w-full"
          onClick={handlePurchase}
          disabled={purchaseInsurance.isPending || !quote}
        >
          {purchaseInsurance.isPending ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : null}
          Add Protection
        </Button>

        {purchaseInsurance.isError ? (
          <p className="text-xs text-destructive">Failed to purchase. Please try again.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function InsuranceSelector({
  contractId,
  paymentMethodId,
  onComplete,
  className,
}: InsuranceSelectorProps) {
  const { data: productsData, isLoading, isError } = useInsuranceProducts();

  const products = productsData?.products ?? [];

  if (isLoading) {
    return (
      <div className={className}>
        <div className="space-y-3">
          <Skeleton className="h-6 w-48" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || products.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      <div className="space-y-4">
        <div>
          <h3 className="gold-text text-lg font-semibold">Protect Your Project</h3>
          <p className="mt-1 text-sm text-zinc-300">
            Optional insurance coverage for your contract. You can skip this step.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {products.map((product) => (
            <InsuranceProductCard
              key={product.id}
              product={product}
              contractId={contractId}
              paymentMethodId={paymentMethodId}
              onPurchased={() => {
                onComplete?.();
              }}
            />
          ))}
        </div>

        <Button
          variant="ghost"
          className="min-h-[44px] w-full text-zinc-400"
          onClick={() => {
            onComplete?.();
          }}
        >
          Skip Insurance
        </Button>
      </div>
    </div>
  );
}
