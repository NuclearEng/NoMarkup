import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}));

import { NotificationItem } from '@/components/layout/NotificationItem';
import type { Notification } from '@/types';
import { NOTIFICATION_TYPE } from '@/types';

const baseNotification: Notification = {
  id: 'notif-1',
  user_id: 'u-1',
  notification_type: NOTIFICATION_TYPE.NEW_BID,
  title: 'New bid received',
  body: 'A provider just submitted a bid on your job.',
  action_url: '/jobs/job-1',
  data: {},
  is_read: false,
  channels_sent: [],
  created_at: '2026-04-01T11:00:00Z',
  read_at: null,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('NotificationItem', () => {
  it('renders the notification title and body', () => {
    render(<NotificationItem notification={baseNotification} />);
    expect(screen.getByText('New bid received')).toBeDefined();
    expect(screen.getByText('A provider just submitted a bid on your job.')).toBeDefined();
  });

  it('calls onMarkRead when an unread notification is clicked', () => {
    const onMarkRead = vi.fn();
    render(<NotificationItem notification={baseNotification} onMarkRead={onMarkRead} />);
    fireEvent.click(screen.getByText('New bid received'));
    expect(onMarkRead).toHaveBeenCalledWith('notif-1');
  });

  it('does not call onMarkRead for read notifications', () => {
    const onMarkRead = vi.fn();
    const read: Notification = { ...baseNotification, is_read: true };
    render(<NotificationItem notification={read} onMarkRead={onMarkRead} />);
    fireEvent.click(screen.getByText('New bid received'));
    expect(onMarkRead).not.toHaveBeenCalled();
  });

  it('navigates to action_url on click', () => {
    render(<NotificationItem notification={baseNotification} />);
    fireEvent.click(screen.getByText('New bid received'));
    expect(push).toHaveBeenCalledWith('/jobs/job-1');
  });

  it('renders compact variant with smaller layout', () => {
    const { container } = render(
      <NotificationItem notification={baseNotification} variant="compact" />,
    );
    // Compact variant adds px-3 py-2.5 — verify class is present somewhere.
    expect(container.querySelector('.px-3')).not.toBeNull();
  });

  it('renders the gift icon for a wishlist_match notification (not the default bell)', () => {
    const wishlist: Notification = {
      ...baseNotification,
      notification_type: NOTIFICATION_TYPE.WISHLIST_MATCH,
      title: 'A road bike is available for $250',
      body: 'A listing matching "road bike" just went live at $250 — bid now before it\'s gone.',
      action_url: '/marketplace/listing-1',
    };
    render(<NotificationItem notification={wishlist} />);
    // Gift icon for the wishlist price/availability alert.
    expect(screen.getByText('🎁')).toBeDefined();
    // The generic default bell icon must NOT be used for a known type.
    expect(screen.queryByText('🔔')).toBeNull();
  });
});
