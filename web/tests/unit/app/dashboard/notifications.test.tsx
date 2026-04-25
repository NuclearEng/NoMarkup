// Smoke test for the notifications page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

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

vi.mock('@/hooks/useNotifications', () => ({
  useMarkAllAsRead: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMarkAsRead: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useNotifications: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
}));

import NotificationsPage from '@/app/(dashboard)/notifications/page';

describe('NotificationsPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(NotificationsPage)));
    expect(container).toBeTruthy();
  });
});
