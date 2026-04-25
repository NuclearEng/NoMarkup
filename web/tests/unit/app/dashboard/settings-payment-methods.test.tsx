// Smoke test for the payment methods settings page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/settings/payment-methods',
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

vi.mock('@/components/payments/AddPaymentMethodForm', () => ({
  AddPaymentMethodForm: () => createElement('div', { 'data-testid': 'add-pm-form' }),
}));

vi.mock('@/hooks/usePayments', () => ({
  useCreateStripeAccount: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeletePaymentMethod: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePaymentMethods: () => ({ data: undefined, isLoading: false, isError: false }),
  useStripeAccountStatus: () => ({ data: undefined, isLoading: false }),
}));

import PaymentMethodsPage from '@/app/(dashboard)/settings/payment-methods/page';

describe('PaymentMethodsPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(PaymentMethodsPage)));
    expect(container).toBeTruthy();
  });
});
