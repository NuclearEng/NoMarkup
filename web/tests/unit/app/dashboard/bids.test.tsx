// Smoke test for the My Bids page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/bids',
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

vi.mock('@/hooks/useBids', () => ({
  useMyBids: () => ({ data: undefined, isLoading: false, isError: false }),
}));

import BidsPage from '@/app/(dashboard)/bids/page';

describe('BidsPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(BidsPage)));
    expect(container).toBeTruthy();
  });
});
