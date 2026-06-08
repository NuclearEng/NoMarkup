// Unit tests for the LEGAL services vertical frontend:
//   - ProfessionalLicenseSection submits a bar license with the right payload
//     and shows existing license status.
//   - VerifiedBarBadge renders only for a verified bar license.
//   - Both surfaces are gated behind the `legal_services` flag (hidden when OFF).
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeatureFlagKey } from '@/hooks/useFeatureFlags';
import type {
  ProviderLicense,
  PublicProviderLicense,
} from '@/hooks/useProviderLicenses';

// --- Feature flag mock (tests mutate per-case) ---
let flagState: Partial<Record<FeatureFlagKey, boolean>> = {};
vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => flagState,
  useFeatureFlag: (key: FeatureFlagKey) => flagState[key] ?? true,
}));

// --- API mock: ProfessionalLicenseSection's submit uses the real
//     useSubmitLicense hook, which calls api.post. The data-fetching hooks
//     (useMyLicenses / useProviderLicenses) are mocked below so we control the
//     rendered state directly. ---
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { post: apiPost, get: vi.fn(), getPublic: vi.fn() },
  // Minimal ApiError stand-in so the hook's instanceof checks don't explode.
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, body: string) {
      super(body);
      this.status = status;
    }
    userMessage(fallback: string) {
      return this.message || fallback;
    }
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Data hooks — partially mock so the real submit mutation + helpers stay real.
let myLicenses: ProviderLicense[] = [];
let publicLicenses: PublicProviderLicense[] = [];
vi.mock('@/hooks/useProviderLicenses', async () => {
  const actual =
    await vi.importActual<typeof import('@/hooks/useProviderLicenses')>(
      '@/hooks/useProviderLicenses',
    );
  return {
    ...actual,
    useMyLicenses: () => ({ data: myLicenses, isLoading: false }),
    useProviderLicenses: () => ({ data: publicLicenses, isLoading: false }),
  };
});

const { ProfessionalLicenseSection } = await import(
  '@/components/providers/ProfessionalLicenseSection'
);
const { VerifiedBarBadge } = await import('@/components/providers/VerifiedBarBadge');

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client }, ui));
}

// Radix Select relies on browser APIs jsdom doesn't implement. Stub them so the
// jurisdiction dropdown is operable in the submit test.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
  Element.prototype.scrollIntoView = function scrollIntoView() {
    /* noop in jsdom */
  };
  Element.prototype.hasPointerCapture = function hasPointerCapture() {
    return false;
  };
});

beforeEach(() => {
  flagState = {};
  myLicenses = [];
  publicLicenses = [];
  apiPost.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProfessionalLicenseSection — submit', () => {
  it('submits a bar license with license_type=bar, number, and jurisdiction', async () => {
    flagState = { legal_services: true };
    apiPost.mockResolvedValueOnce({
      id: 'lic-1',
      license_type: 'bar',
      license_number: '1234567',
      jurisdiction: 'California',
      status: 'pending',
    });

    const user = userEvent.setup();
    renderWithClient(createElement(ProfessionalLicenseSection));

    // Pick jurisdiction via the shadcn Select (combobox role).
    await user.click(screen.getByRole('combobox', { name: /issuing jurisdiction/i }));
    await user.click(await screen.findByRole('option', { name: 'California' }));

    await user.type(
      screen.getByRole('textbox', { name: /bar license number/i }),
      '1234567',
    );
    await user.click(screen.getByRole('button', { name: /submit for verification/i }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/v1/providers/me/licenses', {
        license_type: 'bar',
        license_number: '1234567',
        jurisdiction: 'California',
      });
    });
  });

  it('shows the verification status of an existing pending license', () => {
    flagState = { legal_services: true };
    myLicenses = [
      {
        id: 'lic-9',
        license_type: 'bar',
        license_number: '9988776',
        jurisdiction: 'New York',
        status: 'pending',
      },
    ];
    renderWithClient(createElement(ProfessionalLicenseSection));
    expect(screen.getByText(/New York Bar/i)).toBeInTheDocument();
    expect(screen.getByText(/pending review/i)).toBeInTheDocument();
  });

  it('renders nothing when the legal_services flag is OFF', () => {
    flagState = { legal_services: false };
    const { container } = renderWithClient(createElement(ProfessionalLicenseSection));
    expect(container).toBeEmptyDOMElement();
  });
});

describe('VerifiedBarBadge', () => {
  it('renders the badge when the provider has a verified bar license', () => {
    flagState = { legal_services: true };
    publicLicenses = [
      { license_type: 'bar', jurisdiction: 'Texas', status: 'verified', last4: '4567' },
    ];
    renderWithClient(createElement(VerifiedBarBadge, { providerId: 'prov-1' }));
    expect(screen.getByText(/Verified Bar Member/i)).toBeInTheDocument();
  });

  it('does NOT render when the only bar license is still pending', () => {
    flagState = { legal_services: true };
    publicLicenses = [
      { license_type: 'bar', jurisdiction: 'Texas', status: 'pending', last4: '4567' },
    ];
    const { container } = renderWithClient(
      createElement(VerifiedBarBadge, { providerId: 'prov-1' }),
    );
    expect(screen.queryByText(/Verified Bar Member/i)).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('does NOT render when the legal_services flag is OFF, even if verified', () => {
    flagState = { legal_services: false };
    publicLicenses = [
      { license_type: 'bar', jurisdiction: 'Texas', status: 'verified', last4: '4567' },
    ];
    const { container } = renderWithClient(
      createElement(VerifiedBarBadge, { providerId: 'prov-1' }),
    );
    expect(screen.queryByText(/Verified Bar Member/i)).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
