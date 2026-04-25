// Smoke test for the user profile page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/profile',
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

vi.mock('@/components/forms/ProfileForm', () => ({
  ProfileForm: () => createElement('div', { 'data-testid': 'profile-form' }),
}));

vi.mock('@/hooks/useProfile', () => ({
  useEnableRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useProfile: () => ({ data: undefined, isLoading: true, error: null }),
}));

vi.mock('@/hooks/useProviderProfile', () => ({
  useProviderProfile: () => ({ data: undefined, isLoading: false }),
}));

import ProfilePage from '@/app/(dashboard)/profile/page';

describe('ProfilePage', () => {
  it('renders without throwing in loading state', () => {
    const { container } = render(withQueryClient(createElement(ProfilePage)));
    expect(container).toBeTruthy();
  });
});
