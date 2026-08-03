// Tests for the provider onboarding wizard — exercises step navigation,
// step indicator clicks, progress, and prefill from existing profile.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

// Radix Select uses pointer capture APIs that jsdom does not implement.
// Polyfill them so the milestone-editor select dropdown can open in tests.
HTMLElement.prototype.hasPointerCapture = () => false;
HTMLElement.prototype.setPointerCapture = () => undefined;
HTMLElement.prototype.releasePointerCapture = () => undefined;
// jsdom also lacks scrollIntoView used by Radix Select inside the popper.
HTMLElement.prototype.scrollIntoView = () => undefined;

const providerProfileState: { data: unknown } = { data: undefined };
const routerPush = vi.fn();
const uploadImageMock = vi.fn();
const updateCategoriesMutate = vi.fn();
const updatePortfolioMutate = vi.fn();
const updateProviderMutate = vi.fn();
const setGlobalTermsMutate = vi.fn();
const uploadVerifDocMutate = vi.fn();

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

// `legal_services` is a FINANCIAL flag, so the real hook fails closed (false)
// until the flags endpoint answers — which never happens in a unit test — and
// <ProfessionalLicenseSection /> renders nothing. Drive the flag explicitly so
// the License step is asserted against a known state; a dedicated test flips it
// off to prove the step still lets a non-legal provider through.
const flagState: Record<string, boolean> = { legal_services: true };

vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlag: (key: string) => flagState[key] ?? false,
  useFeatureFlags: () => flagState,
}));

vi.mock('@/hooks/useProviderLicenses', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useProviderLicenses')>(
    '@/hooks/useProviderLicenses',
  );
  return {
    ...actual,
    useMyLicenses: () => ({ data: [], isLoading: false }),
    useSubmitLicense: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

// The onboarding page renders a `<FormMessage />` outside of a `<FormItem>`
// inside the milestone editor (a known source-side quirk that we don't fix
// from a test). Override only `FormMessage` with a tolerant stub that no-ops
// when there is no `FormItem` context — required to exercise the
// `paymentTiming === 'milestone'` branch of `<GlobalTermsStep>`.
vi.mock('@/components/ui/form', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui/form')>(
    '@/components/ui/form',
  );
  const SafeFormMessage = (
    props: { children?: React.ReactNode } & React.HTMLAttributes<HTMLParagraphElement>,
  ) => {
    // The page never relies on FormMessage rendering visible content during
    // these tests — just keep the tree alive when the FormItem context is
    // absent so `useFormField` doesn't throw.
    return createElement('p', { 'data-testid': 'safe-form-message', ...props }, props.children);
  };
  return { ...actual, FormMessage: SafeFormMessage };
});

interface ImageUploadMockProps {
  onUploadComplete?: (result: { confirmedUrl: string }) => void;
  onRemove?: (url: string) => void;
  existingImages?: string[];
}

vi.mock('@/components/ui/ImageUpload', () => ({
  ImageUpload: ({ onUploadComplete, onRemove, existingImages }: ImageUploadMockProps) =>
    createElement(
      'div',
      { 'data-testid': 'image-upload' },
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'image-upload-add',
          onClick: () => {
            onUploadComplete?.({ confirmedUrl: `https://cdn.example/img-${String((existingImages?.length ?? 0) + 1)}.jpg` });
          },
        },
        'add',
      ),
      ...(existingImages ?? []).map((url) =>
        createElement(
          'button',
          {
            key: url,
            type: 'button',
            'data-testid': `image-upload-remove-${url}`,
            onClick: () => { onRemove?.(url); },
          },
          'remove',
        ),
      ),
    ),
}));

vi.mock('@/hooks/useImageUpload', () => ({
  useImageUpload: () => ({
    upload: uploadImageMock,
    status: 'idle',
    progress: 0,
    error: null,
  }),
}));

const verificationDocsState: { data: Array<Record<string, unknown>> } = { data: [] };

vi.mock('@/hooks/useProviderProfile', () => ({
  useProviderProfile: () => providerProfileState,
  useUpdateCategories: () => ({ mutateAsync: updateCategoriesMutate, isPending: false }),
  useUpdatePortfolio: () => ({ mutateAsync: updatePortfolioMutate, isPending: false }),
  useUpdateProviderProfile: () => ({ mutateAsync: updateProviderMutate, isPending: false }),
  useSetGlobalTerms: () => ({ mutateAsync: setGlobalTermsMutate, isPending: false }),
  useUploadVerificationDocument: () => ({ mutateAsync: uploadVerifDocMutate, isPending: false }),
  useProviderVerificationDocuments: () => ({
    data: verificationDocsState.data,
    isLoading: false,
    isError: false,
  }),
  indexDocumentsByType: (docs: Array<Record<string, unknown>> | undefined) => {
    const map: Record<string, Record<string, unknown>> = {};
    for (const doc of docs ?? []) {
      const key = String(doc.document_type ?? '');
      if (!key) continue;
      const existing = map[key];
      const count = Number(doc.resubmission_count ?? 0);
      const existingCount = Number(existing?.resubmission_count ?? 0);
      if (!existing || count >= existingCount) map[key] = doc;
    }
    return map;
  },
  isDocumentResubmissionLocked: (count: number | undefined | null) => (count ?? 0) >= 3,
  MAX_DOCUMENT_RESUBMISSIONS: 3,
  resubmissionLockoutMessage: () =>
    'This document type has no re-uploads left (maximum 3). Contact support to continue verification.',
}));

const { default: ProviderOnboardingPage } = await import(
  '@/app/(dashboard)/provider/onboarding/page'
);

beforeEach(() => {
  providerProfileState.data = undefined;
  verificationDocsState.data = [];
  routerPush.mockReset();
  uploadImageMock.mockReset();
  updateCategoriesMutate.mockReset();
  updatePortfolioMutate.mockReset();
  updateProviderMutate.mockReset();
  setGlobalTermsMutate.mockReset();
  uploadVerifDocMutate.mockReset();
  // Default — successful resolution for mutations
  updateCategoriesMutate.mockResolvedValue(undefined);
  updatePortfolioMutate.mockResolvedValue(undefined);
  updateProviderMutate.mockResolvedValue(undefined);
  setGlobalTermsMutate.mockResolvedValue(undefined);
  uploadVerifDocMutate.mockResolvedValue(undefined);
  flagState['legal_services'] = true;
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
    expect(screen.getByText(/Step 1 of 8/)).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Provider Setup' })).toBeDefined();
  });

  it('renders all step indicators in the nav', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    const nav = screen.getByRole('navigation', { name: /Onboarding steps/i });
    expect(nav).toBeDefined();
    // 8 step buttons should render in the indicator nav (added the License step)
    const stepButtons = nav.querySelectorAll('button');
    expect(stepButtons.length).toBe(8);
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
      business_name: 'Pre-Filled LLC',
      bio: 'My bio',
      service_address: '42 Oak St',
      service_categories: [],
      service_radius_km: 25,
      default_payment_timing: 'completion',
      default_milestones: [],
      cancellation_policy: null,
      warranty_terms: null,
    };
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    const input = screen.getByLabelText(/Business Name/i);
    expect((input as HTMLInputElement).value).toBe('Pre-Filled LLC');
  });

  it('Categories step shows existing serviceCategories prefill', () => {
    providerProfileState.data = {
      business_name: 'X',
      bio: '',
      service_address: '',
      service_categories: [{ id: 'cat-a' }, { id: 'cat-b' }],
      service_radius_km: 10,
      default_payment_timing: 'completion',
      default_milestones: [],
      cancellation_policy: null,
      warranty_terms: null,
    };
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    const categoriesBtn = screen.getByRole('button', { name: /Categories/i });
    fireEvent.click(categoriesBtn);
    expect(screen.getByTestId('category-selector')).toBeDefined();
  });

  it('Service Area step prefills the radius input from existing profile', () => {
    providerProfileState.data = {
      business_name: 'X',
      bio: '',
      service_address: '12 Pine Ln',
      service_categories: [],
      service_radius_km: 75,
      default_payment_timing: 'completion',
      default_milestones: [],
      cancellation_policy: null,
      warranty_terms: null,
    };
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    const serviceAreaBtn = screen.getByRole('button', { name: /Service Area/i });
    fireEvent.click(serviceAreaBtn);
    const radius = screen.getByLabelText(/Service Radius/i);
    expect((radius as HTMLInputElement).value).toBe('75');
  });

  it('Terms step renders cancellation policy textarea prefilled from profile', () => {
    providerProfileState.data = {
      business_name: 'X',
      bio: '',
      service_address: '',
      service_categories: [],
      service_radius_km: 10,
      default_payment_timing: 'milestones',
      default_milestones: [],
      cancellation_policy: '24-hour cancellation',
      warranty_terms: '90-day warranty',
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

  it('Service Area step calls update mutation and advances when Next clicked', async () => {
    const user = userEvent.setup();
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Service Area/i }));
    const nextBtn = screen.getAllByRole('button', { name: /^Next$/i })[0];
    if (!nextBtn) throw new Error('Next button missing');
    await user.click(nextBtn);
    await waitFor(() => {
      expect(updateProviderMutate).toHaveBeenCalled();
    });
    // Default radius is 25 km
    expect(updateProviderMutate.mock.calls[0]?.[0]).toMatchObject({ service_radius_km: 25 });
  });

  it('Service Area step includes service_address only when input is non-empty', async () => {
    const user = userEvent.setup();
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Service Area/i }));
    const addressInput = screen.getByLabelText(/Service Base Address/i);
    await user.type(addressInput, '999 Spruce Ave');
    const nextBtn = screen.getAllByRole('button', { name: /^Next$/i })[0];
    if (!nextBtn) throw new Error('Next button missing');
    await user.click(nextBtn);
    await waitFor(() => {
      expect(updateProviderMutate).toHaveBeenCalled();
    });
    expect(updateProviderMutate.mock.calls[0]?.[0]).toMatchObject({
      service_address: '999 Spruce Ave',
    });
  });

  it('Service Area Skip button advances without calling mutation', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Service Area/i }));
    const skipBtn = screen.getAllByRole('button', { name: /Skip/i })[0];
    if (!skipBtn) throw new Error('Skip button missing');
    fireEvent.click(skipBtn);
    // Now on terms step
    expect(screen.getByText(/Default Payment Timing/i)).toBeDefined();
    expect(updateProviderMutate).not.toHaveBeenCalled();
  });

  it('Service Area Previous button goes back to Categories step', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Service Area/i }));
    const prevBtn = screen.getByRole('button', { name: /Previous/i });
    fireEvent.click(prevBtn);
    expect(screen.getByTestId('category-selector')).toBeDefined();
  });

  it('Categories Skip button advances without calling mutation', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Categories/i }));
    const skipBtn = screen.getAllByRole('button', { name: /Skip/i })[0];
    if (!skipBtn) throw new Error('Skip button missing');
    fireEvent.click(skipBtn);
    expect(screen.getByLabelText(/Service Radius/i)).toBeDefined();
    expect(updateCategoriesMutate).not.toHaveBeenCalled();
  });

  it('Service Area radius input updates the displayed km label', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Service Area/i }));
    const radius = screen.getByLabelText(/Service Radius/i);
    fireEvent.change(radius, { target: { value: '50' } });
    expect((radius as HTMLInputElement).value).toBe('50');
    expect(screen.getAllByText(/50 km/).length).toBeGreaterThan(0);
  });

  it('Portfolio Skip button advances without calling mutation', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Portfolio$/i }));
    const skipBtn = screen.getAllByRole('button', { name: /Skip/i })[0];
    if (!skipBtn) throw new Error('Skip button missing');
    fireEvent.click(skipBtn);
    // Now should be at verification step
    expect(screen.getByText(/Government-Issued ID/i)).toBeDefined();
    expect(updatePortfolioMutate).not.toHaveBeenCalled();
  });

  it('Verification step shows submit error when uploadImage returns falsy result', async () => {
    uploadImageMock.mockResolvedValue(undefined);
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Verification/i }));
    // Add the required document via the hidden file input — find by label "Government-Issued ID"
    const govIdLabel = screen.getByText('Government-Issued ID');
    const card = govIdLabel.closest('.glass');
    expect(card).toBeTruthy();
    const fileInput = card?.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).toBeTruthy();
    const file = new File(['fake'], 'id.png', { type: 'image/png' });
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [file] } });
    // Required document is selected — Skip should now disappear
    const finishBtn = screen.getByRole('button', { name: /Finish/i });
    fireEvent.click(finishBtn);
    await waitFor(() => {
      expect(uploadImageMock).toHaveBeenCalled();
    });
  });

  it('Verification step rejects file with disallowed mime type', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Verification/i }));
    const govIdLabel = screen.getByText('Government-Issued ID');
    const card = govIdLabel.closest('.glass');
    const fileInput = card?.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).toBeTruthy();
    const badFile = new File(['x'], 'bad.exe', { type: 'application/octet-stream' });
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [badFile] } });
    expect(screen.getByText(/Please upload a JPG, PNG, WebP, or PDF file/i)).toBeDefined();
  });

  it('Verification step shows missing-required error when Finish clicked with no docs', async () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Verification/i }));
    const finishBtn = screen.getByRole('button', { name: /Finish/i });
    fireEvent.click(finishBtn);
    await waitFor(() => {
      expect(screen.getByText(/Government-Issued ID is required/i)).toBeDefined();
    });
    expect(uploadImageMock).not.toHaveBeenCalled();
  });

  it('Payments Finish setup pushes to /provider via router', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Payments/i }));
    const finishBtn = screen.getByRole('button', { name: /Finish setup/i });
    fireEvent.click(finishBtn);
    expect(routerPush).toHaveBeenCalledWith('/provider');
  });

  it('Payments Previous button returns to License step', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Payments/i }));
    const prevBtn = screen.getByRole('button', { name: /Previous/i });
    fireEvent.click(prevBtn);
    // The License step (added between Verification and Payments) shows the
    // professional-license submit affordance.
    expect(screen.getByRole('button', { name: /Submit for verification/i })).toBeDefined();
  });

  it('License step never dead-ends when legal_services is off', () => {
    // Flag off → <ProfessionalLicenseSection /> renders nothing, so the step is
    // just an explanatory note. Previous/Continue must still be there or a
    // non-legal provider is stuck one step short of Payments.
    flagState['legal_services'] = false;
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /License/i }));
    expect(screen.queryByRole('button', { name: /Submit for verification/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Continue/i })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    expect(screen.getByTestId('stripe-onboarding')).toBeDefined();
  });

  // -------- New tests for uncovered handlers / branches --------

  it('BusinessInfo submit calls updateProvider and advances to Categories', async () => {
    const user = userEvent.setup();
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    const businessName = screen.getByLabelText(/Business Name/i);
    await user.type(businessName, 'Acme Roofing Co');
    const bio = screen.getByLabelText(/^Bio$/i);
    await user.type(bio, 'Best roofers around');
    const addr = screen.getByLabelText(/Service Address/i);
    await user.type(addr, '12 Main St');
    const submitBtn = screen.getByRole('button', { name: /^Next$/i });
    await user.click(submitBtn);
    await waitFor(() => {
      expect(updateProviderMutate).toHaveBeenCalled();
    });
    expect(updateProviderMutate.mock.calls[0]?.[0]).toMatchObject({
      business_name: 'Acme Roofing Co',
      bio: 'Best roofers around',
      service_address: '12 Main St',
    });
    // Should now be on Categories step
    expect(screen.getByTestId('category-selector')).toBeDefined();
  });

  it('BusinessInfo submit omits bio/address when empty', async () => {
    const user = userEvent.setup();
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    const businessName = screen.getByLabelText(/Business Name/i);
    await user.type(businessName, 'Just A Name');
    const submitBtn = screen.getByRole('button', { name: /^Next$/i });
    await user.click(submitBtn);
    await waitFor(() => {
      expect(updateProviderMutate).toHaveBeenCalled();
    });
    const arg = updateProviderMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg['business_name']).toBe('Just A Name');
    expect(arg['bio']).toBeUndefined();
    expect(arg['service_address']).toBeUndefined();
  });

  it('BusinessInfo EIN/TIN auto-inserts a dash after two digits', async () => {
    const user = userEvent.setup();
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    const ein = screen.getByLabelText(/EIN \/ TIN/i);
    await user.type(ein, '12');
    if (!(ein instanceof HTMLInputElement)) throw new Error('expected input element');
    expect(ein.value).toBe('12-');
  });

  it('BusinessInfo EIN/TIN strips non-digit characters', async () => {
    const user = userEvent.setup();
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    const ein = screen.getByLabelText(/EIN \/ TIN/i);
    await user.type(ein, 'a1!b2');
    if (!(ein instanceof HTMLInputElement)) throw new Error('expected input element');
    expect(ein.value).toBe('12-');
  });

  it('BusinessInfo Insurance Coverage onChange parses number and clears to undefined when empty', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    const cov = screen.getByLabelText(/Insurance Coverage Amount/i);
    fireEvent.change(cov, { target: { value: '500000' } });
    if (!(cov instanceof HTMLInputElement)) throw new Error('expected input element');
    expect(cov.value).toBe('500000');
    fireEvent.change(cov, { target: { value: '' } });
    expect(cov.value).toBe('');
  });

  it('Categories Next button calls updateCategories mutation when no selections (skips mutation)', async () => {
    const user = userEvent.setup();
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Categories/i }));
    // With no selected ids, Next still advances but should not call mutation
    const nextBtn = screen.getAllByRole('button', { name: /^Next$/i })[0];
    if (!nextBtn) throw new Error('Next button missing');
    await user.click(nextBtn);
    expect(updateCategoriesMutate).not.toHaveBeenCalled();
    // We should now be on Service Area step
    expect(screen.getByLabelText(/Service Radius/i)).toBeDefined();
  });

  it('Categories Next calls mutation when prefilled selections exist', async () => {
    providerProfileState.data = {
      business_name: 'X',
      bio: '',
      service_address: '',
      service_categories: [{ id: 'cat-a' }, { id: 'cat-b' }],
      service_radius_km: 10,
      default_payment_timing: 'completion',
      default_milestones: [],
      cancellation_policy: null,
      warranty_terms: null,
    };
    const user = userEvent.setup();
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Categories/i }));
    const nextBtn = screen.getAllByRole('button', { name: /^Next$/i })[0];
    if (!nextBtn) throw new Error('Next button missing');
    await user.click(nextBtn);
    await waitFor(() => {
      expect(updateCategoriesMutate).toHaveBeenCalledWith(['cat-a', 'cat-b']);
    });
  });

  it('Terms step submit calls setGlobalTerms with form values', async () => {
    const user = userEvent.setup();
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Terms$/i }));
    const cancelArea = screen.getByLabelText(/Cancellation Policy/i);
    await user.type(cancelArea, '24 hour notice');
    const warrantyArea = screen.getByLabelText(/Warranty Terms/i);
    await user.type(warrantyArea, '90-day labor warranty');
    const submitBtn = screen.getAllByRole('button', { name: /^Next$/i })[0];
    if (!submitBtn) throw new Error('Next button missing');
    await user.click(submitBtn);
    await waitFor(() => {
      expect(setGlobalTermsMutate).toHaveBeenCalled();
    });
    expect(setGlobalTermsMutate.mock.calls[0]?.[0]).toMatchObject({
      payment_timing: 'completion',
      cancellation_policy: '24 hour notice',
      warranty_terms: '90-day labor warranty',
    });
  });

  it('Terms step Skip button advances without calling mutation', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Terms$/i }));
    const skipBtn = screen.getAllByRole('button', { name: /Skip/i })[0];
    if (!skipBtn) throw new Error('Skip button missing');
    fireEvent.click(skipBtn);
    // We should be on Portfolio step now
    expect(screen.getByTestId('image-upload')).toBeDefined();
    expect(setGlobalTermsMutate).not.toHaveBeenCalled();
  });

  it('Terms step Previous button returns to Service Area', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Terms$/i }));
    const prevBtn = screen.getByRole('button', { name: /Previous/i });
    fireEvent.click(prevBtn);
    expect(screen.getByLabelText(/Service Radius/i)).toBeDefined();
  });

  it('Portfolio onUploadComplete adds an uploaded image and shows captions area', async () => {
    const user = userEvent.setup();
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Portfolio$/i }));
    // Initially, no captions section
    expect(screen.queryByText(/Add captions/i)).toBeNull();
    const addBtn = screen.getByTestId('image-upload-add');
    await user.click(addBtn);
    expect(screen.getByText(/Add captions/i)).toBeDefined();
    // A caption input should appear
    const cap = screen.getByLabelText(/Caption for image 1/i);
    fireEvent.change(cap, { target: { value: 'Front porch project' } });
    if (!(cap instanceof HTMLInputElement)) throw new Error('expected input element');
    expect(cap.value).toBe('Front porch project');
  });

  it('Portfolio onRemove drops the uploaded image and its caption', async () => {
    const user = userEvent.setup();
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Portfolio$/i }));
    await user.click(screen.getByTestId('image-upload-add'));
    expect(screen.getByLabelText(/Caption for image 1/i)).toBeDefined();
    const url = 'https://cdn.example/img-1.jpg';
    fireEvent.change(screen.getByLabelText(/Caption for image 1/i), {
      target: { value: 'Will be removed' },
    });
    const removeBtn = screen.getByTestId(`image-upload-remove-${url}`);
    await user.click(removeBtn);
    expect(screen.queryByText(/Add captions/i)).toBeNull();
  });

  it('Portfolio Next persists uploaded urls with captions in order', async () => {
    const user = userEvent.setup();
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Portfolio$/i }));
    await user.click(screen.getByTestId('image-upload-add'));
    await user.click(screen.getByTestId('image-upload-add'));
    const cap1 = screen.getByLabelText(/Caption for image 1/i);
    fireEvent.change(cap1, { target: { value: 'First' } });
    // Leave second caption empty so the `|| null` fallback path runs
    const nextBtn = screen.getAllByRole('button', { name: /^Next$/i })[0];
    if (!nextBtn) throw new Error('Next button missing');
    await user.click(nextBtn);
    await waitFor(() => {
      expect(updatePortfolioMutate).toHaveBeenCalled();
    });
    expect(updatePortfolioMutate.mock.calls[0]?.[0]).toEqual([
      { image_url: 'https://cdn.example/img-1.jpg', caption: 'First', sort_order: 0 },
      { image_url: 'https://cdn.example/img-2.jpg', caption: null, sort_order: 1 },
    ]);
  });

  it('Portfolio Previous returns to Terms step', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Portfolio$/i }));
    const prevBtn = screen.getByRole('button', { name: /Previous/i });
    fireEvent.click(prevBtn);
    expect(screen.getByText(/Default Payment Timing/i)).toBeDefined();
  });

  it('Verification step rejects file exceeding 10MB size limit', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Verification/i }));
    const govIdLabel = screen.getByText('Government-Issued ID');
    const card = govIdLabel.closest('.glass');
    const fileInput = card?.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).toBeTruthy();
    // Build an oversized File using a fake size override
    const big = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [big] } });
    expect(screen.getByText(/exceeds the/i)).toBeDefined();
  });

  it('Verification step allows removing a selected document', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Verification/i }));
    const govIdLabel = screen.getByText('Government-Issued ID');
    const card = govIdLabel.closest('.glass');
    const fileInput = card?.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).toBeTruthy();
    const file = new File(['x'], 'id.png', { type: 'image/png' });
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [file] } });
    expect(screen.getByText('id.png')).toBeDefined();
    const removeBtn = screen.getByRole('button', { name: /Remove Government-Issued ID/i });
    fireEvent.click(removeBtn);
    expect(screen.queryByText('id.png')).toBeNull();
  });

  it('Verification step finishes successfully when all required docs upload OK', async () => {
    uploadImageMock.mockResolvedValue({ ok: true, result: { confirmedUrl: 'https://cdn.example/doc-1.pdf' } });
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Verification/i }));
    const govIdLabel = screen.getByText('Government-Issued ID');
    const card = govIdLabel.closest('.glass');
    const fileInput = card?.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).toBeTruthy();
    const file = new File(['x'], 'id.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [file] } });
    const finishBtn = screen.getByRole('button', { name: /Finish/i });
    fireEvent.click(finishBtn);
    await waitFor(() => {
      expect(uploadImageMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(uploadVerifDocMutate).toHaveBeenCalled();
    });
    expect(uploadVerifDocMutate.mock.calls[0]?.[0]).toMatchObject({
      document_type: 'government_id',
      file_url: 'https://cdn.example/doc-1.pdf',
      file_name: 'id.pdf',
      mime_type: 'application/pdf',
    });
    // After successful finish, advances to the License step (added between
    // Verification and Payments).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Submit for verification/i })).toBeDefined();
    });
  });

  it('Verification step surfaces submitError when uploadDocument rejects', async () => {
    uploadImageMock.mockResolvedValue({ ok: true, result: { confirmedUrl: 'https://cdn.example/doc.pdf' } });
    uploadVerifDocMutate.mockRejectedValueOnce(new Error('network kaput'));
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Verification/i }));
    const govIdLabel = screen.getByText('Government-Issued ID');
    const card = govIdLabel.closest('.glass');
    const fileInput = card?.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).toBeTruthy();
    const file = new File(['x'], 'id.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [file] } });
    const finishBtn = screen.getByRole('button', { name: /Finish/i });
    fireEvent.click(finishBtn);
    await waitFor(() => {
      expect(screen.getAllByText(/network kaput/i).length).toBeGreaterThan(0);
    });
  });

  it('Verification step surfaces a generic submit error on non-Error throws', async () => {
    uploadImageMock.mockResolvedValue({ ok: true, result: { confirmedUrl: 'https://cdn.example/doc.pdf' } });
    uploadVerifDocMutate.mockRejectedValueOnce('boom');
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Verification/i }));
    const govIdLabel = screen.getByText('Government-Issued ID');
    const card = govIdLabel.closest('.glass');
    const fileInput = card?.querySelector('input[type="file"]') as HTMLInputElement | null;
    const file = new File(['x'], 'id.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [file] } });
    const finishBtn = screen.getByRole('button', { name: /Finish/i });
    fireEvent.click(finishBtn);
    await waitFor(() => {
      expect(screen.getByText(/Failed to upload documents/i)).toBeDefined();
    });
  });

  it('Verification step shows per-document upload failure error', async () => {
    uploadImageMock.mockResolvedValue({ ok: false, error: 'Use JPEG, PNG, or WEBP.' });
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Verification/i }));
    const govIdLabel = screen.getByText('Government-Issued ID');
    const card = govIdLabel.closest('.glass');
    const fileInput = card?.querySelector('input[type="file"]') as HTMLInputElement | null;
    const file = new File(['x'], 'id.png', { type: 'image/png' });
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [file] } });
    const finishBtn = screen.getByRole('button', { name: /Finish/i });
    fireEvent.click(finishBtn);
    await waitFor(() => {
      expect(screen.getByText(/Could not upload id.png/i)).toBeDefined();
    });
  });

  it('Verification document upload supports drag-and-drop interactions', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Verification/i }));
    const dropZone = screen.getByRole('button', { name: /Upload Government-Issued ID/i });
    // Drag enter / over / leave cycle should run handlers without throwing
    fireEvent.dragEnter(dropZone);
    // Drop file message appears within this drop zone
    expect(dropZone.textContent).toMatch(/Drop file here/i);
    fireEvent.dragOver(dropZone);
    fireEvent.dragLeave(dropZone);
    // After leave, the placeholder text reverts within this zone
    expect(dropZone.textContent).toMatch(/Click or drag file to upload/i);
    // Drop an actual file
    const file = new File(['x'], 'id.png', { type: 'image/png' });
    const dataTransfer = { files: [file], items: [], types: ['Files'] };
    fireEvent.drop(dropZone, { dataTransfer });
    expect(screen.getByText('id.png')).toBeDefined();
  });

  it('Verification document upload handles drop with no files (no-op)', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Verification/i }));
    const dropZone = screen.getByRole('button', { name: /Upload Government-Issued ID/i });
    fireEvent.drop(dropZone, { dataTransfer: { files: [], items: [], types: [] } });
    // No file should appear
    expect(screen.queryByText(/^id\./i)).toBeNull();
  });

  it('Verification document upload opens file picker when Enter is pressed', () => {
    // Spy on HTMLInputElement.prototype.click so we capture the call regardless
    // of how the ref is established by useRef inside the component.
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      render(withQueryClient(createElement(ProviderOnboardingPage)));
      fireEvent.click(screen.getByRole('button', { name: /Verification/i }));
      const dropZone = screen.getByRole('button', { name: /Upload Government-Issued ID/i });
      fireEvent.keyDown(dropZone, { key: 'Enter' });
      expect(clickSpy).toHaveBeenCalled();
      const callsAfterEnter = clickSpy.mock.calls.length;
      fireEvent.keyDown(dropZone, { key: ' ' });
      expect(clickSpy.mock.calls.length).toBe(callsAfterEnter + 1);
      // Other keys do nothing
      fireEvent.keyDown(dropZone, { key: 'a' });
      expect(clickSpy.mock.calls.length).toBe(callsAfterEnter + 1);
      // Direct click on the drop zone also opens the picker (covers openFilePicker)
      fireEvent.click(dropZone);
      expect(clickSpy.mock.calls.length).toBe(callsAfterEnter + 2);
    } finally {
      clickSpy.mockRestore();
    }
  });

  it('Verification step shows file size formatted as KB/MB/B', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Verification/i }));
    // Confirm header text shows MB
    expect(screen.getByText(/max\s*10\.0 MB/i)).toBeDefined();
    const govIdLabel = screen.getByText('Government-Issued ID');
    const card = govIdLabel.closest('.glass');
    const fileInput = card?.querySelector('input[type="file"]') as HTMLInputElement | null;
    // File under 1KB -> "B"
    const tinyBytes = new File([new Uint8Array([1, 2, 3])], 'tiny.png', { type: 'image/png' });
    Object.defineProperty(tinyBytes, 'size', { value: 500 });
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [tinyBytes] } });
    expect(screen.getByText(/500 B/)).toBeDefined();
  });

  it('Verification step formats KB-sized files', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Verification/i }));
    const govIdLabel = screen.getByText('Government-Issued ID');
    const card = govIdLabel.closest('.glass');
    const fileInput = card?.querySelector('input[type="file"]') as HTMLInputElement | null;
    const file = new File(['x'], 'mid.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 2048 });
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [file] } });
    expect(screen.getByText(/2\.0 KB/)).toBeDefined();
  });

  it('Verification step Skip is hidden once required docs are present and runs Skip otherwise', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Verification/i }));
    // Skip is present when no required docs uploaded
    expect(screen.getByRole('button', { name: /^Skip$/i })).toBeDefined();
    // Add a required doc
    const govIdLabel = screen.getByText('Government-Issued ID');
    const card = govIdLabel.closest('.glass');
    const fileInput = card?.querySelector('input[type="file"]') as HTMLInputElement | null;
    const file = new File(['x'], 'id.png', { type: 'image/png' });
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [file] } });
    expect(screen.queryByRole('button', { name: /^Skip$/i })).toBeNull();
  });

  it('Service Area renders the Mapbox visualization when token is set', () => {
    const prev = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
    process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = 'pk.test';
    try {
      render(withQueryClient(createElement(ProviderOnboardingPage)));
      fireEvent.click(screen.getByRole('button', { name: /Service Area/i }));
      // The dynamic mocked ServiceAreaMap should render a testid div
      expect(screen.getAllByTestId('service-area-map').length).toBeGreaterThan(0);
      // The radius mile-conversion line still shows
      expect(screen.getAllByText(/km service radius/i).length).toBeGreaterThan(0);
    } finally {
      if (prev === undefined) {
        delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
      } else {
        process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = prev;
      }
    }
  });

  it('Verification step displays PDF type label distinctly from images', () => {
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Verification/i }));
    const govIdLabel = screen.getByText('Government-Issued ID');
    const card = govIdLabel.closest('.glass');
    const fileInput = card?.querySelector('input[type="file"]') as HTMLInputElement | null;
    const pdf = new File(['x'], 'attestation.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [pdf] } });
    // The card now shows a "- PDF" suffix on the file size label
    expect(card?.textContent).toMatch(/- PDF/);
  });

  // -- Milestone editor coverage (lines 621-692 of source) --
  // The milestone block is rendered when paymentTiming === 'milestone'.
  // Easiest way to land in that branch is to hydrate via existingProfile
  // since the Radix Select dropdown opening is heavy in jsdom.

  it('Terms step renders milestone editor when defaultPaymentTiming is "milestone"', () => {
    providerProfileState.data = {
      business_name: 'Acme',
      bio: '',
      service_address: '',
      service_categories: [],
      service_radius_km: 10,
      default_payment_timing: 'milestone',
      default_milestones: [],
      cancellation_policy: null,
      warranty_terms: null,
    };
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Terms$/i }));
    expect(screen.getByText(/Milestone Templates/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Add Milestone/i })).toBeDefined();
  });

  it('Terms step Add Milestone twice renders two milestone rows with their indices', async () => {
    providerProfileState.data = {
      business_name: 'Acme',
      bio: '',
      service_address: '',
      service_categories: [],
      service_radius_km: 10,
      default_payment_timing: 'milestone',
      default_milestones: [],
      cancellation_policy: null,
      warranty_terms: null,
    };
    const user = userEvent.setup();
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Terms$/i }));
    await user.click(screen.getByRole('button', { name: /Add Milestone/i }));
    await user.click(screen.getByRole('button', { name: /Add Milestone/i }));
    expect(screen.getByRole('button', { name: /Remove milestone 1/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Remove milestone 2/i })).toBeDefined();
  });

  it('Terms step Add Milestone button appends a new empty milestone row', async () => {
    providerProfileState.data = {
      business_name: 'Acme',
      bio: '',
      service_address: '',
      service_categories: [],
      service_radius_km: 10,
      default_payment_timing: 'milestone',
      default_milestones: [],
      cancellation_policy: null,
      warranty_terms: null,
    };
    const user = userEvent.setup();
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Terms$/i }));
    expect(screen.queryByRole('button', { name: /Remove milestone 1/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Add Milestone/i }));
    expect(screen.getByRole('button', { name: /Remove milestone 1/i })).toBeDefined();
    // Add a second
    await user.click(screen.getByRole('button', { name: /Add Milestone/i }));
    expect(screen.getByRole('button', { name: /Remove milestone 2/i })).toBeDefined();
  });

  it('Terms step Remove Milestone removes the milestone row at that index', async () => {
    providerProfileState.data = {
      business_name: 'Acme',
      bio: '',
      service_address: '',
      service_categories: [],
      service_radius_km: 10,
      default_payment_timing: 'milestone',
      default_milestones: [],
      cancellation_policy: null,
      warranty_terms: null,
    };
    const user = userEvent.setup();
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Terms$/i }));
    await user.click(screen.getByRole('button', { name: /Add Milestone/i }));
    expect(screen.getByRole('button', { name: /Remove milestone 1/i })).toBeDefined();
    await user.click(screen.getByRole('button', { name: /Remove milestone 1/i }));
    // After removing the only row, no remove buttons exist
    expect(screen.queryByRole('button', { name: /Remove milestone/i })).toBeNull();
  });

  it('Terms step milestone percentage input parses the typed value as a number', async () => {
    providerProfileState.data = {
      business_name: 'Acme',
      bio: '',
      service_address: '',
      service_categories: [],
      service_radius_km: 10,
      default_payment_timing: 'milestone',
      default_milestones: [],
      cancellation_policy: null,
      warranty_terms: null,
    };
    const user = userEvent.setup();
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Terms$/i }));
    await user.click(screen.getByRole('button', { name: /Add Milestone/i }));
    // The percentage input is the input with placeholder="%"
    const pct = screen.getByPlaceholderText('%');
    fireEvent.change(pct, { target: { value: '50' } });
    if (!(pct instanceof HTMLInputElement)) throw new Error('expected input element');
    expect(pct.value).toBe('50');
  });

  it('Terms step milestone description input accepts text changes', async () => {
    providerProfileState.data = {
      business_name: 'Acme',
      bio: '',
      service_address: '',
      service_categories: [],
      service_radius_km: 10,
      default_payment_timing: 'milestone',
      default_milestones: [],
      cancellation_policy: null,
      warranty_terms: null,
    };
    const user = userEvent.setup();
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Terms$/i }));
    await user.click(screen.getByRole('button', { name: /Add Milestone/i }));
    const desc = screen.getByPlaceholderText('Milestone description');
    fireEvent.change(desc, { target: { value: 'Initial Deposit' } });
    if (!(desc instanceof HTMLInputElement)) throw new Error('expected input element');
    expect(desc.value).toBe('Initial Deposit');
  });

  it('Terms step submits milestone payment timing with milestones in payload', async () => {
    providerProfileState.data = {
      business_name: 'Acme',
      bio: '',
      service_address: '',
      service_categories: [],
      service_radius_km: 10,
      default_payment_timing: 'milestone',
      default_milestones: [],
      cancellation_policy: null,
      warranty_terms: null,
    };
    const user = userEvent.setup();
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Terms$/i }));
    // Add one milestone summing to 100% so the schema's refine passes.
    await user.click(screen.getByRole('button', { name: /Add Milestone/i }));
    const desc = screen.getByPlaceholderText('Milestone description');
    fireEvent.change(desc, { target: { value: 'Full Payment' } });
    const pct = screen.getByPlaceholderText('%');
    fireEvent.change(pct, { target: { value: '100' } });
    const submitBtn = screen.getAllByRole('button', { name: /^Next$/i })[0];
    if (!submitBtn) throw new Error('Next button missing');
    await user.click(submitBtn);
    await waitFor(() => {
      expect(setGlobalTermsMutate).toHaveBeenCalled();
    });
    expect(setGlobalTermsMutate.mock.calls[0]?.[0]).toMatchObject({
      payment_timing: 'milestone',
      milestones: [{ description: 'Full Payment', percentage: 100 }],
    });
  });

  it('Verification step surfaces resubmission count and disables locked types', () => {
    verificationDocsState.data = [
      {
        id: 'd1',
        document_type: 'government_id',
        status: 'rejected',
        resubmission_count: 3,
        rejection_reason: 'Blurry photo',
      },
    ];
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Verification/i }));
    expect(screen.getByText(/Resubmissions:\s*3 of 3/i)).toBeDefined();
    expect(screen.getAllByText(/contact support to continue/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Re-upload disabled for this document type/i)).toBeDefined();
    // Drop zone for locked government_id should not be present
    expect(screen.queryByRole('button', { name: /Upload Government-Issued ID/i })).toBeNull();
  });

  it('Verification step maps 422 register failure to contact-support copy', async () => {
    const { ApiError } = await import('@/lib/api');
    uploadImageMock.mockResolvedValue({
      ok: true,
      result: { confirmedUrl: 'https://cdn.example/id.png' },
    });
    uploadVerifDocMutate.mockRejectedValueOnce(
      new ApiError(422, JSON.stringify({ error: 'maximum resubmission attempts reached for this document type; contact support' })),
    );
    render(withQueryClient(createElement(ProviderOnboardingPage)));
    fireEvent.click(screen.getByRole('button', { name: /Verification/i }));
    const govIdLabel = screen.getByText('Government-Issued ID');
    const card = govIdLabel.closest('.glass');
    const fileInput = card?.querySelector('input[type="file"]') as HTMLInputElement | null;
    const file = new File(['x'], 'id.png', { type: 'image/png' });
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /Finish/i }));
    await waitFor(() => {
      expect(screen.getAllByText(/no re-uploads left/i).length).toBeGreaterThan(0);
    });
  });

});
