// Smoke test for the contract detail page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/contracts/abc',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({ id: 'contract-1' }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useContracts', () => ({
  useContract: () => ({ data: undefined, isLoading: true, isError: false }),
  useStartWork: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useMarkComplete: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useApproveCompletion: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCancelContract: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

vi.mock('@/hooks/useBids', () => ({
  useSavings: () => ({ data: undefined }),
}));

vi.mock('@/hooks/useInstallments', () => ({
  useInstallmentSchedule: () => ({ installments: [] }),
}));

vi.mock('@/hooks/useReviews', () => ({
  useReviewEligibility: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'u1' } }),
}));

import ContractDetailPage from '@/app/(dashboard)/contracts/[id]/page';

describe('ContractDetailPage', () => {
  it('renders without throwing in loading state', () => {
    const { container } = render(withQueryClient(createElement(ContractDetailPage)));
    expect(container).toBeTruthy();
  });
});
