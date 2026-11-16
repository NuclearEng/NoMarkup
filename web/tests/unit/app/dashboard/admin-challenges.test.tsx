// Smoke test for the admin challenge management page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/challenges',
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

vi.mock('@/components/admin/ChallengeManager', () => ({
  ChallengeManager: () => createElement('div', { 'data-testid': 'challenge-manager' }),
}));

import AdminChallengesPage from '@/app/(dashboard)/admin/challenges/page';

describe('AdminChallengesPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(AdminChallengesPage)));
    expect(container).toBeTruthy();
  });

  it('shows the challenge management heading', () => {
    const { container } = render(withQueryClient(createElement(AdminChallengesPage)));
    expect(container.textContent).toMatch(/Challenge Management/);
  });
});
