// Smoke test for the Post a Job page (thin wrapper around JobPostingForm).
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/jobs/new',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@/components/forms/JobPostingForm', () => ({
  JobPostingForm: () => createElement('div', { 'data-testid': 'job-posting-form' }),
}));

import NewJobPage from '@/app/(dashboard)/jobs/new/page';

describe('NewJobPage', () => {
  it('renders the JobPostingForm', () => {
    const { container } = render(withQueryClient(createElement(NewJobPage)));
    expect(container.querySelector('[data-testid="job-posting-form"]')).toBeTruthy();
  });
});
