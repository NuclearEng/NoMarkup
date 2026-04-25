// Smoke test for the notifications preferences page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/settings/notifications',
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
  useNotificationPreferences: () => ({ data: undefined, isLoading: false }),
  useUpdatePreferences: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import NotificationPrefsPage from '@/app/(dashboard)/settings/notifications/page';

describe('SettingsNotificationsPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(NotificationPrefsPage)));
    expect(container).toBeTruthy();
  });
});
