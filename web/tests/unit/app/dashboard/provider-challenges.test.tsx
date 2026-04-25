// Smoke test for the provider challenges page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/provider/challenges',
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

vi.mock('@/hooks/useChallenges', () => ({
  useActiveChallenges: () => ({ data: undefined, isLoading: false }),
  useJoinChallenge: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMyChallenges: () => ({ data: undefined, isLoading: false }),
}));

import ProviderChallengesPage from '@/app/(dashboard)/provider/challenges/page';

describe('ProviderChallengesPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(ProviderChallengesPage)));
    expect(container).toBeTruthy();
  });
});
