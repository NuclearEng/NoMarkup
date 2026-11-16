// Sell new page — thin wrapper around ListingPostingForm.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/sell/new',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@/components/marketplace/ListingPostingForm', () => ({
  ListingPostingForm: () => createElement('div', { 'data-testid': 'listing-form' }),
}));

import SellNewPage from '@/app/(dashboard)/sell/new/page';

describe('SellNewPage', () => {
  it('renders the ListingPostingForm', () => {
    const { container } = render(withQueryClient(createElement(SellNewPage)));
    expect(container.querySelector('[data-testid="listing-form"]')).toBeTruthy();
  });
});
