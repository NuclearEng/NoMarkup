'use client';

import { CircleAlert, CircleCheck, CircleHelp, Info } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn, formatCents } from '@/lib/utils';
import { CONFIDENCE_LABEL, FAIR_PRICE_LEVEL, type ConfidenceLabel, type FairPrice } from '@/types';

/* ------------------------------------------------------------------ */
/*  Confidence presentation — color AND label AND icon (never color   */
/*  alone, WCAG 1.4.1).                                                */
/* ------------------------------------------------------------------ */

type ConfidenceIcon = typeof CircleCheck;

interface ConfidenceMeta {
  label: string;
  /** Text color, light + dark, semantic scale (no raw hex). */
  text: string;
  /** Chip background + ring, light + dark. */
  chip: string;
  Icon: ConfidenceIcon;
}

function getConfidenceMeta(label: ConfidenceLabel): ConfidenceMeta {
  switch (label) {
    case CONFIDENCE_LABEL.HIGH:
      return {
        label: 'High confidence',
        text: 'text-emerald-700 dark:text-emerald-300',
        chip: 'bg-emerald-500/10 ring-emerald-600/20 dark:ring-emerald-400/25',
        Icon: CircleCheck,
      };
    case CONFIDENCE_LABEL.MEDIUM:
      return {
        label: 'Moderate confidence',
        text: 'text-amber-700 dark:text-amber-300',
        chip: 'bg-amber-500/10 ring-amber-600/20 dark:ring-amber-400/25',
        Icon: CircleHelp,
      };
    case CONFIDENCE_LABEL.LOW:
    default:
      return {
        label: 'Low confidence',
        text: 'text-muted-foreground',
        chip: 'bg-muted ring-border',
        Icon: CircleAlert,
      };
  }
}

// Human label for the geo fallback ladder. level_used > 0 means the band was
// borrowed from a wider area than the requested zip — we say so plainly.
function getLevelNote(levelUsed: number): string | null {
  switch (levelUsed) {
    case FAIR_PRICE_LEVEL.ZIP:
      return null;
    case FAIR_PRICE_LEVEL.METRO:
      return 'Based on metro-wide data';
    case FAIR_PRICE_LEVEL.METRO_PARENT:
      return 'Based on regional data';
    case FAIR_PRICE_LEVEL.NATIONAL:
    case FAIR_PRICE_LEVEL.NATIONAL_PARENT:
      return 'Based on nationwide data';
    case FAIR_PRICE_LEVEL.SIDE:
      return 'Based on related categories';
    default:
      return 'Based on broader data';
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/* ------------------------------------------------------------------ */
/*  Tooltip explainer (shared by both variants)                        */
/* ------------------------------------------------------------------ */

function BandInfoTooltip({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        aria-label="How the fair-price band is computed"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex h-11 w-11 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-semibold">{label}</p>
        <p className="mt-0.5 text-zinc-300">
          The going-rate range is computed from real settled prices nearby. It widens — and
          confidence drops — when local data is thin, and falls back to broader areas so you always
          get an estimate.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export interface FairPriceBandProps {
  fairPrice: FairPrice | undefined;
  isLoading?: boolean;
  isError?: boolean;
  /** Compact one-line hint, e.g. near a bid form in the auction arena. */
  compact?: boolean;
  /** Optional current bid/lowest price, plotted as a marker on the band. */
  currentBidCents?: number | null;
  className?: string;
  /** Heading override (full variant only). */
  title?: string;
}

/**
 * FairPriceBand — surfaces the Fair-Price engine output: a prominent point
 * estimate, the p25–p75 "going rate" dispersion band, a confidence chip
 * (color + label + icon), and an honest note when data is sparse (`has_data`
 * false) or borrowed from a wider geo (`level_used > 0`).
 *
 * Handles loading (Skeleton), error, and the empty (`has_data === false`)
 * states. Mobile-first, WCAG 2.2 AA: semantic tokens, 44px tooltip target,
 * never color-alone, aria labels on the visual band.
 */
export function FairPriceBand({
  fairPrice,
  isLoading = false,
  isError = false,
  compact = false,
  currentBidCents,
  className,
  title = 'Fair Price',
}: FairPriceBandProps) {
  if (isLoading) {
    return <FairPriceBandSkeleton compact={compact} className={className} />;
  }

  if (isError) {
    return (
      <div
        className={cn(
          'text-muted-foreground rounded-lg border border-dashed p-3 text-sm',
          className,
        )}
        role="status"
      >
        Fair-price data is unavailable right now.
      </div>
    );
  }

  // Empty state — a fresh (category × geo) cell with no settled prices yet.
  if (!fairPrice || !fairPrice.has_data) {
    return (
      <div
        className={cn(
          'text-muted-foreground rounded-lg border border-dashed p-3 text-sm',
          className,
        )}
        role="status"
      >
        Not enough local data yet to estimate a fair price. Check back as more jobs settle.
      </div>
    );
  }

  const {
    price_cents,
    p25_cents,
    p75_cents,
    confidence_label,
    confidence,
    n_eff,
    level_used,
  } = fairPrice;

  const conf = getConfidenceMeta(confidence_label);
  const levelNote = getLevelNote(level_used);
  const sparse = confidence_label === CONFIDENCE_LABEL.LOW || level_used > 0;

  // Position the point + current-bid markers within the p25–p75 band.
  const span = p75_cents - p25_cents;
  const pointPct = span > 0 ? clampPercent(((price_cents - p25_cents) / span) * 100) : 50;
  const bidPct =
    currentBidCents != null && span > 0
      ? clampPercent(((currentBidCents - p25_cents) / span) * 100)
      : null;

  const bandAriaLabel = `Going rate ${formatCents(p25_cents)} to ${formatCents(
    p75_cents,
  )}, fair-price estimate ${formatCents(price_cents)}`;

  /* ----- Compact variant: live "bids here usually settle $X–$Y" ----- */
  if (compact) {
    return (
      <div
        className={cn(
          'bg-muted/50 rounded-lg border p-3',
          className,
        )}
        role="group"
        aria-label="Fair-price hint"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs font-medium">
            Bids here usually settle
          </p>
          <ConfidenceChip meta={conf} confidence={confidence} />
        </div>

        <p className="text-foreground mt-1 text-lg font-bold tabular-nums">
          {formatCents(p25_cents)}
          <span className="text-muted-foreground mx-1 font-normal">–</span>
          {formatCents(p75_cents)}
        </p>

        <div className="mt-2">
          <BandTrack
            pointPct={pointPct}
            bidPct={bidPct}
            ariaLabel={bandAriaLabel}
          />
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-[11px]">
            Fair price{' '}
            <span className="text-foreground font-semibold tabular-nums">
              {formatCents(price_cents)}
            </span>
          </p>
          {sparse && levelNote ? (
            <span className="text-muted-foreground text-[11px]">{levelNote}</span>
          ) : null}
        </div>
      </div>
    );
  }

  /* ----- Full variant: Fair Price Index surface ----- */
  return (
    <div
      className={cn(
        'bg-card text-card-foreground rounded-xl border p-4 sm:p-5',
        className,
      )}
      role="group"
      aria-label="Fair-price estimate"
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <h4 className="text-muted-foreground text-xs font-bold tracking-widest uppercase">
            {title}
          </h4>
          <BandInfoTooltip label={conf.label} />
        </div>
        <ConfidenceChip meta={conf} confidence={confidence} />
      </div>

      {/* Point estimate — prominent */}
      <div>
        <p className="text-foreground text-3xl font-black tabular-nums tracking-tight sm:text-4xl">
          {formatCents(price_cents)}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">fair-price estimate</p>
      </div>

      {/* Going-rate band */}
      <div className="mt-4">
        <div className="text-muted-foreground mb-1.5 flex items-center justify-between text-[11px] font-medium tracking-wide uppercase">
          <span>Going rate</span>
          <span className="text-foreground tabular-nums normal-case">
            {formatCents(p25_cents)} – {formatCents(p75_cents)}
          </span>
        </div>
        <BandTrack pointPct={pointPct} bidPct={bidPct} ariaLabel={bandAriaLabel} large />
      </div>

      {/* Footnotes: sample size + honest sparse-data / geo note */}
      <div className="text-muted-foreground mt-3 space-y-1 text-xs">
        <p>
          Based on{' '}
          <span className="text-foreground font-semibold tabular-nums">{String(n_eff)}</span>{' '}
          effective settled price{n_eff === 1 ? '' : 's'} nearby.
        </p>
        {sparse && levelNote ? (
          <p className="flex items-center gap-1.5">
            <conf.Icon className={cn('h-3.5 w-3.5 shrink-0', conf.text)} aria-hidden="true" />
            <span>
              {levelNote} — treat as a rough estimate while local data is thin.
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function ConfidenceChip({
  meta,
  confidence,
}: {
  meta: ConfidenceMeta;
  confidence: number;
}) {
  const pct = Math.round(confidence * 100);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1',
        meta.chip,
        meta.text,
      )}
      // Color + icon + text together convey confidence (never color alone).
      aria-label={`${meta.label}, ${String(pct)} percent`}
    >
      <meta.Icon className="h-3 w-3" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function BandTrack({
  pointPct,
  bidPct,
  ariaLabel,
  large = false,
}: {
  pointPct: number;
  bidPct: number | null;
  ariaLabel: string;
  large?: boolean;
}) {
  return (
    <div
      className={cn(
        'bg-muted relative w-full overflow-visible rounded-full',
        large ? 'h-2' : 'h-1.5',
      )}
      role="img"
      aria-label={ariaLabel}
    >
      {/* The p25–p75 band fills the whole track; a gradient communicates the
          spread without relying on color alone for any single value. */}
      <div
        className="absolute inset-0 rounded-full bg-gradient-to-r from-emerald-500/40 via-amber-500/40 to-emerald-500/40"
        aria-hidden="true"
      />
      {/* Fair-price point estimate marker */}
      <div
        className="border-background bg-foreground absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
        style={{
          left: `${String(pointPct)}%`,
          width: large ? '14px' : '10px',
          height: large ? '14px' : '10px',
        }}
        aria-hidden="true"
      />
      {/* Current bid marker (optional) */}
      {bidPct !== null ? (
        <div
          className="border-background absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-amber-500 dark:bg-amber-400"
          style={{
            left: `${String(bidPct)}%`,
            width: large ? '12px' : '9px',
            height: large ? '12px' : '9px',
          }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}

function FairPriceBandSkeleton({
  compact,
  className,
}: {
  compact: boolean;
  className?: string;
}) {
  if (compact) {
    return (
      <div className={cn('bg-muted/50 rounded-lg border p-3', className)} aria-hidden="true">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-2 h-6 w-40" />
        <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
      </div>
    );
  }
  return (
    <div
      className={cn('bg-card rounded-xl border p-4 sm:p-5', className)}
      aria-hidden="true"
    >
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-9 w-36" />
      <Skeleton className="mt-4 h-2 w-full rounded-full" />
      <Skeleton className="mt-3 h-3 w-48" />
    </div>
  );
}
