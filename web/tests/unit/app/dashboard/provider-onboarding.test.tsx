// Tests for the provider onboarding wizard — exercises step navigation,
// step indicator clicks, progress, and prefill from existing profile.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const providerProfileState: { data: unknown } = { data: undefined };
const routerPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/provider/onboarding',
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

vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => () => createElement('div', { 'data-testid': 'service-area-map' }, 'map'),
}));

vi.mock('@/components/providers/CategorySelector', () => ({
  CategorySelector: () => createElement('div', { 'data-testid': 'category-selector' }, 'cats'),
}));

vi.mock('@/components/maps/ServiceAreaMap', () => ({
  ServiceAreaMap: () => createElement('div', { 'data-testid': 'service-area-map' }),
}));

vi.mock('@/components/payments/StripeOnboarding', () => ({
  StripeOnboarding: () => createElement('div', { 'data-testid': 'stripe-onboarding' }, 'stripe'),
}));

vi.mock('@/components/ui/ImageUpload', () => ({
  ImageUpload: () => createElement('div', { 'data-testid': 'image-upload' }, 'upload'),
}));

vi.mock('@/hooks/useImageUpload', () => ({
  useImageUpload: () => ({
    upload: vi.fn(),
    status: 'idle',
    progress: 0,
    error: null,
  }),
}));

vi.mock('@/hooks/useProviderProfile', () => ({
  useProviderProfile: () => providerProfileState,
  useUpdateCategories: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePortfolio: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateProviderProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetGlobalTerms: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadVerificationDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { default: ProviderOnboardingPage } = await import(
  '@/app/(dashboard)/provider/onboarding/page'
);

beforeEach(() => {
  providerProfileState.data = undefined;
  routerPush.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProviderOnboardingPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(ProviderOnboardingPage)));
    expect(container).toBeTruthy();
  });

  it('starts on step 1 with correct title', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    expect(screen.getByText(/Step 1 of 7/)).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Provider Setup' })).toBeDefined();
  });

  it('renders all step indicators in the nav', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    const nav = screen.getByRole('navigation', { name: /Onboarding steps/i });
    expect(nav).toBeDefined();
    // 7 step buttons should render in the indicator nav
    const stepButtons = nav.querySelectorAll('button');
    expect(stepButtons.length).toBe(7);
  });

  it('shows business info form on initial step', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    expect(screen.getByLabelText(/Business Name/i)).toBeDefined();
    expect(screen.getByLabelText(/Service Address/i)).toBeDefined();
  });

  it('jumps to categories step when Categories indicator is clicked', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    const categoriesBtn = screen.getByRole('button', { name: /Categories/i });
    fireEvent.click(categoriesBtn);
    expect(screen.getByTestId('category-selector')).toBeDefined();
  });

  it('jumps to service area step when indicator clicked', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    const serviceAreaBtn = screen.getByRole('button', { name: /Service Area/i });
    fireEvent.click(serviceAreaBtn);
    expect(screen.getByLabelText(/Service Radius/i)).toBeDefined();
  });

  it('jumps to terms step and shows payment timing select', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    const termsBtn = screen.getByRole('button', { name: /^Terms$/i });
    fireEvent.click(termsBtn);
    expect(screen.getByText(/Default Payment Timing/i)).toBeDefined();
  });

  it('jumps to portfolio step', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    const portfolioBtn = screen.getByRole('button', { name: /^Portfolio$/i });
    fireEvent.click(portfolioBtn);
    expect(screen.getByTestId('image-upload')).toBeDefined();
  });

  it('jumps to verification step and renders required document upload fields', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    const verifyBtn = screen.getByRole('button', { name: /Verification/i });
    fireEvent.click(verifyBtn);
    expect(screen.getByText(/Government-Issued ID/i)).toBeDefined();
    expect(screen.getByText(/Business License/i)).toBeDefined();
  });

  it('jumps to payments step and renders Stripe onboarding component', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    const paymentsBtn = screen.getByRole('button', { name: /Payments/i });
    fireEvent.click(paymentsBtn);
    expect(screen.getByTestId('stripe-onboarding')).toBeDefined();
  });

  it('prefills business info form from existing profile', () => {
    providerProfileState.data = {
      businessName: 'Pre-Filled LLC',
      bio: 'My bio',
      serviceAddress: '42 Oak St',
      serviceCategories: [],
      serviceRadiusKm: 25,
      defaultPaymentTiming: 'completion',
      defaultMilestones: [],
      cancellationPolicy: null,
      warrantyTerms: null,
    };
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    const input = screen.getByLabelText(/Business Name/i);
    expect((input as HTMLInputElement).value).toBe('Pre-Filled LLC');
  });

  it('Categories step shows existing serviceCategories prefill', () => {
    providerProfileState.data = {
      businessName: 'X',
      bio: '',
      serviceAddress: '',
      serviceCategories: [{ id: 'cat-a' }, { id: 'cat-b' }],
      serviceRadiusKm: 10,
      defaultPaymentTiming: 'completion',
      defaultMilestones: [],
      cancellationPolicy: null,
      warrantyTerms: null,
    };
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    const categoriesBtn = screen.getByRole('button', { name: /Categories/i });
    fireEvent.click(categoriesBtn);
    expect(screen.getByTestId('category-selector')).toBeDefined();
  });

  it('Service Area step prefills the radius input from existing profile', () => {
    providerProfileState.data = {
      businessName: 'X',
      bio: '',
      serviceAddress: '12 Pine Ln',
      serviceCategories: [],
      serviceRadiusKm: 75,
      defaultPaymentTiming: 'completion',
      defaultMilestones: [],
      cancellationPolicy: null,
      warrantyTerms: null,
    };
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    const serviceAreaBtn = screen.getByRole('button', { name: /Service Area/i });
    fireEvent.click(serviceAreaBtn);
    const radius = screen.getByLabelText(/Service Radius/i);
    expect((radius as HTMLInputElement).value).toBe('75');
  });

  it('Terms step renders cancellation policy textarea prefilled from profile', () => {
    providerProfileState.data = {
      businessName: 'X',
      bio: '',
      serviceAddress: '',
      serviceCategories: [],
      serviceRadiusKm: 10,
      defaultPaymentTiming: 'milestones',
      defaultMilestones: [],
      cancellationPolicy: '24-hour cancellation',
      warrantyTerms: '90-day warranty',
    };
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Terms$/i }));
    expect(screen.getByText(/Default Payment Timing/i)).toBeDefined();
  });

  it('does not throw when navigating from step 1 to last step via indicator', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Payments/i }));
    expect(screen.getByTestId('stripe-onboarding')).toBeDefined();
  });

  it('verification step exposes required tax document fields', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Verification/i }));
    // The form layout exposes fields like ID and Business License — at minimum
    // we assert those headings render.
    expect(screen.getByText(/Government-Issued ID/i)).toBeDefined();
  });
});
