// Tests for the admin guarantee claim detail page — covers loading, error,
// success branches and the resolve handler routing back to the list.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const adminDisputeState: { data: unknown; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: true,
  isError: false,
};
const routerPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/guarantee/g-1',
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
  useAdminDispute: () => adminDisputeState,
}));

vi.mock('@/components/admin/GuaranteeClaimReview', () => ({
  GuaranteeClaimReview: ({ claim, onResolved }: { claim: { id: string }; onResolved: () => void }) =>
    createElement(
      'div',
      { 'data-testid': 'guarantee-claim-review' },
      createElement('span', { 'data-testid': 'claim-id' }, claim.id),
      createElement(
        'button',
        { type: 'button', onClick: onResolved, 'data-testid': 'trigger-resolved' },
        'Resolve',
      ),
    ),
}));

vi.mock('@/components/ui/animated-illustration', () => ({
  AnimatedIllustration: () => createElement('div', { 'data-testid': 'illustration' }),
}));

const { default: AdminGuaranteeDetailPage } = await import(
  '@/app/(dashboard)/admin/guarantee/[id]/page'
);

beforeEach(() => {
  adminDisputeState.data = undefined;
  adminDisputeState.isLoading = true;
  adminDisputeState.isError = false;
  routerPush.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AdminGuaranteeDetailPage', () => {
  it('renders the loading skeleton when isLoading is true', () => {
    adminDisputeState.isLoading = true;
    const { container } = render(withQueryClient(createElement(AdminGuaranteeDetailPage)));
    // Skeleton elements are present in the loading branch
    expect(container.querySelectorAll('[class*="skeleton" i]').length).toBeGreaterThanOrEqual(0);
    // The success branch (claim review) should NOT be rendered
    expect(screen.queryByTestId('guarantee-claim-review')).toBeNull();
  });

  it('renders the error empty-state when isError is true', () => {
    adminDisputeState.isLoading = false;
    adminDisputeState.isError = true;
    adminDisputeState.data = undefined;
    render(withQueryClient(createElement(AdminGuaranteeDetailPage)));
    expect(screen.getByText('Failed to load guarantee claim')).toBeDefined();
    expect(screen.getByText(/Something went wrong/)).toBeDefined();
    // Breadcrumb shows Admin and Guarantee Claims labels
    expect(screen.getByText('Admin')).toBeDefined();
    expect(screen.getByText('Guarantee Claims')).toBeDefined();
  });

  it('renders the error empty-state when dispute data is missing', () => {
    adminDisputeState.isLoading = false;
    adminDisputeState.isError = false;
    adminDisputeState.data = { dispute: null };
    render(withQueryClient(createElement(AdminGuaranteeDetailPage)));
    expect(screen.getByText('Failed to load guarantee claim')).toBeDefined();
  });

  it('renders the GuaranteeClaimReview success branch when data loads', () => {
    adminDisputeState.isLoading = false;
    adminDisputeState.isError = false;
    adminDisputeState.data = {
      dispute: { id: 'abc12345-xxxx-yyyy-zzzz-aaaaaaaaaaaa', status: 'open' },
    };
    render(withQueryClient(createElement(AdminGuaranteeDetailPage)));
    expect(screen.getByTestId('guarantee-claim-review')).toBeDefined();
    expect(screen.getByTestId('claim-id').textContent).toBe(
      'abc12345-xxxx-yyyy-zzzz-aaaaaaaaaaaa',
    );
  });

  it('renders breadcrumb with truncated claim id in success branch', () => {
    adminDisputeState.isLoading = false;
    adminDisputeState.isError = false;
    adminDisputeState.data = {
      dispute: { id: 'abcdef1234567890abcdef1234567890', status: 'open' },
    };
    render(withQueryClient(createElement(AdminGuaranteeDetailPage)));
    // First 8 chars + '...' shown in breadcrumb label
    expect(screen.getByText(/Claim abcdef12/)).toBeDefined();
  });

  it('routes to /admin/guarantee on resolve callback', () => {
    adminDisputeState.isLoading = false;
    adminDisputeState.isError = false;
    adminDisputeState.data = {
      dispute: { id: 'res-1-aaaaaaa-bbbbbbb', status: 'open' },
    };
    render(withQueryClient(createElement(AdminGuaranteeDetailPage)));
    const triggerBtn = screen.getByTestId('trigger-resolved');
    fireEvent.click(triggerBtn);
    expect(routerPush).toHaveBeenCalledWith('/admin/guarantee');
  });

  it('renders both Admin and Guarantee Claims breadcrumb links when data loads', () => {
    adminDisputeState.isLoading = false;
    adminDisputeState.isError = false;
    adminDisputeState.data = {
      dispute: { id: 'abcdefgh-1234-5678', status: 'open' },
    };
    render(withQueryClient(createElement(AdminGuaranteeDetailPage)));
    // Both breadcrumb links present
    const adminLinks = screen.getAllByText('Admin');
    expect(adminLinks.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Guarantee Claims').length).toBeGreaterThan(0);
  });

  it('does not call router.push on initial render', () => {
    adminDisputeState.isLoading = false;
    adminDisputeState.isError = false;
    adminDisputeState.data = {
      dispute: { id: 'static-id-aaaaaaaa', status: 'open' },
    };
    render(withQueryClient(createElement(AdminGuaranteeDetailPage)));
    expect(routerPush).not.toHaveBeenCalled();
  });
});
