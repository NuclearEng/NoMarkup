'use client';

import { Loader2, ShoppingBag } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { PaymentConfirmationDialog } from '@/components/payments/PaymentConfirmationDialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useBuyNow } from '@/hooks/useBuyNow';
import { GOODS_BID_AUTHORIZATION_DISCLOSURE } from '@/lib/constants';
import { hasConfirmablePayment } from '@/lib/payment-outcome';
import { cn, formatCents } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { LISTING_STATUS, type Listing } from '@/types';

interface BuyItNowButtonProps {
  listing: Pick<
    Listing,
    'id' | 'seller_id' | 'status' | 'buy_now_price_cents' | 'auction_ends_at'
  >;
  className?: string;
}

/**
 * BuyItNowButton — pinned closeout button rendered above the bid panel
 * on the listing detail page. Renders nothing when the listing has no
 * `buy_now_price_cents` set. Confirms the purchase via a modal so a
 * fat-finger tap can't trigger an instant buy.
 *
 * Auth handling: when the user is signed-out, the button is still
 * visible (so guests see the price as a CTA) but tapping routes to the
 * login page with a next parameter. The actual mutation only fires
 * after a confirmed click on the modal "Buy now" button.
 *
 * PAYMENT: buy-now creates the order in `pending_payment` and returns a
 * PaymentIntent client secret. This component used to route straight to the
 * order page and show "Purchased", leaving escrow unfunded. It now opens the
 * payment sheet and only navigates once the PaymentIntent actually succeeds.
 * If the gateway could not mint a PaymentIntent at all (`charge_error`), the
 * buyer is sent to the order page, which carries the pay-now surface.
 */
export function BuyItNowButton({ listing, className }: BuyItNowButtonProps) {
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const buyNow = useBuyNow(listing.id);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [payment, setPayment] = useState<{
    orderId: string;
    clientSecret: string;
    totalCents: number | undefined;
  } | null>(null);

  if (
    !listing.buy_now_price_cents ||
    listing.status !== LISTING_STATUS.ACTIVE
  ) {
    return null;
  }

  const isOwn = user?.id === listing.seller_id;
  if (isOwn) return null;

  const buyNowDisplay = formatCents(listing.buy_now_price_cents);

  const handleClick = () => {
    if (!isAuthenticated) {
      router.push(
        `/login?next=${encodeURIComponent(`/marketplace/${listing.id}`)}` as Route,
      );
      return;
    }
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    buyNow.mutate(undefined, {
      onSuccess: (data) => {
        setConfirmOpen(false);
        if (hasConfirmablePayment(data) && data.order_id) {
          setPayment({
            orderId: data.order_id,
            clientSecret: data.client_secret,
            totalCents: data.total_cents,
          });
          return;
        }
        // No usable secret (payment service down, dev stack, or the gateway
        // returned charge_error). The order exists and is unpaid — send the
        // buyer to it so they can settle from the pay-now surface there
        // rather than silently believing they bought the item.
        if (data.order_id) {
          router.push(`/orders/${data.order_id}` as Route);
        }
      },
    });
  };

  return (
    <>
      <div
        className={cn(
          'rounded-xl border border-bid-winning/30 bg-bid-winning/[0.06] p-4',
          'shadow-[0_0_24px_-12px_rgba(16,185,129,0.5)]',
          className,
        )}
      >
        <div className="flex items-start gap-3">
          <ShoppingBag
            className="mt-0.5 h-5 w-5 shrink-0 text-bid-winning"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold tracking-wide text-bid-winning/80 uppercase">
              Buy it now
            </p>
            <p className="mt-1 text-sm text-zinc-300">
              Skip the auction and own it for{' '}
              <span className="font-semibold text-bid-winning tabular-nums">
                {buyNowDisplay}
              </span>
              .
            </p>
            <p
              className="mt-2 text-xs leading-snug text-zinc-500"
              data-testid="bid-auth-disclosure"
            >
              {GOODS_BID_AUTHORIZATION_DISCLOSURE}
            </p>
          </div>
        </div>
        <Button
          type="button"
          onClick={handleClick}
          disabled={buyNow.isPending}
          className="mt-3 min-h-[44px] w-full bg-bid-winning text-background hover:bg-bid-winning/90"
          aria-label={`Buy now for ${buyNowDisplay}`}
        >
          {buyNow.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Processing…
            </>
          ) : (
            <>Buy now {buyNowDisplay}</>
          )}
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm purchase</DialogTitle>
            <DialogDescription>
              You will pay <strong>{buyNowDisplay}</strong> and the auction will
              close immediately. Funds are held in escrow until you confirm
              pickup of the item.{' '}
              {GOODS_BID_AUTHORIZATION_DISCLOSURE}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirmOpen(false);
              }}
              disabled={buyNow.isPending}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={buyNow.isPending}
              className="min-h-[44px] bg-bid-winning text-background hover:bg-bid-winning/90"
            >
              {buyNow.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Buying…
                </>
              ) : (
                <>Buy now {buyNowDisplay}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {payment ? (
        <PaymentConfirmationDialog
          open
          onOpenChange={(next) => {
            if (!next) {
              // Closing without paying leaves a real unpaid order behind.
              // Route to it so the obligation is visible instead of vanishing.
              const { orderId } = payment;
              setPayment(null);
              router.push(`/orders/${orderId}` as Route);
            }
          }}
          clientSecret={payment.clientSecret}
          amountCents={payment.totalCents}
          itemPriceCents={listing.buy_now_price_cents}
          returnPath={`/orders/${payment.orderId}`}
          title="Complete your purchase"
          onSucceeded={() => {
            const { orderId } = payment;
            setPayment(null);
            router.push(`/orders/${orderId}` as Route);
          }}
        />
      ) : null}
    </>
  );
}
