import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { User } from '@/types';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getPublic: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const mutateAsyncMock = vi.fn();
vi.mock('@/hooks/useProfile', () => ({
  useUpdateProfile: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
    isError: false,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const { ProfileForm } = await import('@/components/forms/ProfileForm');

const baseUser: User = {
  id: 'user-1',
  email: 'user@example.com',
  displayName: 'Original Name',
  avatarUrl: null,
  roles: ['customer'],
  status: 'active',
  emailVerified: true,
  phoneVerified: false,
  mfaEnabled: false,
  createdAt: '2026-01-01T00:00:00Z',
};

describe('ProfileForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsyncMock.mockReset();
  });

  it('renders all editable fields and action buttons', () => {
    const onCancel = vi.fn();
    const onSuccess = vi.fn();
    render(
      createElement(ProfileForm, { user: baseUser, onCancel, onSuccess }),
    );

    expect(screen.getByDisplayValue('Original Name')).toBeDefined();
    expect(screen.getByPlaceholderText('+15551234567')).toBeDefined();
    expect(screen.getByPlaceholderText('https://example.com/avatar.jpg')).toBeDefined();
    expect(screen.getByRole('button', { name: /Save Changes/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeDefined();
  });

  it('calls onCancel when the Cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onSuccess = vi.fn();
    render(
      createElement(ProfileForm, { user: baseUser, onCancel, onSuccess }),
    );

    await user.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows a validation error for an invalid phone number', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onSuccess = vi.fn();
    const { container } = render(
      createElement(ProfileForm, { user: baseUser, onCancel, onSuccess }),
    );

    const phoneInput = screen.getByPlaceholderText('+15551234567');
    await user.type(phoneInput, 'not-a-phone');

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);

    expect(await screen.findByText(/Invalid phone number/)).toBeDefined();
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it('submits the form with the correct snake_case payload on success', async () => {
    mutateAsyncMock.mockResolvedValue({});
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onSuccess = vi.fn();
    const { container } = render(
      createElement(ProfileForm, { user: baseUser, onCancel, onSuccess }),
    );

    const nameInput = screen.getByDisplayValue('Original Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated Name');

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    });
    expect(mutateAsyncMock).toHaveBeenCalledWith({
      display_name: 'Updated Name',
      phone: undefined,
      timezone: 'America/New_York',
      avatar_url: undefined,
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });
});
