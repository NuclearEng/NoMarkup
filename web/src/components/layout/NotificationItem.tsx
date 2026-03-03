'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';

import { cn, formatRelativeTime } from '@/lib/utils';
import { NOTIFICATION_TYPE } from '@/types';
import type { Notification } from '@/types';

interface NotificationItemProps {
  notification: Notification;
  variant?: 'compact' | 'full';
  onMarkRead?: (id: string) => void;
}

const NOTIFICATION_ICON_MAP: Record<string, string> = {
  // Bidding
  [NOTIFICATION_TYPE.NEW_BID]: '\u2696',
  [NOTIFICATION_TYPE.BID_AWARDED]: '\u2696',
  [NOTIFICATION_TYPE.BID_NOT_SELECTED]: '\u2696',
  [NOTIFICATION_TYPE.AUCTION_CLOSING_SOON]: '\u2696',
  [NOTIFICATION_TYPE.AUCTION_CLOSED]: '\u2696',
  [NOTIFICATION_TYPE.OFFER_ACCEPTED]: '\u2696',
  // Contract
  [NOTIFICATION_TYPE.CONTRACT_CREATED]: '\uD83D\uDCC4',
  [NOTIFICATION_TYPE.CONTRACT_ACCEPTED]: '\uD83D\uDCC4',
  [NOTIFICATION_TYPE.WORK_STARTED]: '\uD83D\uDCC4',
  [NOTIFICATION_TYPE.MILESTONE_SUBMITTED]: '\uD83D\uDCC4',
  [NOTIFICATION_TYPE.MILESTONE_APPROVED]: '\uD83D\uDCC4',
  [NOTIFICATION_TYPE.REVISION_REQUESTED]: '\uD83D\uDCC4',
  [NOTIFICATION_TYPE.WORK_COMPLETED]: '\uD83D\uDCC4',
  [NOTIFICATION_TYPE.COMPLETION_APPROVED]: '\uD83D\uDCC4',
  // Payment
  [NOTIFICATION_TYPE.PAYMENT_RECEIVED]: '\uD83D\uDCB3',
  [NOTIFICATION_TYPE.PAYMENT_RELEASED]: '\uD83D\uDCB3',
  [NOTIFICATION_TYPE.PAYMENT_FAILED]: '\uD83D\uDCB3',
  [NOTIFICATION_TYPE.PAYOUT_SENT]: '\uD83D\uDCB3',
  // Chat
  [NOTIFICATION_TYPE.NEW_MESSAGE]: '\uD83D\uDCAC',
  // Review
  [NOTIFICATION_TYPE.REVIEW_RECEIVED]: '\u2B50',
  [NOTIFICATION_TYPE.REVIEW_REMINDER]: '\u2B50',
  // Trust & Safety
  [NOTIFICATION_TYPE.DISPUTE_OPENED]: '\u26A0',
  [NOTIFICATION_TYPE.DISPUTE_RESOLVED]: '\u26A0',
  [NOTIFICATION_TYPE.TIER_UPGRADE]: '\uD83D\uDEE1',
  [NOTIFICATION_TYPE.TIER_DOWNGRADE]: '\uD83D\uDEE1',
};

const DEFAULT_ICON = '\uD83D\uDD14';

export function NotificationItem({ notification, variant = 'full', onMarkRead }: NotificationItemProps) {
  const router = useRouter();
  const icon = NOTIFICATION_ICON_MAP[notification.notification_type] ?? DEFAULT_ICON;
  const isCompact = variant === 'compact';

  function handleClick() {
    if (!notification.is_read && onMarkRead) {
      onMarkRead(notification.id);
    }
    if (notification.action_url) {
      router.push(notification.action_url as Route);
    }
  }

  return (
    <button
      type="button"
      className={cn(
        'flex w-full min-h-[44px] items-start gap-3 text-left transition-colors hover:bg-muted/50',
        isCompact ? 'px-3 py-2.5' : 'rounded-lg border px-4 py-3',
        !notification.is_read && 'bg-primary/5',
      )}
      onClick={() => { handleClick(); }}
    >
      {/* Unread indicator */}
      <div className="flex shrink-0 items-center pt-1">
        <span
          className={cn(
            'block h-2 w-2 rounded-full',
            notification.is_read ? 'bg-transparent' : 'bg-blue-500',
          )}
          aria-hidden="true"
        />
      </div>

      {/* Icon */}
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full bg-muted',
          isCompact ? 'h-8 w-8 text-sm' : 'h-10 w-10 text-base',
        )}
        aria-hidden="true"
      >
        {icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            'text-sm leading-snug',
            !notification.is_read ? 'font-semibold text-foreground' : 'font-medium text-foreground',
          )}
        >
          {notification.title}
        </p>
        <p
          className={cn(
            'text-muted-foreground leading-snug',
            isCompact ? 'text-xs line-clamp-1 mt-0.5' : 'text-sm line-clamp-2 mt-1',
          )}
        >
          {notification.body}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatRelativeTime(new Date(notification.created_at))}
        </p>
      </div>
    </button>
  );
}
