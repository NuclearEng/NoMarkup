// /insurance/quotes — competitive insurance quotes behind the
// insurance_competition flag. Covers the flag gate, ?contractId / ?coverageCents
// deep-link parsing (including bad input) and the Suspense fallback.
import { render, screen } from '@testing-library/react';
import { createElement, use, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

interface CompareProps {
  contractId?: string;
  defaultCoverageCents?: number;
}

const navState = { params: new URLSearchParams() };
const flagState: { enabled: boolean; suspend: boolean } = { enabled: true, suspend: false };

const useFeatureFlagMock = vi.fn<(key: string) => boolean>();
const compareSpy = vi.fn<(props: CompareProps) => void>();

// A promise that never settles: reading it with `use()` keeps the Suspense
// boundary on its fallback for the lifetime of the test.
const pending = new Promise<never>(() => undefined);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/insurance/quotes',
  useSearchParams: () => navState.params,
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlag: (key: string) => useFeatureFlagMock(key),
}));

vi.mock('@/components/ui/animated-illustration', () => ({
  AnimatedIllustration: ({ type }: { type: string }) =>
    createElement('span', { 'data-testid': `illustration-${type}` }),
}));

vi.mock('@/components/insurance/InsuranceQuoteCompare', () => ({
  InsuranceQuoteCompare: (props: CompareProps) => {
    if (flagState.suspend) use(pending);
    compareSpy(props);
    return createElement('div', { 'data-testid': 'quote-compare' });
  },
}));

import InsuranceQuotesPage from '@/app/(dashboard)/insurance/quotes/page';

function renderPage(query = '') {
  navState.params = new URLSearchParams(query);
  return render(withQueryClient(createElement(InsuranceQuotesPage)));
}

function lastCompareProps(): CompareProps | undefined {
  return compareSpy.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  flagState.enabled = true;
  flagState.suspend = false;
  useFeatureFlagMock.mockImplementation(() => flagState.enabled);
});

describe('InsuranceQuotesPage — feature flag', () => {
  it('reads the insurance_competition flag and shows the unavailable state when it is off', () => {
    flagState.enabled = false;
    renderPage('contractId=c-1&coverageCents=500000');

    expect(useFeatureFlagMock).toHaveBeenCalledWith('insurance_competition');
    expect(screen.getByText('Not available yet')).toBeInTheDocument();
    expect(screen.getByTestId('illustration-search-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('quote-compare')).toBeNull();
    expect(compareSpy).not.toHaveBeenCalled();
  });

  it('renders the comparison (and no unavailable state) when the flag is on', () => {
    renderPage();

    expect(screen.getByTestId('quote-compare')).toBeInTheDocument();
    expect(screen.queryByText('Not available yet')).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to Insurance' })).toHaveAttribute(
      'href',
      '/insurance',
    );
  });
});

describe('InsuranceQuotesPage — deep-link params', () => {
  it('passes no context when the URL has no query string', () => {
    renderPage();
    expect(lastCompareProps()).toEqual({ contractId: undefined, defaultCoverageCents: undefined });
  });

  it('passes contractId and a numeric coverage amount from the query string', () => {
    renderPage('contractId=contract-42&coverageCents=2500000');
    expect(lastCompareProps()).toEqual({
      contractId: 'contract-42',
      defaultCoverageCents: 2500000,
    });
  });

  it('passes contractId alone when coverageCents is absent', () => {
    renderPage('contractId=contract-42');
    expect(lastCompareProps()).toEqual({
      contractId: 'contract-42',
      defaultCoverageCents: undefined,
    });
  });

  it.each([
    ['empty', 'coverageCents='],
    ['non-numeric', 'coverageCents=lots'],
    ['zero', 'coverageCents=0'],
    ['negative', 'coverageCents=-500'],
    ['infinite', 'coverageCents=Infinity'],
  ])('drops a %s coverageCents instead of forwarding it', (_label, query) => {
    renderPage(query);
    expect(lastCompareProps()).toEqual({ contractId: undefined, defaultCoverageCents: undefined });
  });
});

describe('InsuranceQuotesPage — Suspense fallback', () => {
  it('shows the loading status while the content is suspended', () => {
    flagState.suspend = true;
    renderPage();

    expect(screen.getByRole('status', { name: 'Loading insurance quotes' })).toBeInTheDocument();
    expect(screen.queryByTestId('quote-compare')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Back to Insurance' })).toBeNull();
  });
});
