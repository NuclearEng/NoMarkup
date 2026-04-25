// Smoke test for the admin platform metrics page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

// jsdom's Storage stub on this version doesn't expose getItem as a function;
// install a minimal in-memory shim so the page can call localStorage.getItem.
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length(): number { return store.size; },
    },
  });
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/platform',
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

vi.mock('@/hooks/useAdmin', () => ({
  useCategoryMetrics: () => ({ data: undefined, isLoading: false }),
  useGrowthMetrics: () => ({ data: undefined, isLoading: false }),
  usePlatformMetrics: () => ({ data: undefined, isLoading: false }),
}));

import AdminPlatformPage from '@/app/(dashboard)/admin/platform/page';

describe('AdminPlatformPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(AdminPlatformPage)));
    expect(container).toBeTruthy();
  });
});
