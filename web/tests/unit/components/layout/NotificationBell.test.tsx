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

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: vi.fn(),
  useUnreadCount: vi.fn(),
  useMarkAsRead: () => ({ mutateAsync: vi.fn(() => Promise.resolve({})) }),
  useMarkAllAsRead: () => ({ mutateAsync: vi.fn(() => Promise.resolve({})) }),
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
});
