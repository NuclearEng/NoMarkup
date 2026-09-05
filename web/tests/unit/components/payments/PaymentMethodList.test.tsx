import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { PaymentMethodList } from '@/components/payments/PaymentMethodList';

vi.mock('@/hooks/usePayments', () => ({
  usePaymentMethods: vi.fn(),
  useDeletePaymentMethod: vi.fn(),
}));

const { usePaymentMethods, useDeletePaymentMethod } = await import('@/hooks/usePayments');

const useMethodsMock = vi.mocked(usePaymentMethods);
const useDeleteMock = vi.mocked(useDeletePaymentMethod);

function defaultDelete() {
  return {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  } as unknown as ReturnType<typeof useDeletePaymentMethod>;
}

describe('PaymentMethodList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDeleteMock.mockReturnValue(defaultDelete());
  });

  it('shows loading skeletons while fetching', () => {
    useMethodsMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof usePaymentMethods>);

    const { container } = render(createElement(PaymentMethodList));
    // skeleton elements are present
    expect(container.querySelectorAll('[class*="skeleton"], .h-10').length).toBeGreaterThan(0);
  });

  it('shows error state on fetch failure', () => {
    useMethodsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof usePaymentMethods>);

    render(createElement(PaymentMethodList));
    expect(screen.getByText(/Failed to load payment methods/)).toBeDefined();
  });

  it('shows empty state when no methods are saved', () => {
    useMethodsMock.mockReturnValue({
      data: { payment_methods: [] },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof usePaymentMethods>);

    render(createElement(PaymentMethodList));
    expect(screen.getByText('No payment methods')).toBeDefined();
  });

  it('renders the saved payment methods with brand and last four', () => {
    useMethodsMock.mockReturnValue({
      data: {
        payment_methods: [
          {
            id: 'pm-1',
            type: 'card',
            brand: 'visa',
            last_four: '4242',
            exp_month: 12,
            exp_year: 2030,
            is_default: true,
          },
          {
            id: 'pm-2',
            type: 'card',
            brand: 'mastercard',
            last_four: '4444',
            exp_month: 5,
            exp_year: 2031,
            is_default: false,
          },
        ],
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof usePaymentMethods>);

    render(createElement(PaymentMethodList));

    expect(screen.getByText('visa')).toBeDefined();
    expect(screen.getByText('mastercard')).toBeDefined();
    expect(screen.getByText('**** 4242')).toBeDefined();
    expect(screen.getByText('**** 4444')).toBeDefined();
    expect(screen.getByText('Default')).toBeDefined();
  });

  it('asks for confirmation before deleting and calls the hook on confirm', async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    useDeleteMock.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useDeletePaymentMethod>);
    useMethodsMock.mockReturnValue({
      data: {
        payment_methods: [
          {
            id: 'pm-1',
            type: 'card',
            brand: 'visa',
            last_four: '4242',
            exp_month: 12,
            exp_year: 2030,
            is_default: false,
          },
        ],
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof usePaymentMethods>);

    const user = userEvent.setup();
    render(createElement(PaymentMethodList));

    await user.click(screen.getByRole('button', { name: /Delete payment method/ }));
    expect(screen.getByRole('button', { name: /Confirm/ })).toBeDefined();

    await user.click(screen.getByRole('button', { name: /Confirm/ }));
    expect(mutateAsync).toHaveBeenCalledWith('pm-1');
  });

  it('cancels the delete confirmation when Cancel is clicked', async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    useDeleteMock.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useDeletePaymentMethod>);
    useMethodsMock.mockReturnValue({
      data: {
        payment_methods: [
          {
            id: 'pm-1',
            type: 'card',
            brand: 'visa',
            last_four: '4242',
            exp_month: 12,
            exp_year: 2030,
            is_default: false,
          },
        ],
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof usePaymentMethods>);

    const user = userEvent.setup();
    render(createElement(PaymentMethodList));

    await user.click(screen.getByRole('button', { name: /Delete payment method/ }));
    await user.click(screen.getByRole('button', { name: /Cancel/ }));
    // The delete-trigger button (with the trash icon) is back.
    expect(screen.getByRole('button', { name: /Delete payment method/ })).toBeDefined();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('shows the Removing... label on the Confirm button while a delete is in flight', async () => {
    // Exercises the isDeleting branch at line 58.
    useDeleteMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: true,
    } as unknown as ReturnType<typeof useDeletePaymentMethod>);
    useMethodsMock.mockReturnValue({
      data: {
        payment_methods: [
          {
            id: 'pm-1',
            type: 'card',
            brand: 'visa',
            last_four: '4242',
            exp_month: 12,
            exp_year: 2030,
            is_default: false,
          },
        ],
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof usePaymentMethods>);

    const user = userEvent.setup();
    render(createElement(PaymentMethodList));

    await user.click(screen.getByRole('button', { name: /Delete payment method/ }));
    const removing = screen.getByRole('button', { name: /Removing\.\.\./ });
    expect((removing as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders the empty-state when data is undefined (no payment_methods key)', () => {
    // Exercises the `data?.payment_methods ?? []` fallback at line 122.
    useMethodsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof usePaymentMethods>);

    render(createElement(PaymentMethodList));
    expect(screen.getByText('No payment methods')).toBeDefined();
  });
});
