// Smoke + branch tests for the security settings page.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/settings/security',
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
}));

vi.mock('@/hooks/useProfile', () => ({
  useProfile: vi.fn(),
}));

vi.mock('@/hooks/useMFA', () => ({
  useEnableMFA: vi.fn(),
  useVerifyMFASetup: vi.fn(),
  useDisableMFA: vi.fn(),
}));

const { useProfile } = await import('@/hooks/useProfile');
const { useEnableMFA, useVerifyMFASetup, useDisableMFA } = await import('@/hooks/useMFA');
const { default: SecuritySettingsPage } = await import(
  '@/app/(dashboard)/settings/security/page'
);

function defaultMfa() {
  vi.mocked(useEnableMFA).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useEnableMFA>);
  vi.mocked(useVerifyMFASetup).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useVerifyMFASetup>);
  vi.mocked(useDisableMFA).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useDisableMFA>);
}

describe('SecuritySettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultMfa();
    vi.mocked(useProfile).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as unknown as ReturnType<typeof useProfile>);
  });

  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(SecuritySettingsPage)));
    expect(container).toBeTruthy();
  });

  it('shows the Change Password form with three password fields', () => {
    render(withQueryClient(createElement(SecuritySettingsPage)));
    expect(screen.getByLabelText('Current Password')).toBeDefined();
    expect(screen.getByLabelText('New Password')).toBeDefined();
    expect(screen.getByLabelText('Confirm New Password')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Change Password' })).toBeDefined();
  });

  it('shows the MFA loading skeleton when profile is loading', () => {
    vi.mocked(useProfile).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useProfile>);
    render(withQueryClient(createElement(SecuritySettingsPage)));
    // The MFA section shows the title even while loading; the body switches to a
    // Skeleton instead of either the enable / disable CTA.
    expect(screen.queryByRole('button', { name: 'Enable MFA' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disable MFA' })).toBeNull();
    expect(screen.getByText('Two-Factor Authentication')).toBeDefined();
  });

  it('renders the Enable MFA call to action when MFA is disabled', () => {
    vi.mocked(useProfile).mockReturnValue({
      data: { mfaEnabled: false },
      isLoading: false,
    } as unknown as ReturnType<typeof useProfile>);
    render(withQueryClient(createElement(SecuritySettingsPage)));
    expect(screen.getByRole('button', { name: 'Enable MFA' })).toBeDefined();
  });

  it('renders the Disable MFA button when MFA is enabled', () => {
    vi.mocked(useProfile).mockReturnValue({
      data: { mfaEnabled: true },
      isLoading: false,
    } as unknown as ReturnType<typeof useProfile>);
    render(withQueryClient(createElement(SecuritySettingsPage)));
    expect(screen.getByRole('button', { name: 'Disable MFA' })).toBeDefined();
    expect(screen.getByText('Two-factor authentication is enabled')).toBeDefined();
  });

  it('reveals the disable confirmation form when Disable MFA is clicked', () => {
    vi.mocked(useProfile).mockReturnValue({
      data: { mfaEnabled: true },
      isLoading: false,
    } as unknown as ReturnType<typeof useProfile>);
    render(withQueryClient(createElement(SecuritySettingsPage)));
    fireEvent.click(screen.getByRole('button', { name: 'Disable MFA' }));
    expect(screen.getByLabelText('Enter your authenticator code')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('shows the Setting up state when enableMFA is pending', () => {
    vi.mocked(useEnableMFA).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: true,
    } as unknown as ReturnType<typeof useEnableMFA>);
    vi.mocked(useProfile).mockReturnValue({
      data: { mfaEnabled: false },
      isLoading: false,
    } as unknown as ReturnType<typeof useProfile>);
    render(withQueryClient(createElement(SecuritySettingsPage)));
    expect(screen.getByRole('button', { name: 'Setting up...' })).toBeDefined();
  });

  it('renders the Active Sessions card with the timeout copy', () => {
    render(withQueryClient(createElement(SecuritySettingsPage)));
    expect(screen.getByText('Active Sessions')).toBeDefined();
    expect(screen.getByText(/60\s+minutes of inactivity/)).toBeDefined();
  });
});
