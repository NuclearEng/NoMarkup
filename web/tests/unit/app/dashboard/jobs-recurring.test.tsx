// Smoke test for the recurring jobs management page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/jobs/recurring',
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
  useCancelJob: () => ({ mutate: vi.fn(), isPending: false }),
  useCustomerJobs: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateJob: () => ({ mutate: vi.fn(), isPending: false }),
}));

import RecurringJobsPage from '@/app/(dashboard)/jobs/recurring/page';

describe('RecurringJobsPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(RecurringJobsPage)));
    expect(container).toBeTruthy();
  });
});
