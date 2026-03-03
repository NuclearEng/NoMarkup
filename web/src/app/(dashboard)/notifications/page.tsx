'use client';

import { useState } from 'react';

import { NotificationItem } from '@/components/layout/NotificationItem';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useMarkAllAsRead, useMarkAsRead, useNotifications } from '@/hooks/useNotifications';
import { cn } from '@/lib/utils';

export default function NotificationsPage() {
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const { data, isLoading, isError } = useNotifications({
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="mt-1 text-muted-foreground">
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
            'min-h-[44px] rounded-full px-4 py-2 text-sm font-medium transition-colors',
            !unreadOnly
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:text-foreground',
          )}
          onClick={() => { if (unreadOnly) handleToggleUnread(); }}
        >
          All
        </button>
        <button
          type="button"
          className={cn(
            'min-h-[44px] rounded-full px-4 py-2 text-sm font-medium transition-colors',
            unreadOnly
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:text-foreground',
          )}
          onClick={() => { if (!unreadOnly) handleToggleUnread(); }}
        >
          Unread only
        </button>
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i}>
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <div className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-muted" />
                  <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-full animate-pulse rounded bg-muted" />
                    <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {/* Error state */}
      {isError ? (
        <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load notifications. Please try refreshing the page.
        </div>
      ) : null}

      {/* Empty state */}
      {!isLoading && !isError && notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border bg-muted/50 py-16">
          <svg
            className="h-12 w-12 text-muted-foreground"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
            />
          </svg>
          <p className="mt-4 text-lg font-medium">No notifications</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {unreadOnly
              ? "You're all caught up! No unread notifications."
              : "You don't have any notifications yet."}
          </p>
        </div>
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
            onClick={() => { setPage((p) => p - 1); }}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {String(page)} of {String(pagination.totalPages)}
          </span>
          <Button
            variant="outline"
            className="min-h-[44px]"
            disabled={!pagination.hasNext}
            onClick={() => { setPage((p) => p + 1); }}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
