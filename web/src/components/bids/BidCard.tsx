'use client';

import {
  Award,
  ChevronDown,
  ChevronUp,
  Clock,
  Crown,
  Loader2,
  Medal,
  ShieldCheck,
  Star,
  TrendingDown,
  Zap,
} from 'lucide-react';
import { memo, useState } from 'react';

import { TrustScoreBadge } from '@/components/providers/TrustScoreBadge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { GoldAccentCard } from '@/components/ui/gold-accent-card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { WinBadge } from '@/components/ui/win-badge';
import { useAwardBid } from '@/hooks/useBids';
import { cn, formatCents, formatRelativeTime } from '@/lib/utils';
import type { BidWithProvider, TrustTier } from '@/types';
import { TRUST_TIER } from '@/types';

interface BidCardProps {
  bidWithProvider: BidWithProvider;
  jobId: string;
  canAward: boolean;
  rank?: number;
  totalBids?: number;
  startingPriceCents?: number;
  marketMedianCents?: number;
}

/** Trust-tier ring colors for the avatar border */
const TRUST_RING_COLORS: Record<TrustTier, string> = {
  [TRUST_TIER.TOP_RATED]: 'ring-brand-gold',
  [TRUST_TIER.TRUSTED]: 'ring-trust-elite',
  [TRUST_TIER.RISING]: 'ring-trust-high',
  [TRUST_TIER.NEW]: 'ring-bid-active',
  [TRUST_TIER.UNDER_REVIEW]: 'ring-muted-foreground/40',
};

/** SVG stroke colors matching the trust tier for the score gauge */
const TRUST_GAUGE_STROKE: Record<TrustTier, string> = {
  [TRUST_TIER.TOP_RATED]: 'stroke-brand-gold',
  [TRUST_TIER.TRUSTED]: 'stroke-trust-elite',
  [TRUST_TIER.RISING]: 'stroke-trust-high',
  [TRUST_TIER.NEW]: 'stroke-bid-active',
  [TRUST_TIER.UNDER_REVIEW]: 'stroke-muted-foreground',
};

/** Text colors for the numeric trust score */
const TRUST_SCORE_TEXT: Record<TrustTier, string> = {
  [TRUST_TIER.TOP_RATED]: 'text-brand-gold',
  [TRUST_TIER.TRUSTED]: 'text-trust-elite',
  [TRUST_TIER.RISING]: 'text-trust-high',
  [TRUST_TIER.NEW]: 'text-bid-active',
  [TRUST_TIER.UNDER_REVIEW]: 'text-muted-foreground',
};

/** Rank badge colors */
const RANK_STYLES: Record<number, { bg: string; text: string; border: string; label: string }> = {
  1: {
    bg: 'bg-brand-gold/15',
    text: 'text-brand-gold',
    border: 'border-brand-gold/30',
    label: 'Lowest bid',
  },
  2: {
    bg: 'bg-muted',
    text: 'text-muted-foreground',
    border: 'border-border',
    label: '2nd lowest',
  },
  3: {
    bg: 'bg-trust-medium/10',
    text: 'text-trust-medium',
    border: 'border-trust-medium/20',
    label: '3rd lowest',
  },
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

function getCompetitivePosition(
  rank: number,
  totalBids: number,
): {
  label: string;
  color: string;
} {
  if (rank === 1) return { label: 'Lowest bid', color: 'text-bid-winning' };
  if (rank === 2) return { label: '2nd lowest', color: 'text-trust-medium' };
  // Above median
  const medianPosition = Math.ceil(totalBids / 2);
  if (rank > medianPosition) {
    return { label: 'Above median', color: 'text-destructive' };
  }
  return {
    label: `${String(rank)}${getOrdinalSuffix(rank)} lowest`,
    color: 'text-trust-medium',
  };
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0] || 'th';
}

/**
 * Illustrative rank-based strength heuristic for reverse auctions.
 * NOT a trained model or calibrated win probability — purely rank bands
 * for UI orientation (FE-12).
 */
function getRankEstimate(
  rank: number,
  totalBids: number,
): {
  label: string;
  strength: number;
  color: string;
} {
  if (totalBids === 0) return { label: 'N/A', strength: 0, color: 'text-muted-foreground' };
  if (rank === 1) return { label: 'Leading', strength: 85, color: 'text-bid-winning' };
  if (rank === 2) return { label: 'Close', strength: 55, color: 'text-trust-medium' };
  if (rank <= Math.ceil(totalBids / 3))
    return { label: 'Mid pack', strength: 35, color: 'text-trust-medium' };
  return { label: 'Needs lower bid', strength: 15, color: 'text-destructive' };
}

/** Renders a small SVG circular gauge for the trust score with glow effect */
function TrustScoreGauge({ score, tier }: { score: number; tier: TrustTier }) {
  const scorePercent = Math.round(score * 100);
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * score;
  const strokeColor = TRUST_GAUGE_STROKE[tier];
  const textColor = TRUST_SCORE_TEXT[tier];

  // Glow color for the gauge arc (semantic token channels)
  const TRUST_GLOW_MAP: Record<TrustTier, string> = {
    [TRUST_TIER.TOP_RATED]: 'var(--brand-gold-glow)',
    [TRUST_TIER.TRUSTED]: 'hsl(var(--trust-elite) / 0.4)',
    [TRUST_TIER.RISING]: 'hsl(var(--trust-high) / 0.4)',
    [TRUST_TIER.NEW]: 'hsl(var(--bid-active) / 0.3)',
    [TRUST_TIER.UNDER_REVIEW]: 'color-mix(in oklch, var(--muted-foreground) 20%, transparent)',
  };
  const glowColor = TRUST_GLOW_MAP[tier];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="relative flex-shrink-0 cursor-default"
          aria-label={`Trust score: ${String(scorePercent)} out of 100`}
          role="img"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focusable for tooltip accessibility
          tabIndex={0}
        >
          <svg width="48" height="48" viewBox="0 0 48 48" className="-rotate-90" aria-hidden="true">
            <defs>
              <filter id={`trust-glow-${tier}`}>
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {/* Background track */}
            <circle cx="24" cy="24" r={radius} fill="none" className="stroke-muted" strokeWidth="3" />
            {/* Filled arc with glow */}
            <circle
              cx="24"
              cy="24"
              r={radius}
              fill="none"
              className={strokeColor}
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeDasharray={`${String(filled)} ${String(circumference - filled)}`}
              style={{ filter: `drop-shadow(0 0 3px ${glowColor})` }}
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
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-semibold">Trust Score: {String(scorePercent)}/100</p>
        <p className="mt-0.5 text-zinc-400">Composite of completion rate, quality ratings, on-time delivery, and dispute history.</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** Renders filled / half / empty stars for a fractional rating */
function StarRating({ rating, max = 5 }: { rating: number; max?: number }) {
  const stars = [];
  for (let i = 1; i <= max; i++) {
    if (rating >= i) {
      // Full star
      stars.push(
        <Star key={i} className="h-3.5 w-3.5 fill-brand-gold text-brand-gold" aria-hidden="true" />,
      );
    } else if (rating >= i - 0.5) {
      // Half star — render a full star with a clip mask
      stars.push(
        <span key={i} className="relative inline-flex h-3.5 w-3.5" aria-hidden="true">
          <Star className="absolute h-3.5 w-3.5 text-brand-gold/30" />
          <span className="absolute inset-0 overflow-hidden" style={{ width: '50%' }}>
            <Star className="h-3.5 w-3.5 fill-brand-gold text-brand-gold" />
          </span>
        </span>,
      );
    } else {
      // Empty star
      stars.push(<Star key={i} className="h-3.5 w-3.5 text-brand-gold/30" aria-hidden="true" />);
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

/** Rank-estimate bar — illustrative strength from price rank, not a model. */
function RankEstimateBar({ rank, totalBids }: { rank: number; totalBids: number }) {
  const { label, strength, color } = getRankEstimate(rank, totalBids);

  const barGradient = cn(
    strength >= 70 && 'bg-gradient-to-r from-bid-winning to-bid-winning',
    strength >= 30 && strength < 70 && 'bg-gradient-to-r from-trust-medium to-trust-medium',
    strength < 30 && 'bg-gradient-to-r from-destructive to-destructive',
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/*
          A real button rather than a div with role="img" and tabIndex={0}.
          The element exists specifically to be focusable so keyboard users can
          open the tooltip, which makes it interactive by definition — putting
          tabIndex on a non-interactive role is what jsx-a11y flags, and the
          previous eslint-disable sat on the wrong line so it suppressed
          nothing. A button carries the right role and focus behaviour for
          free; aria-label supplies the accessible name.
        */}
        <button
          type="button"
          className="cursor-default space-y-1 text-left"
          aria-label={`Rank estimate: ${label}, illustrative strength ${String(strength)} of 100`}
        >
          <div className="flex items-center justify-between">
            <span className={cn('text-xs font-bold', color)}>{label}</span>
            <span className={cn('text-[10px] font-semibold tabular-nums', color)}>
              #{String(rank)}
            </span>
          </div>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={cn('h-full rounded-full transition-all duration-500', barGradient)}
              style={{ width: `${String(strength)}%` }}
              role="progressbar"
              aria-valuenow={strength}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-hidden="true"
            />
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-semibold">Rank estimate</p>
        <p className="mt-0.5 text-zinc-400">
          Illustrative strength from current price rank vs. other bids — not a
          predictive model or win probability.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

export const BidCard = memo(function BidCard({
  bidWithProvider,
  jobId,
  canAward,
  rank,
  totalBids,
  startingPriceCents,
  marketMedianCents,
}: BidCardProps) {
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

  // Competitive context calculations
  const hasRank = rank !== undefined && rank > 0;
  const displayTotalBids = totalBids ?? 0;

  const priceDiffVsStarting =
    startingPriceCents && startingPriceCents > 0
      ? Math.round(((startingPriceCents - bid.amount_cents) / startingPriceCents) * 100)
      : null;

  const priceDiffVsMedian =
    marketMedianCents && marketMedianCents > 0
      ? Math.round(((marketMedianCents - bid.amount_cents) / marketMedianCents) * 100)
      : null;

  const isGoldRank = hasRank && rank === 1;

  // Time advantage
  const bidAge = formatRelativeTime(new Date(bid.created_at));

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

  const baseCardClass = cn(
    'relative',
    isGoldRank && !isAwarded && 'border-brand-gold/50',
  );

  const Wrapper = isAwarded
    ? ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <GoldAccentCard variant="winning" className={className}>
          {children}
        </GoldAccentCard>
      )
    : ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <Card
          className={cn(
            'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg',
            className,
          )}
        >
          {children}
        </Card>
      );

  return (
    <Wrapper className={baseCardClass}>
      {/* Gold shimmer overlay for #1 bid */}
      {isGoldRank && !isAwarded ? (
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
          aria-hidden="true"
        >
          <div className="animate-gold-shimmer absolute inset-0" />
        </div>
      ) : null}

      <CardContent className="relative space-y-4 pt-6">
        {/* ── 0. Rank badge (top-right corner) ── */}
        {hasRank ? (
          <div className="absolute top-3 right-4">
            <RankBadge rank={rank} totalBids={displayTotalBids} />
          </div>
        ) : null}

        {/* ── 1. Provider identity ── */}
        <div className="flex items-start gap-3">
          <Avatar
            className={cn(
              'h-11 w-11 flex-shrink-0',
              ringColor && `ring-offset-card ring-[3px] ring-offset-2 ${ringColor}`,
            )}
          >
            {provider_avatar_url ? (
              <AvatarImage src={provider_avatar_url} alt={provider_display_name} />
            ) : null}
            <AvatarFallback>{getInitials(provider_display_name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 pr-16">
            <p className="truncate leading-tight font-medium">{provider_display_name}</p>
            {provider_business_name ? (
              <p className="text-muted-foreground truncate text-sm">{provider_business_name}</p>
            ) : null}
          </div>
        </div>

        {/* ── 2. Bid amount (prominent) + competitive position ── */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <p
              className="text-2xl font-bold text-bid-winning"
              style={{ textShadow: '0 0 16px rgba(16,185,129,0.3), 0 0 32px rgba(16,185,129,0.1)' }}
            >
              {formatCents(bid.amount_cents)}
            </p>
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Clock className="h-3 w-3" aria-hidden="true" />
              <span>{bidAge}</span>
            </div>
          </div>

          {/* Competitive position badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Position indicator */}
            {hasRank ? <CompetitivePositionBadge rank={rank} totalBids={displayTotalBids} /> : null}

            {/* Price vs starting */}
            {priceDiffVsStarting !== null && priceDiffVsStarting > 0 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex cursor-default items-center gap-0.5 rounded-full bg-bid-winning/10 px-2 py-0.5 text-xs font-medium text-bid-winning"
                    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focusable for tooltip accessibility
                    tabIndex={0}
                  >
                    <TrendingDown className="h-3 w-3" aria-hidden="true" />
                    {String(priceDiffVsStarting)}% below asking
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {String(priceDiffVsStarting)}% lower than the customer&apos;s starting price
                  {startingPriceCents ? ` of ${formatCents(startingPriceCents)}` : ''}
                </TooltipContent>
              </Tooltip>
            ) : null}

            {/* Price vs market median */}
            {priceDiffVsMedian !== null && priceDiffVsMedian > 0 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex cursor-default items-center gap-0.5 rounded-full bg-bid-active/10 px-2 py-0.5 text-xs font-medium text-bid-active"
                    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focusable for tooltip accessibility
                    tabIndex={0}
                  >
                    {String(priceDiffVsMedian)}% below market
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {String(priceDiffVsMedian)}% lower than the market median
                  {marketMedianCents ? ` of ${formatCents(marketMedianCents)}` : ''} for this service type
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </div>

        {/* ── 2.5. Rank estimate (desktop only; illustrative, not a model) ── */}
        {hasRank && displayTotalBids > 1 ? (
          <div className="hidden sm:block">
            <RankEstimateBar rank={rank} totalBids={displayTotalBids} />
          </div>
        ) : null}

        {/* ── 3. Trust & credibility bar ── */}
        {(trust_score ?? review_summary) ? (
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
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
                    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-bid-winning">
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
                      {review_summary.on_time_rate !== null ? (
                        <>
                          <span aria-hidden="true" className="text-border">
                            |
                          </span>
                          <span>
                            {String(Math.round(review_summary.on_time_rate * 100))}% on-time
                          </span>
                        </>
                      ) : null}
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

            {isAwarded ? <WinBadge type="awarded" animate /> : null}
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
    </Wrapper>
  );
});

/** Rank badge displayed in the top-right corner with cinematic icons */
function RankBadge({ rank, totalBids }: { rank: number; totalBids: number }) {
  const style = RANK_STYLES[rank];

  if (style) {
    // Gold crown for #1, silver medal for #2, bronze medal for #3
    const RankIcon = rank === 1 ? Crown : Medal;
    const iconExtra =
      rank === 1 ? 'h-3.5 w-3.5 drop-shadow-[0_0_3px_rgba(245,158,11,0.6)]' : 'h-3 w-3';

    return (
      <div
        className={cn(
          'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold shadow-sm',
          style.bg,
          style.text,
          style.border,
          rank === 1 && 'shadow-brand-gold/20',
        )}
        aria-label={`Rank ${String(rank)} of ${String(totalBids)} bids`}
      >
        <RankIcon className={cn(iconExtra)} aria-hidden="true" />#{String(rank)} of{' '}
        {String(totalBids)}
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-xs font-medium text-zinc-400"
      aria-label={`Rank ${String(rank)} of ${String(totalBids)} bids`}
    >
      #{String(rank)} of {String(totalBids)}
    </div>
  );
}

/** Competitive position badge next to the bid amount */
function CompetitivePositionBadge({ rank, totalBids }: { rank: number; totalBids: number }) {
  const { label } = getCompetitivePosition(rank, totalBids);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        rank === 1
          ? 'bg-bid-winning/15 text-bid-winning shadow-[0_0_8px_hsl(var(--bid-winning)/0.25)]'
          : rank <= 3
            ? 'bg-trust-medium/10 text-trust-medium'
            : 'bg-destructive/10 text-destructive',
      )}
    >
      {rank === 1 ? (
        <span
          className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-bid-winning"
          aria-hidden="true"
        />
      ) : null}
      {label}
    </span>
  );
}
