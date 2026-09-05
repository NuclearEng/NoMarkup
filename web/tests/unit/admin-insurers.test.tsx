import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => { toastSuccess(...args); },
    error: (...args: unknown[]) => { toastError(...args); },
  },
}));

const useAdminInsurers = vi.fn();
const onboardMutate = vi.fn();
const updateMutate = vi.fn();

vi.mock('@/hooks/useAdmin', async () => {
  // Re-export the real const-object enums so the page's labels/values are real.
  const actual =
    await vi.importActual<typeof import('@/hooks/useAdmin')>('@/hooks/useAdmin');
  return {
    ...actual,
    useAdminInsurers: () => useAdminInsurers() as unknown,
    useOnboardInsurer: () => ({ mutate: onboardMutate, isPending: false }),
    useUpdateInsurer: () => ({ mutate: updateMutate, isPending: false }),
  };
});

// Keep the page's visual deps light + deterministic.
vi.mock('@/components/ui/page-transition', () => ({
  PageTransition: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children),
}));
vi.mock('@/components/ui/animated-illustration', () => ({
  AnimatedIllustration: () => createElement('div', { 'data-testid': 'illustration' }),
}));

import AdminInsurersPage from '@/app/(dashboard)/admin/insurers/page';
import { INSURER_STATUS, INSURANCE_PRODUCT_TYPE } from '@/hooks/useAdmin';
import type { Insurer } from '@/hooks/useAdmin';

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function renderPage() {
  return render(createElement(AdminInsurersPage), { wrapper: createWrapper() });
}

const sampleInsurer: Insurer = {
  id: 'ins-1',
  name: 'Acme Mutual',
  slug: 'acme-mutual',
  status: INSURER_STATUS.PENDING,
  created_at: '2026-06-01T00:00:00Z',
  products: [
    {
      id: 'p-1',
      product_type: INSURANCE_PRODUCT_TYPE.WORKMANSHIP,
      base_rate_bps: 250,
      min_premium_cents: 5000,
      active: true,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  useAdminInsurers.mockReset();
});

describe('AdminInsurersPage', () => {
  it('renders loading state', () => {
    useAdminInsurers.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderPage();
    expect(
      screen.getByRole('heading', { name: 'Insurers', level: 1 }),
    ).toBeInTheDocument();
  });

  it('renders error state', () => {
    useAdminInsurers.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderPage();
    expect(screen.getByText('Failed to load insurers')).toBeInTheDocument();
  });

  it('renders empty state when there are no insurers', () => {
    useAdminInsurers.mockReturnValue({
      data: { insurers: [] },
      isLoading: false,
      isError: false,
    });
    renderPage();
    expect(screen.getByText('No insurers yet')).toBeInTheDocument();
  });

  it('lists insurers with status badge and rate card', () => {
    useAdminInsurers.mockReturnValue({
      data: { insurers: [sampleInsurer] },
      isLoading: false,
      isError: false,
    });
    renderPage();

    expect(screen.getByText('Acme Mutual')).toBeInTheDocument();
    expect(screen.getByText('acme-mutual')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    // Rate card: 250 bps -> 2.5%, 5000 cents -> $50.00, workmanship label.
    expect(screen.getByText('Workmanship')).toBeInTheDocument();
    expect(screen.getByText('2.5%')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
  });

  it('approves an insurer (status -> approved)', async () => {
    useAdminInsurers.mockReturnValue({
      data: { insurers: [sampleInsurer] },
      isLoading: false,
      isError: false,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    const [payload] = updateMutate.mock.calls[0] as [{ id: string; status: string }];
    expect(payload).toEqual({ id: 'ins-1', status: INSURER_STATUS.APPROVED });
  });

  it('onboards a new insurer, converting % -> bps and $ -> cents', async () => {
    useAdminInsurers.mockReturnValue({
      data: { insurers: [] },
      isLoading: false,
      isError: false,
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Name'), 'Beta Insurance');
    await user.type(screen.getByLabelText('Slug'), 'beta-insurance');
    await user.type(screen.getByLabelText('Base rate (%)'), '3');
    await user.type(screen.getByLabelText('Min premium ($)'), '100');

    await user.click(screen.getByRole('button', { name: 'Onboard insurer' }));

    await waitFor(() => {
      expect(onboardMutate).toHaveBeenCalledTimes(1);
    });
    const [payload] = onboardMutate.mock.calls[0] as [
      { name: string; slug: string; products: Array<Record<string, unknown>> },
    ];
    expect(payload.name).toBe('Beta Insurance');
    expect(payload.slug).toBe('beta-insurance');
    expect(payload.products).toHaveLength(1);
    expect(payload.products[0]).toEqual({
      product_type: INSURANCE_PRODUCT_TYPE.PROPERTY_DAMAGE,
      base_rate_bps: 300,
      min_premium_cents: 10000,
    });
  });

  it('blocks onboarding with an invalid slug', async () => {
    useAdminInsurers.mockReturnValue({
      data: { insurers: [] },
      isLoading: false,
      isError: false,
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Name'), 'Bad Slug Co');
    await user.type(screen.getByLabelText('Slug'), 'Not A Slug');
    await user.type(screen.getByLabelText('Base rate (%)'), '2');
    await user.type(screen.getByLabelText('Min premium ($)'), '10');

    await user.click(screen.getByRole('button', { name: 'Onboard insurer' }));

    expect(onboardMutate).not.toHaveBeenCalled();
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(/slug/i)).toBeInTheDocument();
  });
});
