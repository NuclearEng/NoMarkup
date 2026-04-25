// Smoke test for the insurance policy detail page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/insurance/abc',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({ id: 'policy-1' }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useInsurance', () => ({
  useInsurancePolicy: () => ({ data: undefined, isLoading: true, isError: false }),
}));

import InsurancePolicyPage from '@/app/(dashboard)/insurance/[id]/page';

describe('InsurancePolicyPage', () => {
  it('renders without throwing in loading state', () => {
    const { container } = render(withQueryClient(createElement(InsurancePolicyPage)));
    expect(container).toBeTruthy();
  });
});
