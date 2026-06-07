'use client';

import { AlertTriangle, ArrowLeft, CheckCircle, MapPin, MessageSquare, User } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useConfirmPickup, useDisputeOrder, useListingOrder } from '@/hooks/useListings';
import { formatCents, formatRelativeTime } from '@/lib/utils';
import { LISTING_ORDER_STATUS } from '@/types';

// Must match the backend allow-list in
// gateway/internal/handler/listing_orders.go (FileListingDispute).
const DISPUTE_REASONS = [
  { value: 'item_not_as_described', label: 'Item not as described' },
  { value: 'item_damaged', label: 'Item arrived damaged' },
  { value: 'no_show', label: 'Seller no-show' },
  { value: 'item_not_received', label: 'Item not received' },
  { value: 'other', label: 'Other' },
] as const;

const DISPUTE_DESCRIPTION_MIN = 20;

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;

  const { data: order, isLoading, isError, refetch } = useListingOrder(orderId);
  const confirmPickup = useConfirmPickup();
  const disputeOrder = useDisputeOrder();

  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeDescription, setDisputeDescription] = useState('');

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-4">
          <div className="h-6 w-48 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-64 animate-pulse rounded-xl bg-white/[0.06]" />
        </div>
      </div>
    );
  }

  if (isError || !order) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState
          title="Order not found"
          description="This order could not be loaded."
          action={
            <Button
              variant="default"
              className="min-h-[44px]"
              onClick={() => {
                void refetch();
              }}
            >
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  const canConfirmPickup =
    order.status === LISTING_ORDER_STATUS.PAID || order.status === LISTING_ORDER_STATUS.PICKED_UP;
  const canDispute =
    order.status === LISTING_ORDER_STATUS.PICKED_UP &&
    order.dispute_window_ends_at !== null &&
    new Date(order.dispute_window_ends_at).getTime() > Date.now();

  function handleConfirmPickup() {
    confirmPickup.mutate(orderId);
  }

  const disputeValid =
    disputeReason !== '' && disputeDescription.trim().length >= DISPUTE_DESCRIPTION_MIN;

  function handleDispute() {
    if (!disputeValid) return;
    disputeOrder.mutate({
      orderId,
      reason: disputeReason,
      description: disputeDescription.trim(),
    });
    setDisputeOpen(false);
    setDisputeReason('');
    setDisputeDescription('');
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href={'/marketplace' as Route}
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Marketplace
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">{order.listing_title}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Order placed {formatRelativeTime(new Date(order.created_at))}
          </p>
        </div>
        <Badge
          variant={
            order.status === LISTING_ORDER_STATUS.COMPLETED
              ? 'completed'
              : order.status === LISTING_ORDER_STATUS.DISPUTED
                ? 'disputed'
                : 'active'
          }
          className="capitalize"
        >
          {order.status.replace(/_/g, ' ')}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Pickup */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-4 w-4 text-[var(--brand-gold)]" aria-hidden="true" />
                Pickup
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="font-medium text-zinc-100">{order.pickup_address}</p>
              <p className="text-zinc-400">
                {order.pickup_city}, {order.pickup_state} {order.pickup_zip}
              </p>
            </CardContent>
          </Card>

          {/* Seller */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4 text-[var(--brand-gold)]" aria-hidden="true" />
                Seller
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="font-medium text-zinc-100">{order.seller_display_name}</p>
              <p className="text-zinc-400">
                Use chat to coordinate pickup — phone numbers stay private.
              </p>
              {order.channel_id ? (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="min-h-[40px] border-white/10"
                >
                  <Link href={`/messages?channel=${order.channel_id}` as Route}>
                    <MessageSquare className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Open chat
                  </Link>
                </Button>
              ) : (
                <p className="text-xs text-zinc-500">Chat opens once pickup is confirmed.</p>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                type="button"
                onClick={handleConfirmPickup}
                disabled={!canConfirmPickup || confirmPickup.isPending}
                className="min-h-[48px] w-full bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <CheckCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                {order.status === LISTING_ORDER_STATUS.COMPLETED
                  ? 'Pickup confirmed'
                  : 'Confirm pickup (releases escrow)'}
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={!canDispute || disputeOrder.isPending}
                onClick={() => {
                  setDisputeOpen(true);
                }}
                className="min-h-[44px] w-full border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
              >
                <AlertTriangle className="mr-2 h-4 w-4" aria-hidden="true" />
                Open dispute
              </Button>

              {!canDispute && order.dispute_window_ends_at ? (
                <p className="text-xs text-zinc-500">
                  Dispute window closes{' '}
                  {formatRelativeTime(new Date(order.dispute_window_ends_at))}.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* Summary */}
        <Card variant="glass" className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Item">
              <span className="text-zinc-200">{order.listing_title}</span>
            </Row>
            <Row label="Winning bid">
              <span className="font-semibold text-zinc-100 tabular-nums">
                {formatCents(order.amount_cents)}
              </span>
            </Row>
            <Row label="Platform fee">
              <span className="text-zinc-400 tabular-nums">
                {formatCents(order.platform_fee_cents)}
              </span>
            </Row>
            <div className="my-2 border-t border-white/[0.06]" />
            <Row label="Total paid">
              <span className="font-bold text-[var(--brand-gold)] tabular-nums">
                {formatCents(order.amount_cents + order.platform_fee_cents)}
              </span>
            </Row>
          </CardContent>
        </Card>
      </div>

      {/* Dispute dialog */}
      <Dialog open={disputeOpen} onOpenChange={setDisputeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open a dispute</DialogTitle>
            <DialogDescription>
              Describe what went wrong. Our support team reviews disputes within 24 hours.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={disputeReason} onValueChange={setDisputeReason}>
              <SelectTrigger aria-label="Dispute reason" className="min-h-[44px]">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {DISPUTE_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              value={disputeDescription}
              onChange={(e) => {
                setDisputeDescription(e.target.value);
              }}
              placeholder="Describe what went wrong in detail (at least 20 characters)."
              rows={5}
              maxLength={2000}
              aria-label="Dispute description"
            />
            {disputeDescription.length > 0 &&
            disputeDescription.trim().length < DISPUTE_DESCRIPTION_MIN ? (
              <p className="text-xs text-amber-400">
                Please add at least {DISPUTE_DESCRIPTION_MIN} characters so our team can review.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDisputeOpen(false);
              }}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDispute}
              disabled={!disputeValid || disputeOrder.isPending}
              className="min-h-[44px]"
            >
              Submit dispute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-zinc-400">{label}</span>
      {children}
    </div>
  );
}
