'use client';

import { Award, ChevronDown, ChevronUp, Loader2, Star, Zap } from 'lucide-react';
import { useState } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAwardBid } from '@/hooks/useBids';
import { cn, formatCents, formatRelativeTime } from '@/lib/utils';
import type { BidWithProvider } from '@/types';
import { TRUST_TIER } from '@/types';

interface BidCardProps {
  bidWithProvider: BidWithProvider;
  jobId: string;
  canAward: boolean;
}

function getTrustTierLabel(tier: string): string {
  switch (tier) {
    case TRUST_TIER.TOP_RATED:
      return 'Top Rated';
    case TRUST_TIER.TRUSTED:
      return 'Trusted';
    case TRUST_TIER.RISING:
      return 'Rising';
    case TRUST_TIER.NEW:
      return 'New';
    case TRUST_TIER.UNDER_REVIEW:
      return 'Under Review';
    default:
      return tier;
  }
}

function getTrustTierVariant(
  tier: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (tier) {
    case TRUST_TIER.TOP_RATED:
      return 'default';
    case TRUST_TIER.TRUSTED:
      return 'secondary';
    default:
      return 'outline';
  }
}

function getInitials(displayName: string): string {
  return displayName
    .split(' ')
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function BidCard({ bidWithProvider, jobId, canAward }: BidCardProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [showAwardConfirm, setShowAwardConfirm] = useState(false);
  const awardBid = useAwardBid();

  const {
    bid,
    provider_display_name,
    provider_business_name,
    provider_avatar_url,
    trust_score,
    review_summary,
    jobs_completed,
  } = bidWithProvider;

  function handleAward() {
    setShowAwardConfirm(true);
  }

  function handleConfirmAward() {
    awardBid.mutate(
      { jobId, bidId: bid.id },
      {
        onSuccess: () => {
          setShowAwardConfirm(false);
        },
      },
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {/* Provider info row */}
        <div className="flex items-start gap-3">
          <Avatar>
            {provider_avatar_url ? (
              <AvatarImage src={provider_avatar_url} alt={provider_display_name} />
            ) : null}
            <AvatarFallback>{getInitials(provider_display_name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{provider_display_name}</p>
            {provider_business_name ? (
              <p className="truncate text-sm text-muted-foreground">
                {provider_business_name}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {String(jobs_completed)} job{jobs_completed !== 1 ? 's' : ''} completed
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold">{formatCents(bid.amount_cents)}</p>
            <p className="text-xs text-muted-foreground">
              {formatRelativeTime(new Date(bid.created_at))}
            </p>
          </div>
        </div>

        {/* Badges row */}
        <div className="flex flex-wrap gap-2">
          {bid.is_offer_accepted ? (
            <Badge variant="default" className="gap-1">
              <Zap className="h-3 w-3" aria-hidden="true" />
              Offer Accepted
            </Badge>
          ) : null}

          {trust_score ? (
            <Badge variant={getTrustTierVariant(trust_score.tier)}>
              {getTrustTierLabel(trust_score.tier)}
            </Badge>
          ) : null}

          {bid.status === 'awarded' ? (
            <Badge variant="default" className="gap-1 bg-green-600 hover:bg-green-700">
              <Award className="h-3 w-3" aria-hidden="true" />
              Awarded
            </Badge>
          ) : null}
        </div>

        {/* Review summary */}
        {review_summary ? (
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1">
              <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" aria-hidden="true" />
              <span className="font-medium">
                {review_summary.average_rating.toFixed(1)}
              </span>
              <span className="text-muted-foreground">
                ({String(review_summary.review_count)} review
                {review_summary.review_count !== 1 ? 's' : ''})
              </span>
            </div>
            <span className="text-muted-foreground">
              {String(Math.round(review_summary.on_time_rate * 100))}% on time
            </span>
          </div>
        ) : null}

        {/* Bid history (expandable) */}
        {bid.bid_history.length > 0 ? (
          <div>
            <button
              type="button"
              className={cn(
                'flex min-h-[44px] w-full items-center justify-between text-sm text-muted-foreground',
                'hover:text-foreground',
              )}
              onClick={() => { setShowHistory(!showHistory); }}
              aria-expanded={showHistory}
            >
              <span>
                Bid History ({String(bid.bid_history.length)} update
                {bid.bid_history.length !== 1 ? 's' : ''})
              </span>
              {showHistory ? (
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
            {showHistory ? (
              <div className="mt-2 space-y-2 border-l-2 pl-4">
                {bid.bid_history.map((update, index) => (
                  <div key={update.updated_at} className="text-sm">
                    <span className="font-medium">{formatCents(update.amount_cents)}</span>
                    <span className="ml-2 text-muted-foreground">
                      {formatRelativeTime(new Date(update.updated_at))}
                    </span>
                    {index === bid.bid_history.length - 1 ? (
                      <span className="ml-2 text-xs text-muted-foreground">(original)</span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Award button */}
        {canAward && bid.status === 'active' ? (
          showAwardConfirm ? (
            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-sm">
                Award this job to <span className="font-medium">{provider_display_name}</span> at{' '}
                <span className="font-semibold">{formatCents(bid.amount_cents)}</span>?
              </p>
              <div className="flex gap-3">
                <Button
                  className="min-h-[44px] flex-1"
                  onClick={handleConfirmAward}
                  disabled={awardBid.isPending}
                >
                  {awardBid.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  Confirm Award
                </Button>
                <Button
                  variant="outline"
                  className="min-h-[44px]"
                  onClick={() => { setShowAwardConfirm(false); }}
                  disabled={awardBid.isPending}
                >
                  Cancel
                </Button>
              </div>
              {awardBid.isError ? (
                <p className="text-sm text-destructive">
                  Failed to award bid. Please try again.
                </p>
              ) : null}
            </div>
          ) : (
            <Button
              variant="outline"
              className="min-h-[44px] w-full"
              onClick={handleAward}
            >
              <Award className="h-4 w-4" aria-hidden="true" />
              Award Job
            </Button>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
