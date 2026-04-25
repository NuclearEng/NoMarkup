// Smoke test for the installment plan detail page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/payments/installments/abc',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({ id: 'plan-1' }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useInstallments', () => ({
  useInstallmentPlan: () => ({ data: undefined, isLoading: true, isError: false }),
}));

import InstallmentDetailPage from '@/app/(dashboard)/payments/installments/[id]/page';

describe('InstallmentDetailPage', () => {
  it('renders without throwing in loading state', () => {
    const { container } = render(withQueryClient(createElement(InstallmentDetailPage)));
    expect(container).toBeTruthy();
  });
});
