// Smoke test for the provider tax forms page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/provider/business/tax',
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

vi.mock('@/hooks/useAnalytics', () => ({
  useProviderEarnings: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/hooks/useTaxForms', () => ({
  useGenerateTaxForm: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTaxForms: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/lib/api', () => ({
  downloadAuthenticated: vi.fn(),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import ProviderTaxPage from '@/app/(dashboard)/provider/business/tax/page';

describe('ProviderTaxPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(ProviderTaxPage)));
    expect(container).toBeTruthy();
  });
});
