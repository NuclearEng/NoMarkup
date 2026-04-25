// Smoke test for the provider workspace page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/provider/workspace',
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

vi.mock('@/hooks/useContracts', () => ({
  useContracts: () => ({ data: undefined, isLoading: false, isError: false }),
}));

import ProviderWorkspacePage from '@/app/(dashboard)/provider/workspace/page';

describe('ProviderWorkspacePage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(ProviderWorkspacePage)));
    expect(container).toBeTruthy();
  });
});
