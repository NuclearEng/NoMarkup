'use client';

import { Award, ChevronDown, ChevronUp, Loader2, ShieldCheck, Star, Zap } from 'lucide-react';
import { useState } from 'react';

import { TrustScoreBadge } from '@/components/providers/TrustScoreBadge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAwardBid } from '@/hooks/useBids';
import { cn, formatCents, formatRelativeTime } from '@/lib/utils';
import type { BidWithProvider, TrustTier } from '@/types';
import { TRUST_TIER } from '@/types';

interface BidCardProps {
  bidWithProvider: BidWithProvider;
  jobId: string;
  canAward: boolean;
}

/** Trust-tier ring colors for the avatar border */
const TRUST_RING_COLORS: Record<TrustTier, string> = {
  [TRUST_TIER.TOP_RATED]: 'ring-amber-400 dark:ring-amber-500',
  [TRUST_TIER.TRUSTED]: 'ring-violet-400 dark:ring-violet-500',
  [TRUST_TIER.RISING]: 'ring-emerald-400 dark:ring-emerald-500',
  [TRUST_TIER.NEW]: 'ring-sky-400 dark:ring-sky-500',
  [TRUST_TIER.UNDER_REVIEW]: 'ring-gray-300 dark:ring-gray-600',
};

/** SVG stroke colors matching the trust tier for the score gauge */
const TRUST_GAUGE_STROKE: Record<TrustTier, string> = {
  [TRUST_TIER.TOP_RATED]: 'stroke-amber-500',
  [TRUST_TIER.TRUSTED]: 'stroke-violet-500',
  [TRUST_TIER.RISING]: 'stroke-emerald-500',
  [TRUST_TIER.NEW]: 'stroke-sky-500',
  [TRUST_TIER.UNDER_REVIEW]: 'stroke-gray-400',
};

/** Text colors for the numeric trust score */
const TRUST_SCORE_TEXT: Record<TrustTier, string> = {
  [TRUST_TIER.TOP_RATED]: 'text-amber-600 dark:text-amber-400',
  [TRUST_TIER.TRUSTED]: 'text-violet-600 dark:text-violet-400',
  [TRUST_TIER.RISING]: 'text-emerald-600 dark:text-emerald-400',
  [TRUST_TIER.NEW]: 'text-sky-600 dark:text-sky-400',
  [TRUST_TIER.UNDER_REVIEW]: 'text-gray-500 dark:text-gray-400',
};

function getInitials(displayName: string): string {
  return displayName
    .split(' ')
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Renders a small SVG circular gauge for the trust score */
function TrustScoreGauge({ score, tier }: { score: number; tier: TrustTier }) {
  const scorePercent = Math.round(score * 100);
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * score;
  const strokeColor = TRUST_GAUGE_STROKE[tier];
  const textColor = TRUST_SCORE_TEXT[tier];

  return (
    <div
      className="relative flex-shrink-0"
      aria-label={`Trust score: ${String(scorePercent)} out of 100`}
      role="img"
    >
      <svg width="44" height="44" viewBox="0 0 44 44" className="-rotate-90" aria-hidden="true">
        {/* Background track */}
        <circle cx="22" cy="22" r={radius} fill="none" className="stroke-muted" strokeWidth="3" />
        {/* Filled arc */}
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          className={strokeColor}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${String(filled)} ${String(circumference - filled)}`}
        />
      </svg>
      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center text-xs font-bold',
          textColor,
        )}
        aria-hidden="true"
      >
        {String(scorePercent)}
      </span>
    </div>
  );
}

/** Renders filled / half / empty stars for a fractional rating */
function StarRating({ rating, max = 5 }: { rating: number; max?: number }) {
  const stars = [];
  for (let i = 1; i <= max; i++) {
    if (rating >= i) {
      // Full star
      stars.push(
        <Star key={i} className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" aria-hidden="true" />,
      );
    } else if (rating >= i - 0.5) {
      // Half star — render a full star with a clip mask
      stars.push(
        <span key={i} className="relative inline-flex h-3.5 w-3.5" aria-hidden="true">
          <Star className="absolute h-3.5 w-3.5 text-yellow-400/30" />
          <span className="absolute inset-0 overflow-hidden" style={{ width: '50%' }}>
            <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
          </span>
        </span>,
      );
    } else {
      // Empty star
      stars.push(<Star key={i} className="h-3.5 w-3.5 text-yellow-400/30" aria-hidden="true" />);
    }
  }
  return (
    <div
      className="flex items-center gap-0.5"
      aria-label={`${rating.toFixed(1)} out of ${String(max)} stars`}
      role="img"
    >
      {stars}
    </div>
  );
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

  const isAwarded = bid.status === 'awarded';
  const trustTier = trust_score?.tier;
  const ringColor = trustTier ? TRUST_RING_COLORS[trustTier] : undefined;

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
    <Card
      className={cn(
        'transition-shadow duration-200',
        isAwarded &&
          'border-green-400 shadow-[0_0_12px_-3px_rgba(34,197,94,0.3)] dark:border-green-600 dark:shadow-[0_0_12px_-3px_rgba(34,197,94,0.2)]',
      )}
    >
      <CardContent className="space-y-4 pt-6">
        {/* ── 1. Provider identity ── */}
        <div className="flex items-start gap-3">
          <Avatar
            className={cn('h-11 w-11 flex-shrink-0', ringColor && `ring-[2.5px] ${ringColor}`)}
          >
            {provider_avatar_url ? (
              <AvatarImage src={provider_avatar_url} alt={provider_display_name} />
            ) : null}
            <AvatarFallback>{getInitials(provider_display_name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate leading-tight font-medium">{provider_display_name}</p>
            {provider_business_name ? (
              <p className="text-muted-foreground truncate text-sm">{provider_business_name}</p>
            ) : null}
          </div>
        </div>

        {/* ── 2. Bid amount (prominent) ── */}
        <div className="flex items-baseline justify-between">
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {formatCents(bid.amount_cents)}
          </p>
          <p className="text-muted-foreground text-xs">
            {formatRelativeTime(new Date(bid.created_at))}
          </p>
        </div>

        {/* ── 3. Trust & credibility bar ── */}
        {(trust_score ?? review_summary) ? (
          <div className="bg-muted/40 rounded-lg border p-3">
            <div className="flex items-center gap-3">
              {/* Trust score gauge */}
              {trust_score ? (
                <TrustScoreGauge score={trust_score.overall_score} tier={trust_score.tier} />
              ) : null}

              {/* Right side: tier badge + stars + stats */}
              <div className="min-w-0 flex-1 space-y-1.5">
                {/* Tier badge + verified indicator */}
                <div className="flex items-center gap-2">
                  {trust_score ? (
                    <TrustScoreBadge
                      tier={trust_score.tier}
                      score={trust_score.overall_score}
                      size="sm"
                    />
                  ) : null}
                  {trust_score ? (
                    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      Verified
                    </span>
                  ) : null}
                </div>

                {/* Star rating */}
                {review_summary ? (
                  <div className="flex items-center gap-1.5">
                    <StarRating rating={review_summary.average_rating} />
                    <span className="text-xs font-medium">
                      {review_summary.average_rating.toFixed(1)}
                    </span>
                  </div>
                ) : null}

                {/* Key stats row */}
                <div className="text-muted-foreground flex items-center gap-1 text-xs">
                  <span>
                    {String(jobs_completed)} job{jobs_completed !== 1 ? 's' : ''}
                  </span>
                  {review_summary ? (
                    <>
                      <span aria-hidden="true" className="text-border">
                        |
                      </span>
                      <span>{String(Math.round(review_summary.on_time_rate * 100))}% on-time</span>
                      <span aria-hidden="true" className="text-border">
                        |
                      </span>
                      <span>
                        {String(review_summary.review_count)} review
                        {review_summary.review_count !== 1 ? 's' : ''}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Fallback for providers without any trust/review data */
          <p className="text-muted-foreground text-xs">
            {String(jobs_completed)} job{jobs_completed !== 1 ? 's' : ''} completed
          </p>
        )}

        {/* ── 4. Status badges ── */}
        {bid.is_offer_accepted || isAwarded ? (
          <div className="flex flex-wrap gap-2">
            {bid.is_offer_accepted ? (
              <Badge variant="default" className="gap-1">
                <Zap className="h-3 w-3" aria-hidden="true" />
                Offer Accepted
              </Badge>
            ) : null}

            {isAwarded ? (
              <Badge variant="default" className="gap-1 bg-green-600 hover:bg-green-700">
                <Award className="h-3 w-3" aria-hidden="true" />
                Awarded
              </Badge>
            ) : null}
          </div>
        ) : null}

        {/* ── 5. Bid history (collapsible) ── */}
        {bid.bid_history.length > 0 ? (
          <div>
            <button
              type="button"
              className={cn(
                'text-muted-foreground flex min-h-[44px] w-full items-center justify-between text-sm',
                'hover:text-foreground',
              )}
              onClick={() => {
                setShowHistory(!showHistory);
              }}
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
                    <span className="text-muted-foreground ml-2">
                      {formatRelativeTime(new Date(update.updated_at))}
                    </span>
                    {index === bid.bid_history.length - 1 ? (
                      <span className="text-muted-foreground ml-2 text-xs">(original)</span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ── 6. Award button ── */}
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
                  onClick={() => {
                    setShowAwardConfirm(false);
                  }}
                  disabled={awardBid.isPending}
                >
                  Cancel
                </Button>
              </div>
              {awardBid.isError ? (
                <p className="text-destructive text-sm">Failed to award bid. Please try again.</p>
              ) : null}
            </div>
          ) : (
            <Button variant="outline" className="min-h-[44px] w-full" onClick={handleAward}>
              <Award className="h-4 w-4" aria-hidden="true" />
              Award Job
            </Button>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
