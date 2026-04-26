import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    postUnauthed: vi.fn(),
  },
}));

const { useSearchParams } = await import('next/navigation');
const { api } = await import('@/lib/api');
const { VerifyEmailContent } = await import('@/components/forms/VerifyEmailContent');

const useSearchParamsMock = vi.mocked(useSearchParams);

function makeParams(token: string | null): URLSearchParams {
  const sp = new URLSearchParams();
  if (token != null) sp.set('token', token);
  return sp;
}

describe('VerifyEmailContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially when a token is present', () => {
    useSearchParamsMock.mockReturnValue(
      makeParams('abc') as unknown as ReturnType<typeof useSearchParams>,
    );
    vi.mocked(api.postUnauthed).mockImplementation(() => new Promise(() => undefined));

    render(createElement(VerifyEmailContent));
    expect(screen.getByText(/Verifying your email address/)).toBeDefined();
  });

  it('shows success state when verification succeeds', async () => {
    useSearchParamsMock.mockReturnValue(
      makeParams('abc') as unknown as ReturnType<typeof useSearchParams>,
    );
    vi.mocked(api.postUnauthed).mockResolvedValue({});

    render(createElement(VerifyEmailContent));

    await waitFor(() => {
      expect(screen.getByText(/Your email has been verified/)).toBeDefined();
    });
  });

  it('shows error state when verification fails', async () => {
    useSearchParamsMock.mockReturnValue(
      makeParams('bad-token') as unknown as ReturnType<typeof useSearchParams>,
    );
    vi.mocked(api.postUnauthed).mockRejectedValue(new Error('Token expired'));

    render(createElement(VerifyEmailContent));

    await waitFor(() => {
      expect(screen.getByText('Token expired')).toBeDefined();
    });
  });

  it('shows error immediately when no token is provided', () => {
    useSearchParamsMock.mockReturnValue(
      makeParams(null) as unknown as ReturnType<typeof useSearchParams>,
    );

    render(createElement(VerifyEmailContent));
    expect(screen.getByText('No verification token provided')).toBeDefined();
  });

  it('shows generic error message when caught value is not an Error instance', async () => {
    // Covers the `error instanceof Error ? error.message : 'Verification failed'`
    // ternary's else-branch when the rejection value is a non-Error (e.g. string).
    useSearchParamsMock.mockReturnValue(
      makeParams('non-error-token') as unknown as ReturnType<typeof useSearchParams>,
    );
    vi.mocked(api.postUnauthed).mockRejectedValue('rejected with string');

    render(createElement(VerifyEmailContent));

    await waitFor(() => {
      // The alert role disambiguates from the CardDescription which also
      // displays "Verification failed" as the heading.
      expect(screen.getByRole('alert').textContent).toBe('Verification failed');
    });
  });

  it('renders the Sign In CTA link', () => {
    useSearchParamsMock.mockReturnValue(
      makeParams('any') as unknown as ReturnType<typeof useSearchParams>,
    );
    vi.mocked(api.postUnauthed).mockImplementation(() => new Promise(() => undefined));

    render(createElement(VerifyEmailContent));
    const link = screen.getByRole('link', { name: /go to sign in/i });
    expect(link.getAttribute('href')).toBe('/login');
  });
});
