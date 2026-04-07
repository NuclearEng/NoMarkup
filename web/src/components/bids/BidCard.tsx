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

/** Rank badge colors */
const RANK_STYLES: Record<number, { bg: string; text: string; border: string; label: string }> = {
  1: {
    bg: 'bg-amber-500/15',
    text: 'text-amber-600 dark:text-amber-400',
    border: 'border-amber-500/30',
    label: 'Lowest bid',
  },
  2: {
    bg: 'bg-slate-300/20 dark:bg-slate-400/15',
    text: 'text-slate-600 dark:text-slate-300',
    border: 'border-slate-400/30',
    label: '2nd lowest',
  },
  3: {
    bg: 'bg-orange-600/10',
    text: 'text-orange-700 dark:text-orange-400',
    border: 'border-orange-500/20',
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
  if (rank === 1) return { label: 'Lowest bid', color: 'text-emerald-600 dark:text-emerald-400' };
  if (rank === 2) return { label: '2nd lowest', color: 'text-amber-600 dark:text-amber-400' };
  // Above median
  const medianPosition = Math.ceil(totalBids / 2);
  if (rank > medianPosition) {
    return { label: 'Above median', color: 'text-red-500 dark:text-red-400' };
  }
  return {
    label: `${String(rank)}${getOrdinalSuffix(rank)} lowest`,
    color: 'text-amber-600 dark:text-amber-400',
  };
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0] || 'th';
}

function getWinProbability(
  rank: number,
  totalBids: number,
): {
  label: string;
  percent: number;
  color: string;
} {
  if (totalBids === 0) return { label: 'N/A', percent: 0, color: 'text-muted-foreground' };
  if (rank === 1) return { label: 'High chance', percent: 85, color: 'text-emerald-500' };
  if (rank === 2) return { label: 'Competitive', percent: 55, color: 'text-amber-500' };
  if (rank <= Math.ceil(totalBids / 3))
    return { label: 'Competitive', percent: 35, color: 'text-amber-500' };
  return { label: 'Needs lower bid', percent: 15, color: 'text-red-500' };
}

/** Renders a small SVG circular gauge for the trust score with glow effect */
function TrustScoreGauge({ score, tier }: { score: number; tier: TrustTier }) {
  const scorePercent = Math.round(score * 100);
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * score;
  const strokeColor = TRUST_GAUGE_STROKE[tier];
  const textColor = TRUST_SCORE_TEXT[tier];

  // Glow color for the gauge arc
  const TRUST_GLOW_MAP: Record<TrustTier, string> = {
    [TRUST_TIER.TOP_RATED]: 'rgba(245,158,11,0.4)',
    [TRUST_TIER.TRUSTED]: 'rgba(139,92,246,0.4)',
    [TRUST_TIER.RISING]: 'rgba(16,185,129,0.4)',
    [TRUST_TIER.NEW]: 'rgba(56,189,248,0.3)',
    [TRUST_TIER.UNDER_REVIEW]: 'rgba(156,163,175,0.2)',
  };
  const glowColor = TRUST_GLOW_MAP[tier];

  return (
    <div
      className="relative flex-shrink-0"
      aria-label={`Trust score: ${String(scorePercent)} out of 100`}
      role="img"
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

/** Win probability bar indicator with gradient fill */
function WinProbabilityBar({ rank, totalBids }: { rank: number; totalBids: number }) {
  const { label, percent, color } = getWinProbability(rank, totalBids);

  const barGradient = cn(
    percent >= 70 && 'bg-gradient-to-r from-emerald-600 to-emerald-400',
    percent >= 30 && percent < 70 && 'bg-gradient-to-r from-amber-600 to-amber-400',
    percent < 30 && 'bg-gradient-to-r from-red-600 to-red-400',
  );

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className={cn('text-xs font-bold', color)}>{label}</span>
        <span className={cn('text-[10px] font-semibold tabular-nums', color)}>
          {String(percent)}%
        </span>
      </div>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={cn('h-full rounded-full transition-all duration-500', barGradient)}
          style={{ width: `${String(percent)}%` }}
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Win probability: ${label}`}
        />
      </div>
    </div>
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
  const isFirstBid = hasRank && displayTotalBids > 0 && bid.created_at !== undefined;

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
    isGoldRank && !isAwarded && 'border-amber-400/50 dark:border-amber-500/40',
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
              className="text-2xl font-bold text-emerald-400"
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
              <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <TrendingDown className="h-3 w-3" aria-hidden="true" />
                {String(priceDiffVsStarting)}% below asking
              </span>
            ) : null}

            {/* Price vs market median */}
            {priceDiffVsMedian !== null && priceDiffVsMedian > 0 ? (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400">
                {String(priceDiffVsMedian)}% below market
              </span>
            ) : null}
          </div>
        </div>

        {/* ── 2.5. Win probability (desktop only, hidden on mobile) ── */}
        {hasRank && displayTotalBids > 1 ? (
          <div className="hidden sm:block">
            <WinProbabilityBar rank={rank} totalBids={displayTotalBids} />
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
          rank === 1 && 'shadow-amber-500/20',
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
          ? 'bg-emerald-500/15 text-emerald-600 shadow-[0_0_8px_rgba(16,185,129,0.25)] dark:text-emerald-400 dark:shadow-[0_0_8px_rgba(52,211,153,0.2)]'
          : rank <= 3
            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
            : 'bg-red-500/10 text-red-500',
      )}
    >
      {rank === 1 ? (
        <span
          className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"
          aria-hidden="true"
        />
      ) : null}
      {label}
    </span>
  );
}
