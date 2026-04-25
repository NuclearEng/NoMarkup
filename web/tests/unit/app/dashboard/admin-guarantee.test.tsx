// Smoke test for the admin guarantee claims list page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/guarantee',
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

vi.mock('@/hooks/useGuarantee', () => ({
  useAdminGuaranteeClaims: () => ({ data: undefined, isLoading: false, isError: false }),
}));

import AdminGuaranteePage from '@/app/(dashboard)/admin/guarantee/page';

describe('AdminGuaranteePage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(AdminGuaranteePage)));
    expect(container).toBeTruthy();
  });
});
