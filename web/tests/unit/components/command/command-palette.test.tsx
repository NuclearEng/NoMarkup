import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CommandPalette } from '@/components/command/command-palette';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({
    isAuthenticated: true,
    user: { id: 'u1', roles: ['customer'], email: 'c@example.com' },
  }),
}));

describe('CommandPalette', () => {
  beforeEach(() => {
    push.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('opens on meta+k and lists jump commands', async () => {
    render(<CommandPalette />);

    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    });

    expect(await screen.findByPlaceholderText('Jump to…')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Post a job/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Marketplace/i })).toBeInTheDocument();
  });

  it('filters commands and navigates on Enter', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    });
    const input = await screen.findByPlaceholderText('Jump to…');
    // Unique prefix so we do not also match "Browse jobs" (keyword: market).
    await user.clear(input);
    await user.type(input, 'marketplace');

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Marketplace/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(push).toHaveBeenCalledWith('/marketplace');
  });

  it('opens via the custom event used by the header trigger', async () => {
    render(<CommandPalette />);
    await act(async () => {
      window.dispatchEvent(new Event('nomarkup:open-command-palette'));
    });
    expect(await screen.findByPlaceholderText('Jump to…')).toBeInTheDocument();
  });
});