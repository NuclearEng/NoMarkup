import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/settings/account',
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

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    userMessage(fallback: string) {
      return this.message || fallback;
    }
  },
  downloadAuthenticated: vi.fn(),
  getApiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({
    data: {
      id: 'u1',
      phone: '+15551234567',
      phoneVerified: false,
    },
  }),
  useSendPhoneOtp: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVerifyPhone: () => ({ mutateAsync: vi.fn(), isPending: false, data: undefined }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { logout: () => Promise<void> }) => unknown) =>
    selector({ logout: vi.fn() }),
}));

const { default: AccountSettingsPage } = await import(
  '@/app/(dashboard)/settings/account/page'
);

describe('AccountSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders phone OTP send+verify on the account settings page', () => {
    render(withQueryClient(createElement(AccountSettingsPage)));
    expect(screen.getByRole('heading', { name: /Phone verification/i })).toBeDefined();
    expect(screen.getByTestId('phone-otp-form')).toBeDefined();
    expect(screen.getByRole('button', { name: /Send SMS code/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Verify phone/i })).toBeDefined();
  });
});
