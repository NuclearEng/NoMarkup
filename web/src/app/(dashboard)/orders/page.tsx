'use client';

import { MapPin, Package } from 'lucide-react';
import type { Route } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useMyOrders } from '@/hooks/useListings';
import { canNextImageLoad, formatCents, formatRelativeTime } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { LISTING_ORDER_STATUS, type ListingOrder, type ListingOrderStatus } from '@/types';

// Maps each order-lifecycle status onto a semantic Badge variant. The variants
// (active/completed/disputed/cancelled/pending) are defined in badge.tsx; an
// unknown status falls back to the neutral 'secondary' chip rather than crash.
function statusBadgeVariant(
  status: ListingOrderStatus,
): 'active' | 'completed' | 'disputed' | 'cancelled' | 'pending' | 'secondary' {
  switch (status) {
    case LISTING_ORDER_STATUS.PAID:
    case LISTING_ORDER_STATUS.PICKED_UP:
      return 'active';
    case LISTING_ORDER_STATUS.COMPLETED:
      return 'completed';
    case LISTING_ORDER_STATUS.DISPUTED:
      return 'disputed';
    case LISTING_ORDER_STATUS.CANCELLED:
      return 'cancelled';
    case LISTING_ORDER_STATUS.PENDING:
      return 'pending';
    default:
      return 'secondary';
  }
}

export default function OrdersPage() {
  const { data: orders, isLoading, isError, refetch } = useMyOrders();
  const currentUserId = useAuthStore((s) => s.user?.id);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Orders</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Items you&apos;ve bought and sold on the marketplace.
        </p>
      </div>

      {isLoading ? (
        <ul className="space-y-3" aria-busy="true" aria-label="Loading orders">
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <div className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="h-16 w-16 shrink-0 animate-pulse rounded-lg bg-white/[0.06]" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-1/2 animate-pulse rounded bg-white/[0.06]" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-white/[0.06]" />
                </div>
                <div className="h-4 w-16 animate-pulse rounded bg-white/[0.06]" />
              </div>
            </li>
          ))}
        </ul>
      ) : isError ? (
        <EmptyState
          title="Couldn't load your orders"
          description="Something went wrong fetching your orders. Please try again."
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
      ) : !orders || orders.length === 0 ? (
        <EmptyState
          icon={<Package className="h-7 w-7" aria-hidden="true" />}
          title="No orders yet"
          description="When you win an auction or sell an item, your orders show up here."
          action={
            <Button asChild variant="default" className="min-h-[44px]">
              <Link href={'/marketplace' as Route}>Browse the marketplace</Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => (
            <li key={order.id}>
              <OrderCard order={order} currentUserId={currentUserId} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OrderCard({
  order,
  currentUserId,
}: {
  order: ListingOrder;
  currentUserId: string | undefined;
}) {
  // The /me/orders list mixes both roles, so derive this order's role from the
  // caller's id. Default to "buyer" if the user id hasn't hydrated yet — the
  // detail page enforces the real authorization, this label is presentational.
  const isSeller = currentUserId !== undefined && currentUserId === order.seller_id;
  const roleLabel = isSeller ? 'Selling' : 'Buying';
  const counterpartyLabel = isSeller ? 'Buyer' : order.seller_display_name;

  const photo =
    order.listing_photo_url && canNextImageLoad(order.listing_photo_url)
      ? order.listing_photo_url
      : null;

  const statusText = order.status.replace(/_/g, ' ');
  const pickupLocation =
    order.pickup_city && order.pickup_state
      ? `${order.pickup_city}, ${order.pickup_state}`
      : null;

  return (
    <Link
      href={`/orders/${order.id}` as Route}
      className="flex min-h-[44px] items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)]/50"
    >
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-white/[0.04]">
        {photo ? (
          <Image
            src={photo}
            alt=""
            fill
            sizes="64px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-zinc-700">
            <Package className="h-6 w-6" aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-zinc-300">
            {roleLabel}
          </span>
          <p className="truncate text-sm font-semibold text-zinc-100">{order.listing_title}</p>
        </div>
        <p className="mt-0.5 truncate text-xs text-zinc-400">
          {isSeller ? 'Buyer' : 'Seller'}: {counterpartyLabel}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          {pickupLocation ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" aria-hidden="true" />
              {pickupLocation}
            </span>
          ) : null}
          <span>Ordered {formatRelativeTime(new Date(order.created_at))}</span>
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2 text-right">
        <span className="text-sm font-semibold tabular-nums text-zinc-100">
          {formatCents(order.amount_cents)}
        </span>
        <Badge variant={statusBadgeVariant(order.status)} className="capitalize">
          <span className="sr-only">Status: </span>
          {statusText}
        </Badge>
      </div>
    </Link>
  );
}
