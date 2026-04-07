'use client';

import { CheckCircle2, Clock, XCircle, Zap } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCountdown } from '@/hooks/useCountdown';
import { useAcceptOffer, useDeclineOffer, useProviderOffers } from '@/hooks/useInstantMatch';
import { formatCents } from '@/lib/utils';

interface OfferCardProps {
  jobId: string;
  jobTitle: string;
  expiresAt: string;
  amountCents: number;
}

function OfferCountdown({ expiresAt }: { expiresAt: string }) {
  const { timeLeft, isExpired, totalSeconds } = useCountdown(expiresAt);

  const urgencyClass =
    isExpired
      ? 'text-destructive'
      : totalSeconds < 180
        ? 'text-orange-400'
        : 'text-emerald-400';

  return (
    <span className={`font-mono text-sm font-semibold tabular-nums ${urgencyClass}`}>
      {isExpired ? 'Expired' : timeLeft}
    </span>
  );
}

function OfferCard({ jobId, jobTitle, expiresAt, amountCents }: OfferCardProps) {
  const accept = useAcceptOffer(jobId);
  const decline = useDeclineOffer(jobId);
  const { isExpired } = useCountdown(expiresAt);

  const isPending = accept.isPending || decline.isPending;

  return (
    <Card className="border-border/50 bg-card/60 backdrop-blur-sm transition-all duration-200 hover:border-border">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <h3 className="truncate text-base font-semibold text-zinc-100">{jobTitle}</h3>

            <div className="flex flex-wrap items-center gap-3">
              {amountCents > 0 ? (
                <Badge variant="secondary" className="text-xs font-medium">
                  {formatCents(amountCents)}
                </Badge>
              ) : null}

              <span
                className="flex items-center gap-1 text-xs text-zinc-400"
                aria-label={`Offer expires in ${expiresAt}`}
              >
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                <OfferCountdown expiresAt={expiresAt} />
              </span>
            </div>
          </div>

          {!isExpired ? (
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                className="min-h-[36px] bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => void accept.mutateAsync()}
                disabled={isPending}
                aria-label={`Accept offer for ${jobTitle}`}
              >
                <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="min-h-[36px]"
                onClick={() => void decline.mutateAsync()}
                disabled={isPending}
                aria-label={`Decline offer for ${jobTitle}`}
              >
                <XCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Decline
              </Button>
            </div>
          ) : (
            <Badge variant="destructive" className="shrink-0 text-xs">
              Expired
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function OffersSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="border-border/50 bg-card/60">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
              </div>
              <div className="flex shrink-0 gap-2">
                <Skeleton className="h-9 w-20" />
                <Skeleton className="h-9 w-20" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function ProviderOffersPage() {
  const { data, isLoading, isError } = useProviderOffers();

  const activeOffers = (data?.offers ?? []).filter((o) => {
    if (!o.expires_at) return false;
    return new Date(o.expires_at).getTime() > Date.now();
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
          <Zap className="h-5 w-5 text-amber-400" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Pending Offers</h1>
          <p className="text-sm text-zinc-400">
            Instant match requests from customers looking for fast help.
          </p>
        </div>
      </div>

      {isLoading ? (
        <OffersSkeleton />
      ) : isError ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center gap-3 p-5 text-sm text-destructive">
            <XCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span>Failed to load offers. Please refresh the page to try again.</span>
          </CardContent>
        </Card>
      ) : activeOffers.length === 0 ? (
        <Card className="border-border/40 bg-card/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-zinc-300">No pending offers right now</CardTitle>
          </CardHeader>
          <CardContent className="pb-6 text-sm text-zinc-400">
            <p>
              We&apos;ll notify you when jobs match your skills. Make sure your service categories
              are up to date in your profile.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div
          className="space-y-3"
          aria-label={`${String(activeOffers.length)} pending offer${activeOffers.length !== 1 ? 's' : ''}`}
          aria-live="polite"
        >
          {activeOffers.map((offer) => (
            <OfferCard
              key={offer.job_id}
              jobId={offer.job_id}
              jobTitle={offer.job_title || 'Untitled Job'}
              expiresAt={offer.expires_at}
              amountCents={offer.amount_cents}
            />
          ))}
        </div>
      )}

      <p className="text-center text-xs text-zinc-500" aria-live="polite">
        Auto-refreshing every 30 seconds
      </p>
    </div>
  );
}
