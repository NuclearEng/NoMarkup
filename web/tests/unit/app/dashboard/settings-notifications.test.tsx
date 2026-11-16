// Tests for the notifications preferences page — exercises loading, error,
// global toggles, per-type toggles, and Save handler.
import { fireEvent, render, screen } from '@testing-library/react';
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const prefsState: {
  data: {
    preferences: { notification_type: string; push_enabled: boolean; email_enabled: boolean; sms_enabled: boolean; in_app_enabled: boolean }[];
    global_push_enabled: boolean;
    global_email_enabled: boolean;
    global_sms_enabled: boolean;
  } | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };

const updateMutate = vi.fn((..._args: unknown[]) => Promise.resolve({}));
const updateState = { isPending: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/settings/notifications',
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

vi.mock('@/hooks/useNotifications', () => ({
  useNotificationPreferences: () => prefsState,
  useUpdatePreferences: () => ({ mutateAsync: updateMutate, isPending: updateState.isPending }),
}));

import NotificationPrefsPage from '@/app/(dashboard)/settings/notifications/page';

beforeEach(() => {
  prefsState.data = {
    preferences: [],
    global_push_enabled: true,
    global_email_enabled: true,
    global_sms_enabled: false,
  };
  prefsState.isLoading = false;
  prefsState.isError = false;
  updateState.isPending = false;
  updateMutate.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('SettingsNotificationsPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(NotificationPrefsPage)));
    expect(container).toBeTruthy();
  });

  it('shows the loading skeleton state', () => {
    prefsState.data = undefined;
    prefsState.isLoading = true;
    render(withQueryClient(createElement(NotificationPrefsPage)));
    expect(screen.getByText(/Notification Preferences/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Save preferences/i })).toBeNull();
  });

  it('shows the error state when isError is true', () => {
    prefsState.data = undefined;
    prefsState.isError = true;
    render(withQueryClient(createElement(NotificationPrefsPage)));
    expect(screen.getByText(/Failed to load notification preferences/i)).toBeDefined();
  });

  it('Save button is disabled until a change is made (not dirty)', () => {
    render(withQueryClient(createElement(NotificationPrefsPage)));
    const save = screen.getByRole('button', { name: /Save preferences/i });
    expect(save.hasAttribute('disabled')).toBe(true);
  });

  it('toggling a global switch enables the Save button and submits prefs', async () => {
    render(withQueryClient(createElement(NotificationPrefsPage)));
    const emailToggle = screen.getByRole('switch', {
      name: /Toggle email notifications globally/i,
    });
    await act(() => {
      fireEvent.click(emailToggle);
      return Promise.resolve();
    });
    const save = screen.getByRole('button', { name: /Save preferences/i });
    expect(save.hasAttribute('disabled')).toBe(false);
    await act(() => {
      fireEvent.click(save);
      return Promise.resolve();
    });
    expect(updateMutate).toHaveBeenCalledTimes(1);
    const call = updateMutate.mock.calls[0]?.[0] as { global_email_enabled: boolean };
    expect(call.global_email_enabled).toBe(false);
  });

  it('toggling the global push switch flips it off', async () => {
    render(withQueryClient(createElement(NotificationPrefsPage)));
    const pushToggle = screen.getByRole('switch', {
      name: /Toggle push notifications globally/i,
    });
    await act(() => {
      fireEvent.click(pushToggle);
      return Promise.resolve();
    });
    const save1 = screen.getByRole('button', { name: /Save preferences/i });
    expect(save1.hasAttribute('disabled')).toBe(false);
  });

  it('toggling the global SMS switch flips it on', async () => {
    render(withQueryClient(createElement(NotificationPrefsPage)));
    const smsToggle = screen.getByRole('switch', {
      name: /Toggle SMS notifications globally/i,
    });
    await act(() => {
      fireEvent.click(smsToggle);
      return Promise.resolve();
    });
    const save2 = screen.getByRole('button', { name: /Save preferences/i });
    expect(save2.hasAttribute('disabled')).toBe(false);
  });

  it('toggling a per-type Email switch makes the form dirty', async () => {
    render(withQueryClient(createElement(NotificationPrefsPage)));
    const emailSwitch = screen.getByRole('switch', { name: /Email notification for New bid received/i });
    await act(() => {
      fireEvent.click(emailSwitch);
      return Promise.resolve();
    });
    const save3 = screen.getByRole('button', { name: /Save preferences/i });
    expect(save3.hasAttribute('disabled')).toBe(false);
  });

  it('shows Saving... label when mutation is pending', () => {
    updateState.isPending = true;
    render(withQueryClient(createElement(NotificationPrefsPage)));
    expect(screen.getByRole('button', { name: /Saving\.\.\./ })).toBeDefined();
  });
});
