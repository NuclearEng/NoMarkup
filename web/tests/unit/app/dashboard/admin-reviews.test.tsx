// Smoke test for the admin flagged reviews page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/reviews',
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

vi.mock('@/hooks/useAdmin', () => ({
  useAdminFlaggedReviews: () => ({ data: undefined, isLoading: false, isError: false }),
  useResolveReviewFlag: () => ({ mutate: vi.fn(), isPending: false }),
}));

import AdminReviewsPage from '@/app/(dashboard)/admin/reviews/page';

describe('AdminReviewsPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(AdminReviewsPage)));
    expect(container).toBeTruthy();
  });
});
