'use client';

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { ENABLE_LIVE_AUCTION } from '@/lib/constants';
import { AUCTION_TYPE } from '@/types';
import type { JobFormType } from '@/components/forms/job-posting/types';

interface StepAuctionProps {
  form: JobFormType;
  isHourly: boolean;
  onIsHourlyChange: (value: boolean) => void;
  hourlyRateDollars: number | undefined;
  onHourlyRateChange: (value: number | undefined) => void;
}

export function StepAuction({
  form,
  isHourly,
  onIsHourlyChange,
  hourlyRateDollars,
  onHourlyRateChange,
}: StepAuctionProps) {
  const durationHours = form.watch('auctionDurationHours');

  return (
    <div className="space-y-6">
      {/* Wave 5 services-polish — flat-rate vs. hourly toggle. When
          hourly is selected, the budget inputs become a single hourly
          rate field; the auction still runs as usual. */}
      <div className="space-y-2 rounded-md border p-3">
        <p className="text-sm font-medium" id="billing-mode-label">
          Billing
        </p>
        <div className="flex gap-4" role="radiogroup" aria-labelledby="billing-mode-label">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="billingMode"
              value="flat"
              checked={!isHourly}
              onChange={() => {
                onIsHourlyChange(false);
              }}
              className="h-4 w-4"
            />
            <span className="text-sm">Flat rate</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="billingMode"
              value="hourly"
              checked={isHourly}
              onChange={() => {
                onIsHourlyChange(true);
              }}
              className="h-4 w-4"
            />
            <span className="text-sm">Hourly</span>
          </label>
        </div>
        {isHourly ? (
          <div className="pt-2">
            <label htmlFor="hourly-rate" className="text-sm font-medium">
              Target hourly rate (USD)
            </label>
            <div className="relative mt-1">
              <span className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2">
                $
              </span>
              <Input
                id="hourly-rate"
                type="number"
                inputMode="decimal"
                min={0}
                step={0.5}
                placeholder="65.00"
                value={hourlyRateDollars ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') {
                    onHourlyRateChange(undefined);
                    return;
                  }
                  const n = Number(v);
                  if (Number.isFinite(n)) onHourlyRateChange(n);
                }}
                className="min-h-[44px] pl-8 font-mono tabular-nums"
              />
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              Providers will quote against this rate. Actual hours are tracked on the contract.
            </p>
          </div>
        ) : null}
      </div>

      {ENABLE_LIVE_AUCTION ? (
        <div className="space-y-2">
          <p className="text-sm font-medium" id="auction-type-label">
            Auction Type
          </p>
          <div className="flex gap-4" role="radiogroup" aria-labelledby="auction-type-label">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                value={AUCTION_TYPE.SEALED}
                {...form.register('auctionType')}
                defaultChecked
                className="h-4 w-4"
              />
              <span className="text-sm">Sealed Bid</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                value={AUCTION_TYPE.LIVE}
                {...form.register('auctionType')}
                className="h-4 w-4"
              />
              <span className="text-sm">Live Auction</span>
            </label>
          </div>
          <p className="text-muted-foreground text-xs">
            Live auctions show real-time price drops. Sealed bids are hidden until you choose a
            winner.
          </p>
        </div>
      ) : null}

      <FormField
        control={form.control}
        name="startingBidDollars"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Starting Bid (optional)</FormLabel>
            <FormControl>
              <div className="relative">
                <span className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2">
                  $
                </span>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  value={field.value ?? ''}
                  onChange={(e) => {
                    const val = e.target.value ? Number(e.target.value) : undefined;
                    field.onChange(val);
                  }}
                  className="min-h-[44px] pl-8 font-mono tabular-nums"
                />
              </div>
            </FormControl>
            <FormDescription>
              Set a suggested starting price for bids. Leave blank to let providers set their own
              price.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="offerAcceptedDollars"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Instant Accept Price (optional)</FormLabel>
            <FormControl>
              <div className="relative">
                <span className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2">
                  $
                </span>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  value={field.value ?? ''}
                  onChange={(e) => {
                    const val = e.target.value ? Number(e.target.value) : undefined;
                    field.onChange(val);
                  }}
                  className="min-h-[44px] pl-8 font-mono tabular-nums"
                />
              </div>
            </FormControl>
            <FormDescription>
              If a provider bids at or below this price, their bid is automatically accepted.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="auctionDurationHours"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              Auction Duration: {String(durationHours)} hour{durationHours !== 1 ? 's' : ''} (
              {String(Math.floor(durationHours / 24))} day
              {Math.floor(durationHours / 24) !== 1 ? 's' : ''} {String(durationHours % 24)}h)
            </FormLabel>
            <FormControl>
              <Slider
                min={24}
                max={168}
                step={1}
                value={[field.value]}
                onValueChange={(values) => {
                  const val = values[0];
                  if (val !== undefined) {
                    field.onChange(val);
                  }
                }}
                className="min-h-[44px]"
                aria-label={`Auction duration: ${String(durationHours)} hours`}
              />
            </FormControl>
            <div className="text-muted-foreground flex justify-between text-xs">
              <span>24h (1 day)</span>
              <span>168h (7 days)</span>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
