'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle, DollarSign, Loader2, Zap } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { MarketRangeDisplay } from '@/components/jobs/MarketRangeDisplay';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useAcceptOffer, usePlaceBid, useUpdateBid } from '@/hooks/useBids';
import { formatCents } from '@/lib/utils';
import { bidSchema, type BidFormValues } from '@/lib/validations';
import type { Bid, MarketRange } from '@/types';

interface BidFormProps {
  jobId: string;
  existingBid: Bid | null;
  startingBidCents: number | null;
  offerAcceptedCents: number | null;
  marketRange: MarketRange | null;
  auctionEndsAt: string | null;
}

function isAuctionClosed(auctionEndsAt: string | null): boolean {
  if (!auctionEndsAt) return true;
  return new Date(auctionEndsAt).getTime() <= Date.now();
}

export function BidForm({
  jobId,
  existingBid,
  startingBidCents,
  offerAcceptedCents,
  marketRange,
  auctionEndsAt,
}: BidFormProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [showAcceptConfirm, setShowAcceptConfirm] = useState(false);

  const placeBid = usePlaceBid();
  const updateBid = useUpdateBid();
  const acceptOffer = useAcceptOffer();

  const auctionClosed = isAuctionClosed(auctionEndsAt);
  const isUpdate = existingBid !== null;

  const form = useForm<BidFormValues>({
    resolver: zodResolver(bidSchema),
    defaultValues: {
      amountDollars: existingBid ? existingBid.amount_cents / 100 : undefined,
    },
  });

  const watchedAmount = form.watch('amountDollars');
  const amountCents = watchedAmount ? Math.round(watchedAmount * 100) : 0;

  function validateBidAmount(amountDollars: number): string | null {
    const cents = Math.round(amountDollars * 100);
    if (startingBidCents && cents >= startingBidCents) {
      return `Bid must be less than the starting bid of ${formatCents(startingBidCents)}`;
    }
    if (existingBid !== null && cents >= existingBid.amount_cents) {
      return `You can only lower your bid. Current bid: ${formatCents(existingBid.amount_cents)}`;
    }
    return null;
  }

  function handleFormSubmit(values: BidFormValues) {
    const error = validateBidAmount(values.amountDollars);
    if (error) {
      form.setError('amountDollars', { message: error });
      return;
    }
    setShowConfirm(true);
  }

  function handleConfirmedSubmit() {
    const cents = Math.round(form.getValues('amountDollars') * 100);

    if (existingBid !== null) {
      updateBid.mutate(
        { bidId: existingBid.id, input: { new_amount_cents: cents } },
        {
          onSuccess: () => {
            setShowConfirm(false);
          },
        },
      );
    } else {
      placeBid.mutate(
        { jobId, input: { amount_cents: cents } },
        {
          onSuccess: () => {
            setShowConfirm(false);
          },
        },
      );
    }
  }

  function handleAcceptOffer() {
    setShowAcceptConfirm(true);
  }

  function handleConfirmedAcceptOffer() {
    acceptOffer.mutate(jobId, {
      onSuccess: () => {
        setShowAcceptConfirm(false);
      },
    });
  }

  const isPending = placeBid.isPending || updateBid.isPending;

  if (auctionClosed) {
    return (
      <div className="space-y-3 rounded-lg border bg-muted/50 p-4">
        <p className="text-sm font-medium text-muted-foreground">Auction Closed</p>
        <p className="text-sm text-muted-foreground">
          This auction has ended. Bidding is no longer available.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Existing bid display */}
      {existingBid ? (
        <div className="rounded-lg border bg-muted/50 p-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-600" aria-hidden="true" />
            <p className="text-sm font-medium">Your Current Bid</p>
          </div>
          <p className="mt-1 text-2xl font-bold">{formatCents(existingBid.amount_cents)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            You can only lower your bid, never raise it.
          </p>
        </div>
      ) : null}

      {/* Market range */}
      {marketRange && marketRange.sample_size > 0 ? (
        <MarketRangeDisplay marketRange={marketRange} />
      ) : null}

      {/* Bid form */}
      {showConfirm ? (
        <div className="space-y-4 rounded-lg border p-4">
          <h4 className="font-medium">Confirm Your Bid</h4>
          <p className="text-sm text-muted-foreground">
            You are about to {isUpdate ? 'lower your bid to' : 'place a bid of'}{' '}
            <span className="font-semibold text-foreground">{formatCents(amountCents)}</span>.
            {isUpdate ? ' This cannot be undone.' : ''}
          </p>
          <div className="flex gap-3">
            <Button
              className="min-h-[44px] flex-1"
              onClick={handleConfirmedSubmit}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              {isUpdate ? 'Confirm Lower Bid' : 'Confirm Bid'}
            </Button>
            <Button
              variant="outline"
              className="min-h-[44px]"
              onClick={() => { setShowConfirm(false); }}
              disabled={isPending}
            >
              Cancel
            </Button>
          </div>
          {placeBid.isError || updateBid.isError ? (
            <p className="text-sm text-destructive">
              Failed to submit bid. Please try again.
            </p>
          ) : null}
        </div>
      ) : (
        <Form {...form}>
          <form onSubmit={(e) => { void form.handleSubmit(handleFormSubmit)(e); }} className="space-y-4">
            <FormField
              control={form.control}
              name="amountDollars"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{isUpdate ? 'Lower Your Bid' : 'Your Bid Amount'}</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <DollarSign
                        className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="0.00"
                        className="min-h-[44px] pl-9"
                        {...field}
                        value={field.value || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          field.onChange(val === '' ? undefined : parseFloat(val));
                        }}
                      />
                    </div>
                  </FormControl>
                  <FormDescription>
                    Enter your bid in dollars.
                    {startingBidCents
                      ? ` Must be less than ${formatCents(startingBidCents)}.`
                      : ''}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="min-h-[44px] w-full" disabled={isPending}>
              {isUpdate ? 'Lower Bid' : 'Place Bid'}
            </Button>
          </form>
        </Form>
      )}

      {/* Accept Offer section */}
      {offerAcceptedCents && !existingBid ? (
        <div className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-green-600" aria-hidden="true" />
            <h4 className="text-sm font-medium text-green-800 dark:text-green-200">
              Instant Accept
            </h4>
          </div>
          <p className="text-sm text-green-700 dark:text-green-300">
            Accept this job at the customer&apos;s instant price of{' '}
            <span className="font-semibold">{formatCents(offerAcceptedCents)}</span>.
          </p>
          {showAcceptConfirm ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-green-800 dark:text-green-200">
                Are you sure? This will place a bid at{' '}
                {formatCents(offerAcceptedCents)}.
              </p>
              <div className="flex gap-3">
                <Button
                  className="min-h-[44px] flex-1"
                  onClick={handleConfirmedAcceptOffer}
                  disabled={acceptOffer.isPending}
                >
                  {acceptOffer.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  Confirm Accept Offer
                </Button>
                <Button
                  variant="outline"
                  className="min-h-[44px]"
                  onClick={() => { setShowAcceptConfirm(false); }}
                  disabled={acceptOffer.isPending}
                >
                  Cancel
                </Button>
              </div>
              {acceptOffer.isError ? (
                <p className="text-sm text-destructive">
                  Failed to accept offer. Please try again.
                </p>
              ) : null}
            </div>
          ) : (
            <Button
              variant="outline"
              className="min-h-[44px] w-full border-green-300 text-green-700 hover:bg-green-100 dark:border-green-800 dark:text-green-300 dark:hover:bg-green-900"
              onClick={handleAcceptOffer}
            >
              <Zap className="h-4 w-4" aria-hidden="true" />
              Accept Offer at {formatCents(offerAcceptedCents)}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
