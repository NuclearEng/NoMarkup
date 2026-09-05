'use client';

import { useState } from 'react';

import { ActionConfirmDialog } from '@/components/admin/ActionConfirmDialog';
import type { Column } from '@/components/admin/DataTable';
import { DataTable } from '@/components/admin/DataTable';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageTransition } from '@/components/ui/page-transition';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  type AdminListing,
  useAdminListings,
  useCancelListing,
  useReactivateListing,
  useSuspendListing,
} from '@/hooks/useAdmin';
import { formatCents } from '@/lib/utils';

const ALL_FILTER = '__all__';

const LISTING_STATUSES = ['active', 'sold', 'cancelled', 'expired', 'draft'] as const;

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

type ActionKind = 'suspend' | 'reactivate' | 'cancel';

export default function AdminListingsPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [actionTarget, setActionTarget] = useState<{
    listing: AdminListing;
    action: ActionKind;
  } | null>(null);
  const [reason, setReason] = useState('');

  const { data, isLoading, isError } = useAdminListings({
    status: statusFilter,
    q: submittedSearch || undefined,
    page,
    page_size: 20,
  });

  const suspendMutation = useSuspendListing();
  const reactivateMutation = useReactivateListing();
  const cancelMutation = useCancelListing();

  async function handleConfirm() {
    if (!actionTarget) return;
    if (actionTarget.action === 'suspend') {
      await suspendMutation.mutateAsync({ listingId: actionTarget.listing.id, reason });
    } else if (actionTarget.action === 'reactivate') {
      await reactivateMutation.mutateAsync({ listingId: actionTarget.listing.id });
    } else {
      await cancelMutation.mutateAsync({ listingId: actionTarget.listing.id, reason });
    }
    setActionTarget(null);
    setReason('');
  }

  const columns: Column<AdminListing>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (l) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{l.title}</p>
          <p className="text-xs text-zinc-300">Seller: {l.seller_email || l.seller_id.slice(0, 8)}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (l) => (
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline" className="text-xs capitalize">
            {l.status}
          </Badge>
          {l.is_hidden && (
            <Badge variant="destructive" className="text-xs">
              Hidden
            </Badge>
          )}
          {l.open_report_count > 0 && (
            <Badge variant="secondary" className="text-xs">
              {l.open_report_count} report{l.open_report_count === 1 ? '' : 's'}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      render: (l) => (
        <div className="text-sm tabular-nums">
          <p>
            {l.current_bid_cents != null && l.current_bid_cents > 0
              ? formatCents(l.current_bid_cents)
              : '--'}
          </p>
          <p className="text-xs text-zinc-300">start: {formatCents(l.starting_price_cents)}</p>
        </div>
      ),
    },
    {
      key: 'bids',
      header: 'Bids',
      className: 'whitespace-nowrap',
      render: (l) => <span className="tabular-nums">{l.bid_count}</span>,
    },
    {
      key: 'ends',
      header: 'Auction Ends',
      className: 'whitespace-nowrap',
      render: (l) => <span className="text-zinc-300">{formatDate(l.auction_ends_at)}</span>,
    },
    {
      key: 'actions',
      sticky: true,
      header: 'Actions',
      className: 'text-right',
      render: (l) => (
        <div className="flex justify-end gap-2">
          {l.is_hidden ? (
            <Button
              variant="outline"
              size="sm"
              className="min-h-[44px]"
              onClick={(e) => {
                e.stopPropagation();
                setActionTarget({ listing: l, action: 'reactivate' });
              }}
              aria-label={`Reactivate listing: ${l.title}`}
            >
              Reactivate
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="min-h-[44px]"
              onClick={(e) => {
                e.stopPropagation();
                setActionTarget({ listing: l, action: 'suspend' });
              }}
              aria-label={`Suspend listing: ${l.title}`}
            >
              Suspend
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            className="min-h-[44px]"
            disabled={l.status === 'cancelled'}
            onClick={(e) => {
              e.stopPropagation();
              setActionTarget({ listing: l, action: 'cancel' });
            }}
            aria-label={`Cancel listing: ${l.title}`}
          >
            Cancel
          </Button>
        </div>
      ),
    },
  ];

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="gold-text text-2xl font-bold tracking-tight">Listings</h1>
        <EmptyState
          icon={<AnimatedIllustration type="error" size="sm" />}
          title="Failed to load listings"
          description="Please try refreshing the page."
        />
      </div>
    );
  }

  const isPending =
    suspendMutation.isPending || reactivateMutation.isPending || cancelMutation.isPending;

  // Map the marketplace response shape to the DataTable's PaginationResponse contract.
  const pagination = data?.pagination
    ? {
        totalCount: data.pagination.total,
        page: data.pagination.page,
        pageSize: data.pagination.page_size,
        totalPages: Math.max(
          1,
          Math.ceil(data.pagination.total / Math.max(1, data.pagination.page_size)),
        ),
        hasNext: data.pagination.page * data.pagination.page_size < data.pagination.total,
      }
    : undefined;

  const dialogTitle =
    actionTarget?.action === 'cancel'
      ? 'Cancel Listing'
      : actionTarget?.action === 'reactivate'
        ? 'Reactivate Listing'
        : 'Suspend Listing';

  const dialogDescription =
    actionTarget?.action === 'cancel'
      ? `Permanently cancel "${actionTarget.listing.title}"? Active bids will be invalidated. Use this for prohibited-items policy violations.`
      : actionTarget?.action === 'reactivate'
        ? `Reactivate "${actionTarget.listing.title}"? It will appear in the public marketplace again.`
        : actionTarget
          ? `Suspend "${actionTarget.listing.title}"? It will be hidden from the public marketplace.`
          : '';

  return (
    <PageTransition>
      <div className="space-y-6">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">Listings</h1>
          <p className="mt-1 text-zinc-300">
            Moderate the goods marketplace. Suspend, reactivate, or force-cancel listings.
          </p>
        </div>

        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmittedSearch(searchQuery.trim());
            setPage(1);
          }}
        >
          <Input
            type="search"
            placeholder="Search title..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
            className="min-h-[44px] sm:w-[260px]"
            aria-label="Search listings"
          />
          <Select
            value={statusFilter ?? ALL_FILTER}
            onValueChange={(v) => {
              setStatusFilter(v === ALL_FILTER ? undefined : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="min-h-[44px] w-[160px]" aria-label="Filter by status">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER}>All Statuses</SelectItem>
              {LISTING_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" variant="outline" className="min-h-[44px]">
            Search
          </Button>
        </form>

        <DataTable
          columns={columns}
          data={data?.listings ?? []}
          rowKey={(l) => l.id}
          pagination={pagination}
          page={page}
          onPageChange={setPage}
          loading={isLoading}
          emptyMessage="No listings found matching the current filters."
        />

        <ActionConfirmDialog
          open={actionTarget !== null}
          onClose={() => {
            setActionTarget(null);
            setReason('');
          }}
          onConfirm={() => {
            void handleConfirm();
          }}
          title={dialogTitle}
          description={dialogDescription}
          confirmLabel={dialogTitle}
          destructive={actionTarget?.action !== 'reactivate'}
          loading={isPending}
          confirmDisabled={actionTarget?.action !== 'reactivate' && !reason.trim()}
        >
          {actionTarget?.action !== 'reactivate' && (
            <div className="space-y-2">
              <label htmlFor="listing-action-reason" className="text-sm font-medium">
                Reason
              </label>
              <Textarea
                id="listing-action-reason"
                placeholder="Provide a reason for this action..."
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                }}
                rows={3}
              />
            </div>
          )}
        </ActionConfirmDialog>
      </div>
    </PageTransition>
  );
}
