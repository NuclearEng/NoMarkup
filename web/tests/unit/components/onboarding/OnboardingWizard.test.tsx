import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
const updateProfile = vi.fn();
const enableRole = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({
    data: {
      id: 'u1',
      email: 'a@example.com',
      displayName: '',
      avatarUrl: null,
      roles: ['customer'],
      status: 'active',
      emailVerified: true,
      phone: null,
      phoneVerified: false,
      mfaEnabled: false,
      createdAt: '2026-01-01T00:00:00Z',
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUpdateProfile: () => ({ mutateAsync: updateProfile, isPending: false }),
  useEnableRole: () => ({ mutateAsync: enableRole, isPending: false }),
  useSendPhoneOtp: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVerifyPhone: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useProperties', () => ({
  useCreateProperty: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';

describe('OnboardingWizard', () => {
  beforeEach(() => {
    push.mockReset();
    updateProfile.mockReset();
    enableRole.mockReset();
  });

  it('lets a new user skip the display name and leave for the dashboard', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);

    expect(screen.getByTestId('onboarding.root')).toBeDefined();
    expect(screen.getByTestId('onboarding.displayName')).toBeDefined();

    await user.click(screen.getByTestId('onboarding.skip'));
    expect(screen.getByTestId('onboarding.phone')).toBeDefined();

    await user.click(screen.getByTestId('onboarding.notNow'));
    expect(push).toHaveBeenCalledWith('/dashboard');
  });
});
