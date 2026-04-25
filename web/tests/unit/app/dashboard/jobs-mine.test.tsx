// Smoke test for the My Jobs (customer) page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/jobs/mine',
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

vi.mock('@/hooks/useJobs', () => ({
  useCustomerJobs: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
  usePublishJob: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteDraft: () => ({ mutate: vi.fn(), isPending: false }),
}));

import MyJobsPage from '@/app/(dashboard)/jobs/mine/page';

describe('MyJobsPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(MyJobsPage)));
    expect(container).toBeTruthy();
  });
});
