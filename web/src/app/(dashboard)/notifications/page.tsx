'use client';

import { useState } from 'react';

import { NotificationItem } from '@/components/layout/NotificationItem';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Button } from '@/components/ui/button';
import { ContentLoader } from '@/components/ui/content-loader';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTransition } from '@/components/ui/page-transition';
import { useMarkAllAsRead, useMarkAsRead, useNotifications } from '@/hooks/useNotifications';
import { cn } from '@/lib/utils';

export default function NotificationsPage() {
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const { data, isLoading, isError, refetch } = useNotifications({
    unreadOnly,
    page,
    pageSize: 20,
  });

  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();

  const notifications = data?.notifications ?? [];
  const pagination = data?.pagination;

  function handleMarkRead(id: string) {
    void markAsRead.mutateAsync(id);
  }

  function handleMarkAllRead() {
    void markAllAsRead.mutateAsync();
  }

  function handleToggleUnread() {
    setUnreadOnly((prev) => !prev);
    setPage(1);
  }

  return (
    <PageTransition>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="mt-1 text-zinc-300">
            Stay up to date with your activity and updates.
          </p>
        </div>
        <Button
          variant="outline"
          className="min-h-[44px]"
          onClick={handleMarkAllRead}
          disabled={markAllAsRead.isPending}
        >
          {markAllAsRead.isPending ? 'Marking...' : 'Mark all as read'}
        </Button>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={cn(
            'min-h-[44px] rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)]/60',
            !unreadOnly
              ? 'bg-primary text-primary-foreground'
              : 'bg-white/[0.04] text-zinc-300 hover:bg-white/[0.04] hover:text-foreground',
          )}
          onClick={() => {
            if (unreadOnly) handleToggleUnread();
          }}
        >
          All
        </button>
        <button
          type="button"
          className={cn(
            'min-h-[44px] rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)]/60',
            unreadOnly
              ? 'bg-primary text-primary-foreground'
              : 'bg-white/[0.04] text-zinc-300 hover:bg-white/[0.04] hover:text-foreground',
          )}
          onClick={() => {
            if (!unreadOnly) handleToggleUnread();
          }}
        >
          Unread only
        </button>
      </div>

      {/* Loading state */}
      {isLoading ? (
        <ContentLoader preset="message" count={5} className="space-y-3" />
      ) : null}

      {/* Error state */}
      {isError ? (
        <EmptyState
          icon={<AnimatedIllustration type="error" size="sm" />}
          title="Failed to load notifications"
          description="Something went wrong. Check your connection and try again."
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
          className="glass border-destructive/30"
        />
      ) : null}

      {/* Empty state */}
      {!isLoading && !isError && notifications.length === 0 ? (
        <EmptyState
          icon={<AnimatedIllustration type="no-notifications" size="sm" />}
          title="No notifications"
          description={
            unreadOnly
              ? "You're all caught up! No unread notifications."
              : "You don't have any notifications yet."
          }
          className="glass"
        />
      ) : null}

      {/* Notification list */}
      {!isLoading && !isError && notifications.length > 0 ? (
        <div className="space-y-2">
          {notifications.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              variant="full"
              onMarkRead={handleMarkRead}
            />
          ))}
        </div>
      ) : null}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button
            variant="outline"
            className="min-h-[44px]"
            disabled={page <= 1}
            onClick={() => {
              setPage((p) => p - 1);
            }}
          >
            Previous
          </Button>
          <span className="text-zinc-300 text-sm">
            Page {String(page)} of {String(pagination.totalPages)}
          </span>
          <Button
            variant="outline"
            className="min-h-[44px]"
            disabled={!pagination.hasNext}
            onClick={() => {
              setPage((p) => p + 1);
            }}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
    </PageTransition>
  );
}
