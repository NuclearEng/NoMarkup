import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgeGate } from '@/components/compliance/AgeGate';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    body: string;
    constructor(status: number, body: string) {
      super(`API error ${String(status)}: ${body}`);
      this.status = status;
      this.body = body;
    }
    userMessage(fallback: string) {
      return fallback;
    }
  },
}));

const authState = {
  accessToken: 'token-1',
  isAuthenticated: true,
  user: { id: 'user-1' },
};

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: <T,>(selector: (s: typeof authState) => T) => selector(authState),
}));

const { api } = (await import('@/lib/api')) as unknown as {
  api: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
};

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AgeGate', () => {
  it('does not render when status reports verified=true', async () => {
    api.get.mockResolvedValue({ verified: true, verified_at: '2026-04-01' });
    const { queryByTestId } = render(
      <Wrapper>
        <AgeGate />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(queryByTestId('age-gate-modal')).toBeNull();
    });
  });

  it('renders the modal when status reports verified=false', async () => {
    api.get.mockResolvedValue({ verified: false, verified_at: null });
    render(
      <Wrapper>
        <AgeGate />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('age-gate-modal')).toBeDefined();
    });
  });

  it('rejects DOB that makes user under 18', async () => {
    api.get.mockResolvedValue({ verified: false, verified_at: null });
    api.put.mockResolvedValue({ dob_verified: true });
    const user = userEvent.setup();
    render(
      <Wrapper>
        <AgeGate />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('age-gate-modal')).toBeDefined();
    });
    const input = screen.getByTestId('age-gate-dob-input');
    if (!(input instanceof HTMLInputElement)) throw new Error('expected input');
    // 5 years old.
    const recent = new Date();
    recent.setFullYear(recent.getFullYear() - 5);
    await user.clear(input);
    await user.type(input, recent.toISOString().slice(0, 10));
    await user.click(screen.getByTestId('age-gate-submit'));
    expect(screen.getByRole('alert').textContent).toMatch(/at least 18/);
    expect(api.put).not.toHaveBeenCalled();
  });

  it('PUTs the DOB when user is at least 18', async () => {
    api.get.mockResolvedValue({ verified: false, verified_at: null });
    api.put.mockResolvedValue({ dob_verified: true });
    const user = userEvent.setup();
    render(
      <Wrapper>
        <AgeGate />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('age-gate-modal')).toBeDefined();
    });
    const input = screen.getByTestId('age-gate-dob-input');
    if (!(input instanceof HTMLInputElement)) throw new Error('expected input');
    // 30 years old.
    const old = new Date();
    old.setFullYear(old.getFullYear() - 30);
    await user.clear(input);
    await user.type(input, old.toISOString().slice(0, 10));
    await user.click(screen.getByTestId('age-gate-submit'));
    await waitFor(() => {
      expect(api.put).toHaveBeenCalled();
    });
    expect(api.put.mock.calls[0]?.[0]).toBe('/api/v1/me/dob');
  });
});
