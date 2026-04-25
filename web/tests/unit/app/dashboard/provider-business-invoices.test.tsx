// Smoke test for the provider invoices page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/provider/business/invoices',
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

vi.mock('@/hooks/useContracts', () => ({
  useContracts: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/hooks/useProviderProfile', () => ({
  useProviderProfile: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/hooks/useTaxForms', () => ({
  useGenerateInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import ProviderInvoicesPage from '@/app/(dashboard)/provider/business/invoices/page';

describe('ProviderInvoicesPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(ProviderInvoicesPage)));
    expect(container).toBeTruthy();
  });
});
