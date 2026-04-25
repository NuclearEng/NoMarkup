// Smoke + branch tests for the notifications page.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/notifications',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/components/layout/NotificationItem', () => ({
  NotificationItem: ({
    notification,
    onMarkRead,
  }: {
    notification: { id: string; title: string };
    onMarkRead: (id: string) => void;
  }) =>
    createElement(
      'div',
      { 'data-testid': `notif-${notification.id}` },
      notification.title,
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            onMarkRead(notification.id);
          },
        },
        `Mark ${notification.id}`,
      ),
    ),
}));

vi.mock('@/hooks/useNotifications', () => ({
  useMarkAllAsRead: vi.fn(),
  useMarkAsRead: vi.fn(),
  useNotifications: vi.fn(),
}));

const { useMarkAllAsRead, useMarkAsRead, useNotifications } = await import(
  '@/hooks/useNotifications'
);
const { default: NotificationsPage } = await import(
  '@/app/(dashboard)/notifications/page'
);

function setHooks(opts: {
  notifications?: unknown[];
  pagination?: { totalPages: number; hasNext: boolean };
  isLoading?: boolean;
  isError?: boolean;
  refetch?: () => void;
  markAsRead?: ReturnType<typeof vi.fn>;
  markAllAsRead?: ReturnType<typeof vi.fn>;
  markAllPending?: boolean;
} = {}) {
  vi.mocked(useNotifications).mockReturnValue({
    data: opts.notifications
      ? { notifications: opts.notifications, pagination: opts.pagination }
      : undefined,
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
    refetch: opts.refetch ?? vi.fn(),
  } as unknown as ReturnType<typeof useNotifications>);
  vi.mocked(useMarkAsRead).mockReturnValue({
    mutateAsync: opts.markAsRead ?? vi.fn().mockResolvedValue(undefined),
    isPending: false,
  } as unknown as ReturnType<typeof useMarkAsRead>);
  vi.mocked(useMarkAllAsRead).mockReturnValue({
    mutateAsync: opts.markAllAsRead ?? vi.fn().mockResolvedValue(undefined),
    isPending: opts.markAllPending ?? false,
  } as unknown as ReturnType<typeof useMarkAllAsRead>);
}

describe('NotificationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setHooks();
  });

  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(NotificationsPage)));
    expect(container).toBeTruthy();
  });

  it('renders the heading and the All / Unread filter buttons', () => {
    render(withQueryClient(createElement(NotificationsPage)));
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'All' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Unread only' })).toBeDefined();
  });

  it('shows the loading content loader when notifications are loading', () => {
    setHooks({ isLoading: true });
    const { container } = render(withQueryClient(createElement(NotificationsPage)));
    // Some loading element is present.
    expect(container.querySelectorAll('div').length).toBeGreaterThan(5);
  });

  it('renders the error empty state with retry', () => {
    const refetch = vi.fn();
    setHooks({ isError: true, refetch });
    render(withQueryClient(createElement(NotificationsPage)));
    expect(screen.getByText('Failed to load notifications')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders the empty (all caught up) state when there are no notifications', () => {
    setHooks({ notifications: [] });
    render(withQueryClient(createElement(NotificationsPage)));
    expect(screen.getByText('No notifications')).toBeDefined();
    expect(screen.getByText("You don't have any notifications yet.")).toBeDefined();
  });

  it('renders the unread-only empty copy after toggling the filter', () => {
    setHooks({ notifications: [] });
    render(withQueryClient(createElement(NotificationsPage)));
    fireEvent.click(screen.getByRole('button', { name: 'Unread only' }));
    expect(
      screen.getByText("You're all caught up! No unread notifications."),
    ).toBeDefined();
  });

  it('renders notification items when present', () => {
    setHooks({
      notifications: [
        { id: 'n1', title: 'Bid placed' },
        { id: 'n2', title: 'Job awarded' },
      ],
    });
    render(withQueryClient(createElement(NotificationsPage)));
    expect(screen.getByTestId('notif-n1')).toBeDefined();
    expect(screen.getByTestId('notif-n2')).toBeDefined();
  });

  it('triggers mark-as-read when a notification mark button is clicked', () => {
    const markAsRead = vi.fn().mockResolvedValue(undefined);
    setHooks({
      notifications: [{ id: 'n1', title: 'Bid placed' }],
      markAsRead,
    });
    render(withQueryClient(createElement(NotificationsPage)));
    fireEvent.click(screen.getByRole('button', { name: 'Mark n1' }));
    expect(markAsRead).toHaveBeenCalledWith('n1');
  });

  it('triggers mark-all-as-read when the header button is clicked', () => {
    const markAllAsRead = vi.fn().mockResolvedValue(undefined);
    setHooks({ markAllAsRead });
    render(withQueryClient(createElement(NotificationsPage)));
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    expect(markAllAsRead).toHaveBeenCalled();
  });

  it('shows the Marking... label while mark-all is pending', () => {
    setHooks({ markAllPending: true });
    render(withQueryClient(createElement(NotificationsPage)));
    expect(screen.getByRole('button', { name: 'Marking...' })).toBeDefined();
  });

  it('renders pagination controls when there are multiple pages', () => {
    setHooks({
      notifications: [{ id: 'n1', title: 'Hello' }],
      pagination: { totalPages: 3, hasNext: true },
    });
    render(withQueryClient(createElement(NotificationsPage)));
    expect(screen.getByRole('button', { name: 'Next' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDefined();
    expect(screen.getByText('Page 1 of 3')).toBeDefined();
  });

  it('disables the Previous button on the first page', () => {
    setHooks({
      notifications: [{ id: 'n1', title: 'Hello' }],
      pagination: { totalPages: 3, hasNext: true },
    });
    render(withQueryClient(createElement(NotificationsPage)));
    const prev = screen.getByRole<HTMLButtonElement>('button', { name: 'Previous' });
    expect(prev.disabled).toBe(true);
  });
});
