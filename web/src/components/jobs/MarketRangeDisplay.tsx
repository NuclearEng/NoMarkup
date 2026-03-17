'use client';

import { BarChart3, TrendingDown, TrendingUp } from 'lucide-react';

import { formatCents } from '@/lib/utils';
import type { MarketRange } from '@/types';

interface MarketRangeDisplayProps {
  marketRange: MarketRange;
  currentBidCents?: number;
  compact?: boolean;
}

function getConfidence(sampleSize: number): {
  label: string;
  color: string;
  dotColor: string;
} {
  if (sampleSize < 5) {
    return { label: 'Limited data', color: 'text-amber-400', dotColor: 'bg-amber-400' };
  }
  if (sampleSize >= 20) {
    return { label: 'High confidence', color: 'text-green-400', dotColor: 'bg-green-400' };
  }
  return { label: 'Moderate confidence', color: 'text-zinc-400', dotColor: 'bg-zinc-400' };
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function MarketRangeDisplay({
  marketRange,
  currentBidCents,
  compact = false,
}: MarketRangeDisplayProps) {
  const { low_cents, median_cents, high_cents, sample_size } = marketRange;

  const range = high_cents - low_cents;
  const medianPosition = range > 0 ? clampPercent(((median_cents - low_cents) / range) * 100) : 50;

  const bidPosition =
    currentBidCents !== undefined && range > 0
      ? clampPercent(((currentBidCents - low_cents) / range) * 100)
      : null;

  const isBelowMedian = currentBidCents !== undefined && currentBidCents < median_cents;
  const isAboveMedian = currentBidCents !== undefined && currentBidCents > median_cents;

  const savingsPercent =
    currentBidCents !== undefined && median_cents > 0
      ? Math.round((Math.abs(currentBidCents - median_cents) / median_cents) * 100)
      : null;

  const confidence = getConfidence(sample_size);

  if (compact) {
    return (
      <div
        className="rounded-lg bg-zinc-900/95 p-3 text-white"
        role="figure"
        aria-label="Market rate range"
      >
        {/* Header */}
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
            <span className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
              Market Intel
            </span>
          </div>
          <span className={`text-[10px] font-medium ${confidence.color}`}>{confidence.label}</span>
        </div>

        {/* Range bar */}
        <div className="relative mb-2">
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: 'linear-gradient(to right, #22c55e, #fbbf24, #f87171)',
              }}
            />
            {/* Median marker */}
            <div
              className="absolute top-0 h-full w-px bg-white/70"
              style={{ left: `${String(medianPosition)}%` }}
            />
            {/* Current bid marker */}
            {bidPosition !== null ? (
              <div
                className="absolute -top-0.5 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-white shadow-lg"
                style={{
                  left: `${String(bidPosition)}%`,
                  backgroundColor: isBelowMedian ? '#22c55e' : '#f87171',
                }}
              />
            ) : null}
          </div>
        </div>

        {/* Price labels */}
        <div className="flex items-center justify-between text-[10px]">
          <span className="font-medium text-green-400">{formatCents(low_cents)}</span>
          <span className="text-zinc-500">{formatCents(median_cents)}</span>
          <span className="font-medium text-red-400">{formatCents(high_cents)}</span>
        </div>

        {/* Savings indicator */}
        {savingsPercent !== null && savingsPercent > 0 ? (
          <div className="mt-2 text-center">
            {isBelowMedian ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-400">
                <TrendingDown className="h-2.5 w-2.5" aria-hidden="true" />
                {String(savingsPercent)}% below market
              </span>
            ) : isAboveMedian ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400">
                <TrendingUp className="h-2.5 w-2.5" aria-hidden="true" />
                {String(savingsPercent)}% above market
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="rounded-xl bg-zinc-900/95 p-4 text-white sm:p-5"
      role="figure"
      aria-label="Market rate intelligence"
    >
      {/* Header row */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-zinc-400" aria-hidden="true" />
          <h4 className="text-xs font-bold tracking-widest text-zinc-300 uppercase">
            Market Intelligence
          </h4>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`h-1.5 w-1.5 rounded-full ${confidence.dotColor}`} aria-hidden="true" />
          <span className={`text-[11px] font-medium ${confidence.color}`}>{confidence.label}</span>
          <span className="text-[11px] text-zinc-600">
            {' \u00B7 '}
            {String(sample_size)} job{sample_size !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Range visualization */}
      <div className="relative">
        {/* Median label — positioned above the bar */}
        <div className="relative mb-1 h-4">
          <div
            className="absolute -translate-x-1/2 text-center"
            style={{ left: `${String(medianPosition)}%` }}
          >
            <span className="text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">
              Median
            </span>
          </div>
        </div>

        {/* Current bid label — positioned above bar if bid exists */}
        {bidPosition !== null && currentBidCents !== undefined ? (
          <div className="relative mb-1 h-4">
            <div
              className="absolute -translate-x-1/2 text-center"
              style={{ left: `${String(bidPosition)}%` }}
            >
              <span
                className={`text-[10px] font-bold ${isBelowMedian ? 'text-green-400' : isAboveMedian ? 'text-red-400' : 'text-white'}`}
              >
                {formatCents(currentBidCents)}
              </span>
            </div>
          </div>
        ) : null}

        {/* The range track */}
        <div className="relative h-2 w-full overflow-visible rounded-full bg-zinc-800">
          {/* Gradient fill */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: 'linear-gradient(to right, #22c55e, #fbbf24, #f87171)',
            }}
            aria-hidden="true"
          />

          {/* Median vertical line */}
          <div
            className="absolute -top-1 h-4 w-px bg-zinc-300/60"
            style={{ left: `${String(medianPosition)}%` }}
            aria-label={`Median price: ${formatCents(median_cents)}`}
          />

          {/* Current bid marker */}
          {bidPosition !== null ? (
            <div
              className="absolute -top-1.5 h-5 w-5 -translate-x-1/2"
              style={{ left: `${String(bidPosition)}%` }}
              aria-label={
                currentBidCents !== undefined
                  ? `Your bid: ${formatCents(currentBidCents)}`
                  : undefined
              }
            >
              {/* Pulsing glow for below-median bids */}
              {isBelowMedian ? (
                <span
                  className="absolute inset-0 animate-ping rounded-full bg-green-400/40"
                  aria-hidden="true"
                />
              ) : null}
              <span
                className="absolute inset-0 rounded-full border-2 border-white shadow-lg shadow-black/50"
                style={{
                  backgroundColor: isBelowMedian
                    ? '#22c55e'
                    : isAboveMedian
                      ? '#f87171'
                      : '#fbbf24',
                }}
              />
            </div>
          ) : null}
        </div>

        {/* Price labels row */}
        <div className="mt-2.5 flex items-center justify-between">
          <div className="text-left">
            <p className="text-[10px] font-medium tracking-wider text-zinc-600 uppercase">Low</p>
            <p className="text-sm font-bold text-green-400">{formatCents(low_cents)}</p>
          </div>
          <div className="text-center">
            <p className="text-sm font-bold text-zinc-300">{formatCents(median_cents)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-medium tracking-wider text-zinc-600 uppercase">High</p>
            <p className="text-sm font-bold text-red-400">{formatCents(high_cents)}</p>
          </div>
        </div>
      </div>

      {/* Savings / comparison callout */}
      {savingsPercent !== null && savingsPercent > 0 ? (
        <div className="mt-3 flex items-center justify-center">
          {isBelowMedian ? (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1">
              <TrendingDown className="h-3.5 w-3.5 text-green-400" aria-hidden="true" />
              <span className="text-xs font-bold text-green-400">
                {String(savingsPercent)}% below market
              </span>
            </div>
          ) : isAboveMedian ? (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1">
              <TrendingUp className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              <span className="text-xs font-bold text-amber-400">
                {String(savingsPercent)}% above market
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
