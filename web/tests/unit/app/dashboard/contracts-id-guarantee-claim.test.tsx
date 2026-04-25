// Smoke test for the contract guarantee-claim filing page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/contracts/abc/guarantee-claim',
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
}));

vi.mock('@/hooks/useGuarantee', () => ({
  useGuaranteeClaim: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
}));

import ContractGuaranteeClaimPage from '@/app/(dashboard)/contracts/[id]/guarantee-claim/page';

describe('ContractGuaranteeClaimPage', () => {
  it('renders without throwing in loading state', () => {
    const { container } = render(withQueryClient(createElement(ContractGuaranteeClaimPage)));
    expect(container).toBeTruthy();
  });
});
