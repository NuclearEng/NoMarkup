'use client';

import {
  CheckCircle2,
  Clock,
  Loader2,
  ShieldCheck,
  Sparkles,
  TrendingDown,
} from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useFeatureFlag } from '@/hooks/useFeatureFlags';
import {
  useRequestQuotes,
  useSelectQuote,
} from '@/hooks/useInsuranceMarketplace';
import { cn, formatCents, humanizeStatus } from '@/lib/utils';
import type {
  InsuranceCompetitiveQuote,
  SelectInsuranceQuoteResponse,
} from '@/types';
import { INSURANCE_PRODUCT_TYPE } from '@/types';

interface InsuranceQuoteCompareProps {
  /** When launched from a contract, pre-binds the quote request to it. */
  contractId?: string;
  /** Seed the coverage field (e.g. the contract amount). */
  defaultCoverageCents?: number;
  /** Lock the product type (e.g. a contract always insures the job). */
  defaultProductType?: string;
  className?: string;
}

const PRODUCT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: INSURANCE_PRODUCT_TYPE.COMPLETION_GUARANTEE, label: 'Job completion guarantee' },
  { value: INSURANCE_PRODUCT_TYPE.PROPERTY_DAMAGE, label: 'Property damage' },
  { value: INSURANCE_PRODUCT_TYPE.WORKMANSHIP_WARRANTY, label: 'Workmanship warranty' },
  { value: INSURANCE_PRODUCT_TYPE.LIABILITY, label: 'Liability' },
];

function formatExpiry(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'soon';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** One competing insurer's offer, side-by-side with the others. */
function QuoteCard({
  quote,
  cheapest,
  bound,
  selecting,
  onSelect,
  disabled,
}: {
  quote: InsuranceCompetitiveQuote;
  cheapest: boolean;
  bound: boolean;
  selecting: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  return (
    <Card
      className={cn(
        'glass relative flex flex-col border',
        cheapest
          ? 'border-[var(--brand-gold)]/40 glass-highlight'
          : 'border-white/10',
        bound && 'border-emerald-500/50 bg-emerald-500/5',
      )}
    >
      {cheapest && !bound ? (
        <Badge
          variant="outline"
          className="absolute -top-2.5 left-4 gap-1 border-[var(--brand-gold)]/40 bg-background text-[var(--brand-gold)]"
        >
          <TrendingDown className="h-3 w-3" aria-hidden="true" />
          Lowest premium
        </Badge>
      ) : null}

      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck
            className="h-4 w-4 text-[var(--brand-gold)]"
            aria-hidden="true"
          />
          <CardTitle className="text-base">{quote.insurer_name}</CardTitle>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col space-y-3">
        <div>
          <p className="text-xs text-zinc-400">Premium</p>
          <p className="text-2xl font-bold tabular-nums">
            {formatCents(quote.premium_cents)}
          </p>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-400">Deductible</span>
          <span className="font-medium tabular-nums">
            {formatCents(quote.deductible_cents)}
          </span>
        </div>

        <div className="space-y-1">
          <span className="text-xs text-zinc-400">Terms</span>
          <p className="text-sm text-zinc-200">{quote.terms}</p>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-zinc-400">
          <Clock className="h-3 w-3" aria-hidden="true" />
          <span>Expires {formatExpiry(quote.expires_at)}</span>
        </div>

        <div className="flex-1" />

        {bound ? (
          <div className="flex items-center justify-center gap-2 rounded-lg bg-emerald-500/10 py-2.5 text-sm font-medium text-emerald-300">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Selected
          </div>
        ) : (
          <Button
            className="min-h-[44px] w-full"
            variant={cheapest ? 'default' : 'outline'}
            onClick={onSelect}
            disabled={disabled}
          >
            {selecting ? (
              <Loader2
                className="mr-1.5 h-4 w-4 animate-spin"
                aria-hidden="true"
              />
            ) : null}
            Select {quote.insurer_name}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** The comparison grid + per-quote select, shown once a request returns. */
function QuoteComparison({
  requestId,
  quotes,
}: {
  requestId: string;
  quotes: InsuranceCompetitiveQuote[];
}) {
  const selectQuote = useSelectQuote(requestId);
  const [boundPolicy, setBoundPolicy] =
    useState<SelectInsuranceQuoteResponse | null>(null);
  const [boundQuoteId, setBoundQuoteId] = useState<string | null>(null);

  // Quotes arrive premium-asc per the contract, but recompute the cheapest id
  // defensively so the highlight is correct even if ordering ever changes.
  const cheapestId = useMemo(() => {
    if (quotes.length === 0) return null;
    return quotes.reduce((min, q) =>
      q.premium_cents < min.premium_cents ? q : min,
    ).quote_id;
  }, [quotes]);

  if (quotes.length === 0) {
    return (
      <EmptyState
        icon={<AnimatedIllustration type="search-empty" size="sm" />}
        title="No insurers competing yet"
        description="No carriers returned an offer for this coverage. Try a different coverage amount or check back shortly."
        className="glass border-white/10"
      />
    );
  }

  function handleSelect(quoteId: string) {
    selectQuote.mutate(quoteId, {
      onSuccess: (data) => {
        setBoundPolicy(data);
        setBoundQuoteId(quoteId);
      },
    });
  }

  return (
    <div className="space-y-4">
      {boundPolicy ? (
        <Card
          className="glass border-emerald-500/40 bg-emerald-500/5"
          role="status"
        >
          <CardContent className="flex items-center gap-3 pt-6">
            <CheckCircle2
              className="h-6 w-6 shrink-0 text-emerald-400"
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold text-emerald-200">
                You&apos;re covered
              </p>
              <p className="text-sm text-emerald-300/80">
                Your policy with {boundPolicy.insurer_name} is{' '}
                {humanizeStatus(boundPolicy.status).toLowerCase()}.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex items-center gap-2 text-sm text-zinc-300">
          <Sparkles
            className="h-4 w-4 text-[var(--brand-gold)]"
            aria-hidden="true"
          />
          <span>
            {quotes.length} {quotes.length === 1 ? 'insurer is' : 'insurers are'}{' '}
            competing for your business — pick the one you want.
          </span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {quotes.map((quote) => (
          <QuoteCard
            key={quote.quote_id}
            quote={quote}
            cheapest={quote.quote_id === cheapestId}
            bound={boundQuoteId === quote.quote_id}
            selecting={
              selectQuote.isPending &&
              selectQuote.variables === quote.quote_id
            }
            onSelect={() => {
              handleSelect(quote.quote_id);
            }}
            // Once bound, lock the whole grid; while a select is in flight,
            // disable the others to prevent a double-bind.
            disabled={boundPolicy !== null || selectQuote.isPending}
          />
        ))}
      </div>
    </div>
  );
}

export function InsuranceQuoteCompare({
  contractId,
  defaultCoverageCents,
  defaultProductType,
  className,
}: InsuranceQuoteCompareProps) {
  const enabled = useFeatureFlag('insurance_competition');
  const requestQuotes = useRequestQuotes();

  const productTypeId = useId();
  const coverageId = useId();

  const [productType, setProductType] = useState<string>(
    defaultProductType ?? INSURANCE_PRODUCT_TYPE.COMPLETION_GUARANTEE,
  );
  // Coverage is held as a dollar string for the input; converted to cents on
  // submit. Money is integer cents end-to-end (never float dollars on the wire).
  const [coverageDollars, setCoverageDollars] = useState<string>(
    defaultCoverageCents ? String(Math.round(defaultCoverageCents / 100)) : '',
  );

  // Gate the entire surface. Placed after hooks to respect the Rules of Hooks.
  if (!enabled) {
    return null;
  }

  const coverageCents = Math.round(Number(coverageDollars) * 100);
  const coverageValid =
    coverageDollars.trim() !== '' &&
    Number.isFinite(coverageCents) &&
    coverageCents > 0;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!coverageValid || requestQuotes.isPending) return;
    requestQuotes.mutate({
      product_type: productType,
      coverage_cents: coverageCents,
      ...(contractId ? { contract_id: contractId } : {}),
    });
  }

  const result = requestQuotes.data;

  return (
    <div className={cn('space-y-6', className)}>
      <div>
        <h2 className="gold-text text-xl font-semibold">
          Compare insurance quotes
        </h2>
        <p className="mt-1 text-sm text-zinc-300">
          Tell us what to cover and competing insurers will bid for your
          policy. You pick the winner — we never mark it up.
        </p>
      </div>

      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={productTypeId}>What are you insuring?</Label>
                <select
                  id={productTypeId}
                  value={productType}
                  disabled={!!defaultProductType}
                  onChange={(e) => {
                    setProductType(e.target.value);
                  }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {PRODUCT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={coverageId}>Coverage amount (USD)</Label>
                <Input
                  id={coverageId}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  placeholder="5000"
                  value={coverageDollars}
                  onChange={(e) => {
                    setCoverageDollars(e.target.value);
                  }}
                  aria-describedby={
                    coverageValid ? undefined : `${coverageId}-hint`
                  }
                />
                {!coverageValid && coverageDollars.trim() !== '' ? (
                  <p
                    id={`${coverageId}-hint`}
                    className="text-xs text-destructive"
                  >
                    Enter a coverage amount greater than $0.
                  </p>
                ) : null}
              </div>
            </div>

            <Button
              type="submit"
              className="min-h-[44px] w-full sm:w-auto"
              disabled={!coverageValid || requestQuotes.isPending}
            >
              {requestQuotes.isPending ? (
                <Loader2
                  className="mr-1.5 h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
              ) : null}
              {result ? 'Re-quote' : 'Get competing quotes'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Loading */}
      {requestQuotes.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : null}

      {/* Error */}
      {requestQuotes.isError ? (
        <EmptyState
          icon={<AnimatedIllustration type="error" size="sm" />}
          title="Couldn't get quotes"
          description="We hit a problem reaching insurers. Please try again."
          className="glass border-destructive/30"
          action={
            <Button
              variant="outline"
              className="min-h-[44px]"
              onClick={() => {
                if (coverageValid) {
                  requestQuotes.mutate({
                    product_type: productType,
                    coverage_cents: coverageCents,
                    ...(contractId ? { contract_id: contractId } : {}),
                  });
                }
              }}
            >
              Try again
            </Button>
          }
        />
      ) : null}

      {/* Success — comparison */}
      {result && !requestQuotes.isPending ? (
        <QuoteComparison requestId={result.request_id} quotes={result.quotes} />
      ) : null}
    </div>
  );
}
