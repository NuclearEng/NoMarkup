'use client';

import { AlertTriangle, ArrowLeft, CheckCircle, MapPin, MessageSquare, User } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { OrderPaymentPrompt } from '@/components/orders/OrderPaymentPrompt';
import { OrderReviewForm } from '@/components/orders/OrderReviewForm';
import { StarRatingDisplay } from '@/components/reviews/StarRating';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  useConfirmPickup,
  useDisputeOrder,
  useListingOrder,
  useSellerConfirm,
} from '@/hooks/useListings';
import {
  useListingOrderReviewEligibility,
  useListingOrderReviews,
} from '@/hooks/useOrderReviews';
import { formatCents, formatRelativeTime } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
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
  const sellerConfirm = useSellerConfirm();
  const disputeOrder = useDisputeOrder();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const orderCompleted = order?.status === LISTING_ORDER_STATUS.COMPLETED;
  const {
    data: reviewEligibility,
    isLoading: reviewEligibilityLoading,
  } = useListingOrderReviewEligibility(orderId, orderCompleted);
  const { data: orderReviews = [] } = useListingOrderReviews(orderId, orderCompleted);

  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeDescription, setDisputeDescription] = useState('');

  if (isLoading) {
    return (
      <div
        className="mx-auto max-w-3xl space-y-4 px-4 py-8 sm:px-6 lg:px-8"
        role="status"
        aria-label="Loading order"
      >
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-64 rounded-xl" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
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

  // The seller confirms via /seller-confirm; the buyer via /confirm-pickup
  // (/confirm-pickup is buyer-only and 403s the seller). Escrow releases once
  // both sides have confirmed.
  const isSeller = currentUserId !== undefined && currentUserId === order.seller_id;
  // Each party confirms once. Track whether THIS caller has already confirmed
  // their half so we don't show an enabled button that 409s on re-click:
  //   - buyer half  → picked_up_at (set by /confirm-pickup)
  //   - seller half → seller_confirmed_at (set by /seller-confirm)
  const alreadyConfirmed = isSeller
    ? order.seller_confirmed_at !== null
    : order.picked_up_at !== null;
  // The order is still open for confirmation while escrow is held (paid) or
  // the buyer has confirmed but the seller has not (picked_up). Once released
  // (completed) or disputed, neither party can confirm.
  const handshakeOpen =
    order.status === LISTING_ORDER_STATUS.PAID || order.status === LISTING_ORDER_STATUS.PICKED_UP;
  const canConfirmPickup = handshakeOpen && !alreadyConfirmed;
  const canDispute =
    order.status === LISTING_ORDER_STATUS.PICKED_UP &&
    order.dispute_window_ends_at !== null &&
    new Date(order.dispute_window_ends_at).getTime() > Date.now();

  function handleConfirmPickup() {
    if (isSeller) {
      sellerConfirm.mutate(orderId);
    } else {
      confirmPickup.mutate(orderId);
    }
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
          {/* Unpaid order. `pending` is the web mapping of escrow_status
              'pending_payment' — the auction-win off-session charge failed
              (no card, decline, or SCA required), or the buyer dismissed the
              payment sheet after buy-now / offer-accept. Only the BUYER can
              settle it; the seller sees a read-only note instead, since the
              PaymentIntent belongs to the buyer's card. */}
          {order.status === LISTING_ORDER_STATUS.PENDING ? (
            isSeller ? (
              <Card variant="glass" className="border-amber-500/30">
                <CardContent className="p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-amber-200">Awaiting buyer payment</p>
                  <p className="mt-1">
                    The buyer hasn&apos;t completed payment, so nothing is in
                    escrow yet. Don&apos;t hand over the item until this order
                    shows as paid.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <OrderPaymentPrompt
                orderId={orderId}
                amountCents={order.amount_cents}
                platformFeeCents={order.platform_fee_cents}
                onPaid={() => {
                  void refetch();
                }}
              />
            )
          ) : null}

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
                disabled={!canConfirmPickup || confirmPickup.isPending || sellerConfirm.isPending}
                className="min-h-[48px] w-full bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <CheckCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                {order.status === LISTING_ORDER_STATUS.COMPLETED
                  ? 'Pickup confirmed'
                  : alreadyConfirmed
                    ? 'Waiting for the other party'
                    : isSeller
                      ? 'Confirm handoff'
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

          {/* FE-14: goods order review after escrow release */}
          {orderCompleted ? (
            <div className="space-y-4">
              {orderReviews.length > 0 ? (
                <Card variant="glass">
                  <CardHeader>
                    <CardTitle className="text-base">Reviews on this order</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {orderReviews.map((rev) => (
                      <div
                        key={rev.id}
                        className="space-y-1 border-b border-white/[0.06] pb-3 last:border-0 last:pb-0"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-zinc-200 capitalize">
                            {rev.reviewer_role === 'buyer' ? 'Buyer' : 'Seller'} review
                            {rev.reviewer_id === currentUserId ? ' (you)' : ''}
                          </p>
                          <StarRatingDisplay rating={rev.overall_rating} size="sm" showValue />
                        </div>
                        {rev.comment ? (
                          <p className="text-sm text-zinc-400 whitespace-pre-wrap">{rev.comment}</p>
                        ) : (
                          <p className="text-xs text-zinc-500">No written comment.</p>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              {reviewEligibilityLoading ? (
                <Skeleton className="h-48 rounded-xl" />
              ) : reviewEligibility?.eligible ? (
                <OrderReviewForm
                  orderId={orderId}
                  revieweeLabel={
                    isSeller ? 'the buyer' : (order.seller_display_name || 'the seller')
                  }
                  reviewWindowClosesAt={reviewEligibility.review_window_closes_at}
                />
              ) : reviewEligibility?.already_reviewed ? (
                <Card variant="glass">
                  <CardContent className="p-4 text-sm text-muted-foreground">
                    You already left a review for this order. Thank you.
                  </CardContent>
                </Card>
              ) : reviewEligibility && !reviewEligibility.eligible ? (
                <Card variant="glass">
                  <CardContent className="p-4 text-sm text-muted-foreground">
                    The review window for this order is closed or not open yet.
                  </CardContent>
                </Card>
              ) : null}
            </div>
          ) : null}
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
            {/* "Total paid" is only true once escrow is funded. On a
                pending_payment order the buyer has paid nothing, and calling
                it "paid" is exactly the false-success this feature removes. */}
            <Row
              label={
                order.status === LISTING_ORDER_STATUS.PENDING
                  ? 'Total due'
                  : 'Total paid'
              }
            >
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
              aria-describedby={
                disputeDescription.length > 0 &&
                disputeDescription.trim().length < DISPUTE_DESCRIPTION_MIN
                  ? 'dispute-description-error'
                  : undefined
              }
              aria-invalid={
                disputeDescription.length > 0 &&
                disputeDescription.trim().length < DISPUTE_DESCRIPTION_MIN
              }
            />
            {disputeDescription.length > 0 &&
            disputeDescription.trim().length < DISPUTE_DESCRIPTION_MIN ? (
              <p
                id="dispute-description-error"
                role="alert"
                className="text-xs text-amber-400"
              >
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
