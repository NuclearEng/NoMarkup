// Smoke test for the provider business overview page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/provider/business',
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

vi.mock('@/hooks/useAnalytics', () => ({
  useProviderAnalytics: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/hooks/useExpenses', () => ({
  useExpenses: () => ({ data: undefined, isLoading: false }),
}));

import ProviderBusinessPage from '@/app/(dashboard)/provider/business/page';

describe('ProviderBusinessPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(ProviderBusinessPage)));
    expect(container).toBeTruthy();
  });
});
