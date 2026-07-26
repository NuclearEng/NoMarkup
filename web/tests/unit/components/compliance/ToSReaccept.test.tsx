import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToSReaccept } from '@/components/compliance/ToSReaccept';

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
  api: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
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

describe('ToSReaccept', () => {
  it('does not render when current.version === mine.tos_version', async () => {
    api.get
      .mockResolvedValueOnce({ version: '1.0', effective_at: '2026-01-01', body_url: '/terms' })
      .mockResolvedValueOnce({ tos_version: '1.0', accepted_at: '2026-04-01' });
    const { queryByTestId } = render(
      <Wrapper>
        <ToSReaccept />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/api/v1/tos/current');
    });
    await waitFor(() => {
      expect(queryByTestId('tos-reaccept-modal')).toBeNull();
    });
  });

  it('renders the modal when versions differ', async () => {
    api.get
      .mockResolvedValueOnce({ version: '2.0', effective_at: '2026-04-15', body_url: '/terms' })
      .mockResolvedValueOnce({ tos_version: '1.0', accepted_at: '2026-01-01' });
    render(
      <Wrapper>
        <ToSReaccept />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('tos-reaccept-modal')).toBeDefined();
    });
    expect(screen.getByText(/Updated Terms/i)).toBeDefined();
    expect(screen.getByTestId('tos-reaccept-version').textContent).toContain('2.0');
  });

  it('renders the first-time copy when user has never accepted', async () => {
    api.get
      .mockResolvedValueOnce({ version: '2.0', effective_at: '2026-04-15', body_url: '/terms' })
      .mockResolvedValueOnce({ tos_version: null, accepted_at: null });
    render(
      <Wrapper>
        <ToSReaccept />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('tos-reaccept-modal')).toBeDefined();
    });
    expect(screen.getByRole('heading', { name: /Accept our Terms/i })).toBeDefined();
  });

  it('POSTs the version when the user clicks Accept', async () => {
    api.get
      .mockResolvedValueOnce({ version: '2.0', effective_at: '2026-04-15', body_url: '/terms' })
      .mockResolvedValueOnce({ tos_version: '1.0', accepted_at: '2026-01-01' });
    api.post.mockResolvedValue({ accepted: true, tos_version: '2.0' });
    const user = userEvent.setup();
    render(
      <Wrapper>
        <ToSReaccept />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('tos-reaccept-modal')).toBeDefined();
    });
    await user.click(screen.getByTestId('tos-reaccept-submit'));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/api/v1/me/tos-acceptance', { tos_version: '2.0' });
    });
  });
});
