// Smoke test for the provider team / employees page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/provider/team',
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

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ data: undefined, isLoading: false, isError: false }),
  useUpdateEmployee: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import ProviderTeamPage from '@/app/(dashboard)/provider/team/page';

describe('ProviderTeamPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(ProviderTeamPage)));
    expect(container).toBeTruthy();
  });
});
