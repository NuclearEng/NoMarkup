// Smoke test for the admin dispute detail page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/disputes/123',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({ id: 'dispute-1' }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useAdmin', () => ({
  useAdminDispute: () => ({ data: undefined, isLoading: true, isError: false }),
  useResolveDispute: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
}));

import AdminDisputeDetailPage from '@/app/(dashboard)/admin/disputes/[id]/page';

describe('AdminDisputeDetailPage', () => {
  it('renders without throwing in loading state', () => {
    const { container } = render(withQueryClient(createElement(AdminDisputeDetailPage)));
    expect(container).toBeTruthy();
  });
});
