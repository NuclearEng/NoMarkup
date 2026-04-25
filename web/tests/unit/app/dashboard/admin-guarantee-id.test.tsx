// Smoke test for the admin guarantee claim detail page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/guarantee/123',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({ id: 'g-1' }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useAdmin', () => ({
  useAdminDispute: () => ({ data: undefined, isLoading: true, isError: false }),
}));

vi.mock('@/hooks/useGuarantee', () => ({
  useAdminGuaranteeClaim: () => ({ data: undefined, isLoading: true, isError: false }),
  useResolveGuaranteeClaim: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useApproveGuaranteeClaim: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDenyGuaranteeClaim: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import AdminGuaranteeDetailPage from '@/app/(dashboard)/admin/guarantee/[id]/page';

describe('AdminGuaranteeDetailPage', () => {
  it('renders without throwing in loading state', () => {
    const { container } = render(withQueryClient(createElement(AdminGuaranteeDetailPage)));
    expect(container).toBeTruthy();
  });
});
