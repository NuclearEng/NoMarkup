'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowDown,
  ChevronDown,
  ChevronUp,
  DollarSign,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useUpdateBid, useWithdrawBid } from '@/hooks/useBids';
import { formatCents, formatRelativeTime } from '@/lib/utils';
import { bidSchema, type BidFormValues } from '@/lib/validations';
import type { Bid } from '@/types';
import { BID_STATUS } from '@/types';

interface ProviderBidCardProps {
  bid: Bid;
  jobTitle?: string;
}

function getStatusVariant(
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case BID_STATUS.AWARDED:
      return 'default';
    case BID_STATUS.ACTIVE:
      return 'secondary';
    case BID_STATUS.NOT_SELECTED:
    case BID_STATUS.EXPIRED:
      return 'destructive';
    case BID_STATUS.WITHDRAWN:
      return 'outline';
    default:
      return 'outline';
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case BID_STATUS.AWARDED:
      return 'Won';
    case BID_STATUS.ACTIVE:
      return 'Active';
    case BID_STATUS.NOT_SELECTED:
      return 'Not Selected';
    case BID_STATUS.WITHDRAWN:
      return 'Withdrawn';
    case BID_STATUS.EXPIRED:
      return 'Expired';
    default:
      return status.replace(/_/g, ' ');
  }
}

export function ProviderBidCard({ bid, jobTitle }: ProviderBidCardProps) {
  const [showLowerForm, setShowLowerForm] = useState(false);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const updateBid = useUpdateBid();
  const withdrawBid = useWithdrawBid();

  const form = useForm<BidFormValues>({
    resolver: zodResolver(bidSchema),
    defaultValues: {
      amountDollars: undefined,
    },
  });

  function handleLowerBid(values: BidFormValues) {
    const cents = Math.round(values.amountDollars * 100);
    if (cents >= bid.amount_cents) {
      form.setError('amountDollars', {
        message: `New bid must be less than your current bid of ${formatCents(bid.amount_cents)}`,
      });
      return;
    }
    updateBid.mutate(
      { bidId: bid.id, input: { new_amount_cents: cents } },
      {
        onSuccess: () => {
          setShowLowerForm(false);
          form.reset();
        },
      },
    );
  }

  function handleWithdraw() {
    withdrawBid.mutate(bid.id, {
      onSuccess: () => {
        setShowWithdrawConfirm(false);
      },
    });
  }

  const isActive = bid.status === BID_STATUS.ACTIVE;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {jobTitle ? (
              <Link
                href={`/jobs/${bid.job_id}` as Route}
                className="group flex items-center gap-1.5"
              >
                <h3 className="truncate text-base font-semibold group-hover:underline">
                  {jobTitle}
                </h3>
                <ExternalLink
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            ) : (
              <Link
                href={`/jobs/${bid.job_id}` as Route}
                className="text-sm text-muted-foreground hover:underline"
              >
                View Job
              </Link>
            )}
          </div>
          <Badge variant={getStatusVariant(bid.status)} className="shrink-0">
            {getStatusLabel(bid.status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current bid amount */}
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Your Bid</p>
            <p className="text-2xl font-bold">{formatCents(bid.amount_cents)}</p>
          </div>
          {bid.original_amount_cents !== bid.amount_cents ? (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Original</p>
              <p className="text-sm text-muted-foreground line-through">
                {formatCents(bid.original_amount_cents)}
              </p>
            </div>
          ) : null}
        </div>

        {/* Offer accepted badge */}
        {bid.is_offer_accepted ? (
          <Badge variant="default" className="gap-1">
            Offer Accepted
          </Badge>
        ) : null}

        {/* Bid history */}
        {bid.bid_history.length > 0 ? (
          <div>
            <button
              type="button"
              className="flex min-h-[44px] w-full items-center justify-between text-sm text-muted-foreground hover:text-foreground"
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
                  <div key={update.updated_at} className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{formatCents(update.amount_cents)}</span>
                    <span className="text-muted-foreground">
                      {formatRelativeTime(new Date(update.updated_at))}
                    </span>
                    {index === bid.bid_history.length - 1 ? (
                      <span className="text-xs text-muted-foreground">(original)</span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Timestamps */}
        <div className="text-xs text-muted-foreground">
          Placed {formatRelativeTime(new Date(bid.created_at))}
          {bid.awarded_at
            ? ` \u2022 Awarded ${formatRelativeTime(new Date(bid.awarded_at))}`
            : ''}
          {bid.withdrawn_at
            ? ` \u2022 Withdrawn ${formatRelativeTime(new Date(bid.withdrawn_at))}`
            : ''}
        </div>

        {/* Actions for active bids */}
        {isActive ? (
          <div className="space-y-3 border-t pt-3">
            {showLowerForm ? (
              <Form {...form}>
                <form onSubmit={(e) => { void form.handleSubmit(handleLowerBid)(e); }} className="space-y-3">
                  <FormField
                    control={form.control}
                    name="amountDollars"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New Amount (lower)</FormLabel>
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
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex gap-3">
                    <Button
                      type="submit"
                      className="min-h-[44px] flex-1"
                      disabled={updateBid.isPending}
                    >
                      {updateBid.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : null}
                      Lower Bid
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-[44px]"
                      onClick={() => {
                        setShowLowerForm(false);
                        form.reset();
                      }}
                      disabled={updateBid.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                  {updateBid.isError ? (
                    <p className="text-sm text-destructive">
                      Failed to update bid. Please try again.
                    </p>
                  ) : null}
                </form>
              </Form>
            ) : showWithdrawConfirm ? (
              <div className="space-y-3 rounded-lg border p-3">
                <p className="text-sm">
                  Are you sure you want to withdraw this bid? This action cannot be undone.
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="destructive"
                    className="min-h-[44px] flex-1"
                    onClick={handleWithdraw}
                    disabled={withdrawBid.isPending}
                  >
                    {withdrawBid.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    Confirm Withdraw
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-[44px]"
                    onClick={() => { setShowWithdrawConfirm(false); }}
                    disabled={withdrawBid.isPending}
                  >
                    Cancel
                  </Button>
                </div>
                {withdrawBid.isError ? (
                  <p className="text-sm text-destructive">
                    Failed to withdraw bid. Please try again.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="min-h-[44px] flex-1"
                  onClick={() => { setShowLowerForm(true); }}
                >
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  Lower Bid
                </Button>
                <Button
                  variant="outline"
                  className="min-h-[44px]"
                  onClick={() => { setShowWithdrawConfirm(true); }}
                >
                  Withdraw
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
