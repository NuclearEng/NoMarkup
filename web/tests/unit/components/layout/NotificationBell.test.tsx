import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href, ...rest }, children),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}));

const markAsReadMock = vi.fn(() => Promise.resolve({}));
const markAllAsReadMock = vi.fn(() => Promise.resolve({}));

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: vi.fn(),
  useUnreadCount: vi.fn(),
  useMarkAsRead: () => ({ mutateAsync: markAsReadMock }),
  useMarkAllAsRead: () => ({ mutateAsync: markAllAsReadMock }),
}));

vi.mock('@/stores/notification-store', () => ({
  useNotificationStore: vi.fn(),
}));

import { NotificationBell } from '@/components/layout/NotificationBell';
import { useNotifications } from '@/hooks/useNotifications';
import { useNotificationStore } from '@/stores/notification-store';

function mockNotifications(count = 0, items: unknown[] = []) {
  vi.mocked(useNotificationStore).mockImplementation(((selector: unknown) => {
    const state = { unreadCount: count } as unknown;
    return (selector as (s: unknown) => unknown)(state);
  }) as unknown as typeof useNotificationStore);
  vi.mocked(useNotifications).mockReturnValue({
    data: { notifications: items, pagination: { page: 1, page_size: 5, total: items.length } },
    isLoading: false,
  } as unknown as ReturnType<typeof useNotifications>);
}

beforeEach(() => {
  mockNotifications();
  markAsReadMock.mockClear();
  markAllAsReadMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('NotificationBell', () => {
  it('renders the bell button with notifications label when none unread', () => {
    mockNotifications(0);
    render(<NotificationBell />);
    expect(screen.getByLabelText('Notifications')).toBeDefined();
  });

  it('shows the unread count badge when there are unread notifications', () => {
    mockNotifications(7);
    render(<NotificationBell />);
    expect(screen.getByLabelText('Notifications, 7 unread')).toBeDefined();
    expect(screen.getByText('7')).toBeDefined();
  });

  it('caps the displayed badge to 99+', () => {
    mockNotifications(150);
    render(<NotificationBell />);
    expect(screen.getByText('99+')).toBeDefined();
  });

  it('opens the dropdown on click', () => {
    mockNotifications(2);
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText('Notifications, 2 unread'));
    expect(screen.getByText('Notifications')).toBeDefined();
  });

  it('shows empty state when there are no notifications', () => {
    mockNotifications(0, []);
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText('Notifications'));
    expect(screen.getByText('No notifications yet')).toBeDefined();
  });

  it('toggles closed when the bell button is clicked twice', () => {
    mockNotifications(2);
    render(<NotificationBell />);
    const btn = screen.getByLabelText('Notifications, 2 unread');
    fireEvent.click(btn);
    expect(screen.getAllByText('Notifications').length).toBeGreaterThan(0);
    // The header heading 'Notifications' is in the dropdown panel
    expect(screen.getByText('No notifications yet')).toBeDefined();
    fireEvent.click(btn);
    expect(screen.queryByText('No notifications yet')).toBeNull();
  });

  it('clicking Mark all as read invokes the markAllAsRead mutation', () => {
    mockNotifications(3, []);
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText('Notifications, 3 unread'));
    fireEvent.click(screen.getByRole('button', { name: /mark all as read/i }));
    expect(markAllAsReadMock).toHaveBeenCalledTimes(1);
  });

  it('does not show "Mark all as read" when there are no unread notifications', () => {
    mockNotifications(0, []);
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText('Notifications'));
    expect(screen.queryByRole('button', { name: /mark all as read/i })).toBeNull();
  });

  it('renders loading skeletons while notifications are loading', () => {
    vi.mocked(useNotificationStore).mockImplementation(((selector: unknown) => {
      const state = { unreadCount: 0 } as unknown;
      return (selector as (s: unknown) => unknown)(state);
    }) as unknown as typeof useNotificationStore);
    vi.mocked(useNotifications).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useNotifications>);

    const { container } = render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText('Notifications'));
    // Three skeleton stripes inject animate-pulse classes
    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBeGreaterThan(0);
  });

  it('renders notification items when notifications are returned', () => {
    mockNotifications(1, [
      {
        id: 'n-1',
        user_id: 'u',
        type: 'bid_received',
        title: 'New bid',
        message: 'You have a new bid',
        read_at: null,
        action_url: '/jobs/abc',
        created_at: new Date().toISOString(),
      },
    ]);
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText('Notifications, 1 unread'));
    expect(screen.getByText('New bid')).toBeDefined();
  });

  it('closes the dropdown when Escape is pressed', () => {
    mockNotifications(2, []);
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText('Notifications, 2 unread'));
    expect(screen.getByText('No notifications yet')).toBeDefined();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('No notifications yet')).toBeNull();
  });

  it('closes the dropdown on outside click', () => {
    mockNotifications(2, []);
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText('Notifications, 2 unread'));
    expect(screen.getByText('No notifications yet')).toBeDefined();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('No notifications yet')).toBeNull();
  });

  it('renders a "View all notifications" footer link', () => {
    mockNotifications(0, []);
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText('Notifications'));
    const link = screen.getByRole('link', { name: /view all notifications/i });
    expect(link.getAttribute('href')).toBe('/notifications');
  });

  it('clicking the View all link closes the dropdown', () => {
    mockNotifications(0, []);
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText('Notifications'));
    const link = screen.getByRole('link', { name: /view all notifications/i });
    fireEvent.click(link);
    expect(screen.queryByText('No notifications yet')).toBeNull();
  });
});
