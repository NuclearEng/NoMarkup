// Branch coverage for UnsubscribeClient beyond unsubscribe.test.tsx (which
// covers the missing-token and happy paths): which server error text is shown
// verbatim vs. replaced by the safe fallback, network failure, the pending
// double-submit guard, token trimming, and retry-after-error.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const search = vi.hoisted(() => ({
  current: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => search.current,
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

import { UnsubscribeClient } from '@/app/(public)/unsubscribe/unsubscribe-client';

const ERROR_FALLBACK =
  'This unsubscribe link did not work. Open Settings → Notifications while signed in.';
const SUCCESS_MESSAGE =
  'Marketing email is off. You can turn individual messages back on in Settings → Notifications.';

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

function errorResponse(body: unknown, status = 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function clickUnsubscribe(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Unsubscribe' }));
}

beforeEach(() => {
  search.current = new URLSearchParams('token=tok-1');
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('UnsubscribeClient — token handling', () => {
  it('treats a whitespace-only token as missing', () => {
    search.current = new URLSearchParams('token=%20%20');
    render(<UnsubscribeClient />);
    expect(screen.getByText('This link is missing a token.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unsubscribe' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('posts the trimmed token', async () => {
    search.current = new URLSearchParams('token=%20tok-padded%20');
    fetchMock.mockResolvedValue(errorResponse({ success: true }, 200));
    render(<UnsubscribeClient />);
    expect(screen.queryByText('This link is missing a token.')).toBeNull();
    await clickUnsubscribe();
    await screen.findByText(SUCCESS_MESSAGE);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/notifications/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token: 'tok-padded' }),
    });
  });

  it('removes the button after success so the token cannot be re-posted', async () => {
    fetchMock.mockResolvedValue(errorResponse({ success: true }, 200));
    render(<UnsubscribeClient />);
    await clickUnsubscribe();
    await screen.findByText(SUCCESS_MESSAGE);
    expect(screen.queryByRole('button', { name: 'Unsubscribe' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('UnsubscribeClient — error messages', () => {
  it('shows a short single-line server error verbatim, trimmed', async () => {
    fetchMock.mockResolvedValue(errorResponse({ error: '  This link has expired.  ' }, 410));
    render(<UnsubscribeClient />);
    await clickUnsubscribe();
    expect(await screen.findByRole('alert')).toHaveTextContent(/^This link has expired\.$/);
    expect(screen.queryByText(SUCCESS_MESSAGE)).toBeNull();
  });

  it('shows a server error of exactly 200 characters', async () => {
    const message = 'e'.repeat(200);
    fetchMock.mockResolvedValue(errorResponse({ error: message }));
    render(<UnsubscribeClient />);
    await clickUnsubscribe();
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it.each<[string, unknown]>([
    ['an empty error string', { error: '   ' }],
    ['an error longer than 200 characters', { error: 'e'.repeat(201) }],
    ['a multi-line error (stack trace shaped)', { error: 'pq: boom\n  at handler.go:42' }],
    ['a non-string error field', { error: { code: 500 } }],
    ['a body with no error field', { message: 'nope' }],
    ['a null body', null],
    ['a primitive body', 'just a string'],
  ])('falls back to the safe message for %s', async (_label, body) => {
    fetchMock.mockResolvedValue(errorResponse(body, 500));
    render(<UnsubscribeClient />);
    await clickUnsubscribe();
    expect(await screen.findByRole('alert')).toHaveTextContent(ERROR_FALLBACK);
  });

  it('falls back to the safe message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    render(<UnsubscribeClient />);
    await clickUnsubscribe();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(ERROR_FALLBACK);
    expect(alert).not.toHaveTextContent('502');
  });

  it('falls back to the safe message when the request itself fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<UnsubscribeClient />);
    await clickUnsubscribe();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(ERROR_FALLBACK);
    expect(alert).not.toHaveTextContent('Failed to fetch');
  });

  it('replaces a previous server error with the fallback when a retry fails on the network', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse({ error: 'This link has expired.' }, 410));
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<UnsubscribeClient />);
    await clickUnsubscribe();
    expect(await screen.findByRole('alert')).toHaveTextContent('This link has expired.');
    await clickUnsubscribe();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(ERROR_FALLBACK);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the button after an error and succeeds on retry', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse({ error: 'Try again shortly.' }, 503));
    fetchMock.mockResolvedValueOnce(errorResponse({ success: true }, 200));
    render(<UnsubscribeClient />);
    await clickUnsubscribe();
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again shortly.');
    expect(screen.getByRole('button', { name: 'Unsubscribe' })).toBeEnabled();
    await clickUnsubscribe();
    await screen.findByText(SUCCESS_MESSAGE);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('UnsubscribeClient — pending state', () => {
  it('disables the button while the request is in flight and sends it only once', async () => {
    let resolveFetch: (res: Response) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    render(<UnsubscribeClient />);
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'Unsubscribe' });
    await user.click(button);
    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    await user.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(errorResponse({ success: true }, 200));
    await screen.findByText(SUCCESS_MESSAGE);
  });
});
