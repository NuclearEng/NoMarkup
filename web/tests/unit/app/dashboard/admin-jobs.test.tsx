// Smoke test for the admin jobs management page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/jobs',
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
  useAdminJobs: () => ({ data: undefined, isLoading: false, isError: false }),
  useRemoveJob: () => ({ mutate: vi.fn(), isPending: false }),
  useSuspendJob: () => ({ mutate: vi.fn(), isPending: false }),
}));

import AdminJobsPage from '@/app/(dashboard)/admin/jobs/page';

describe('AdminJobsPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(AdminJobsPage)));
    expect(container).toBeTruthy();
  });
});
