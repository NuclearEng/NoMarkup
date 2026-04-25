// Smoke test for the pricing page. The page wraps a heavy client component
// (PricingPageContent) — we stub it so this test only verifies composition.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/pricing',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@/app/(public)/pricing/PricingPageContent', () => ({
  PricingPageContent: () =>
    createElement('main', { 'data-testid': 'pricing-content' }, 'Fair Price Index'),
}));

const { default: PricingPage } = await import('@/app/(public)/pricing/page');

describe('(public)/pricing/page', () => {
  it('renders the PricingPageContent', () => {
    render(createElement(PricingPage));
    expect(screen.getByTestId('pricing-content')).toBeDefined();
    expect(screen.getByText('Fair Price Index')).toBeDefined();
  });
});
