'use client';

import { Zap } from 'lucide-react';

import { MarketRangeDisplay } from '@/components/jobs/MarketRangeDisplay';
import { Badge } from '@/components/ui/badge';
import { MonoPrice } from '@/components/ui/mono-price';
import { useFairPrice } from '@/hooks/useAnalytics';
import { ENABLE_LIVE_AUCTION } from '@/lib/constants';
import { type MarketRange } from '@/types';
import type { JobFormType } from '@/components/forms/job-posting/types';

function extractZipFromAddress(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const match = /\b(\d{5})(?:-\d{4})?\b/.exec(address);
  return match?.[1];
}

function fairPriceToMarketRange(fairPrice: {
  has_data: boolean;
  p25_cents?: number;
  price_cents?: number;
  p75_cents?: number;
  n_eff?: number;
} | undefined): MarketRange | null {
  if (!fairPrice?.has_data || !fairPrice.n_eff || fairPrice.n_eff <= 0) return null;
  if (
    fairPrice.p25_cents === undefined ||
    fairPrice.price_cents === undefined ||
    fairPrice.p75_cents === undefined
  ) {
    return null;
  }
  return {
    low_cents: fairPrice.p25_cents,
    median_cents: fairPrice.price_cents,
    high_cents: fairPrice.p75_cents,
    sample_size: fairPrice.n_eff,
  };
}

export function StepReview({
  form,
  photoCount,
  useInstantMatch,
  onInstantMatchChange,
  isHourly,
  hourlyRateDollars,
  sameDayRequested,
  questionAnswerCount,
}: {
  form: JobFormType;
  photoCount: number;
  useInstantMatch: boolean;
  onInstantMatchChange: (value: boolean) => void;
  isHourly: boolean;
  hourlyRateDollars: number | undefined;
  sameDayRequested: boolean;
  questionAnswerCount: number;
}) {
  const values = form.getValues();
  const categoryId = form.watch('categoryId');
  const locationAddress = form.watch('locationAddress');
  const zip = extractZipFromAddress(locationAddress);
  const { data: fairPrice } = useFairPrice({ categoryId, zip });
  const marketRange = fairPriceToMarketRange(fairPrice);

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-md border p-4">
        <div>
          <h3 className="text-muted-foreground text-sm font-medium">Title</h3>
          <p className="text-base font-semibold">{values.title}</p>
        </div>

        <div>
          <h3 className="text-muted-foreground text-sm font-medium">Description</h3>
          <p className="text-sm whitespace-pre-wrap">{values.description}</p>
        </div>

        {values.locationAddress ? (
          <div>
            <h3 className="text-muted-foreground text-sm font-medium">Location</h3>
            <p className="text-sm">{values.locationAddress}</p>
          </div>
        ) : null}

        <div>
          <h3 className="text-muted-foreground text-sm font-medium">Schedule</h3>
          <div className="flex gap-2">
            <Badge variant="outline">
              {values.scheduleType === 'specific_date'
                ? 'Specific Date'
                : values.scheduleType === 'date_range'
                  ? 'Date Range'
                  : 'Flexible'}
            </Badge>
            {values.scheduledDate ? (
              <Badge variant="secondary">
                {new Date(values.scheduledDate).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </Badge>
            ) : null}
            {values.isRecurring && values.recurrenceFrequency ? (
              <Badge variant="secondary">Recurring: {values.recurrenceFrequency}</Badge>
            ) : null}
            {sameDayRequested ? (
              <Badge variant="default" className="bg-amber-500/20 text-amber-600">
                Same-day
              </Badge>
            ) : null}
          </div>
        </div>

        {isHourly ? (
          <div>
            <h3 className="text-muted-foreground text-sm font-medium">Billing</h3>
            <p className="text-sm">
              Hourly
              {hourlyRateDollars !== undefined ? (
                <>
                  {' — '}
                  <MonoPrice
                    cents={Math.round(hourlyRateDollars * 100)}
                    className="text-sm font-semibold"
                  />
                  /hr
                </>
              ) : null}
            </p>
          </div>
        ) : null}

        {questionAnswerCount > 0 ? (
          <div>
            <h3 className="text-muted-foreground text-sm font-medium">Project details</h3>
            <p className="text-sm">{String(questionAnswerCount)} questions answered</p>
          </div>
        ) : null}

        <div>
          <h3 className="text-muted-foreground text-sm font-medium">Photos</h3>
          <p className="text-sm">
            {photoCount > 0
              ? `${String(photoCount)} photo${photoCount !== 1 ? 's' : ''} attached`
              : 'No photos attached'}
          </p>
        </div>

        <div>
          <h3 className="text-muted-foreground text-sm font-medium">Auction Settings</h3>
          <div className="mt-1 space-y-1 text-sm">
            {ENABLE_LIVE_AUCTION && values.auctionType ? (
              <p>Type: {values.auctionType === 'live' ? 'Live Auction' : 'Sealed Bid'}</p>
            ) : null}
            <p>
              Duration: {String(values.auctionDurationHours)} hours (
              {String(Math.floor(values.auctionDurationHours / 24))} days{' '}
              {String(values.auctionDurationHours % 24)}h)
            </p>
            {values.startingBidDollars ? (
              <p>
                Starting bid:{' '}
                <MonoPrice
                  cents={Math.round(values.startingBidDollars * 100)}
                  className="font-semibold"
                />
              </p>
            ) : (
              <p>Starting bid: Open</p>
            )}
            {values.offerAcceptedDollars ? (
              <p>
                Instant accept:{' '}
                <MonoPrice
                  cents={Math.round(values.offerAcceptedDollars * 100)}
                  className="font-semibold"
                />
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Instant Match toggle */}
      <div className="rounded-md border p-4">
        <p className="mb-3 text-sm font-medium" id="match-mode-label">
          How would you like to find a provider?
        </p>
        <div className="flex flex-col gap-2 sm:flex-row" role="radiogroup" aria-labelledby="match-mode-label">
          <label
            className={`flex flex-1 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
              !useInstantMatch ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30'
            }`}
          >
            <input
              type="radio"
              name="matchMode"
              value="auction"
              checked={!useInstantMatch}
              onChange={() => { onInstantMatchChange(false); }}
              className="mt-0.5 h-4 w-4"
              aria-label="Run an auction"
            />
            <div>
              <p className="text-sm font-medium text-zinc-200">Run an auction</p>
              <p className="mt-0.5 text-xs text-zinc-400">
                Providers compete on price. You choose the best bid.
              </p>
            </div>
          </label>
          <label
            className={`flex flex-1 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
              useInstantMatch ? 'border-amber-500 bg-amber-500/5' : 'border-border hover:bg-muted/30'
            }`}
          >
            <input
              type="radio"
              name="matchMode"
              value="instant"
              checked={useInstantMatch}
              onChange={() => { onInstantMatchChange(true); }}
              className="mt-0.5 h-4 w-4"
              aria-label="Find me someone fast"
            />
            <div>
              <p className="flex items-center gap-1.5 text-sm font-medium text-zinc-200">
                <Zap className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                Find me someone fast
              </p>
              <p className="mt-0.5 text-xs text-zinc-400">
                We&apos;ll match you with a top-rated provider immediately. No waiting for bids.
              </p>
              <p className="mt-1.5 text-xs text-amber-200/90">
                Honest pricing: Instant often lands around 1.5–2× a typical reverse-auction
                result for similar work — you pay for speed and someone who can start now.
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Live fair-price band — hidden when the cell has no data (FR-11.2). */}
      {marketRange && marketRange.sample_size > 0 ? (
        <MarketRangeDisplay marketRange={marketRange} />
      ) : null}
    </div>
  );
}
