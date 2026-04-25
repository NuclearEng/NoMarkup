// Smoke test for the security settings page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/settings/security',
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

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ data: undefined, isLoading: false }),
}));

import SecuritySettingsPage from '@/app/(dashboard)/settings/security/page';

describe('SecuritySettingsPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(SecuritySettingsPage)));
    expect(container).toBeTruthy();
  });
});
