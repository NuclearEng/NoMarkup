import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const search = vi.hoisted(() => ({
  current: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => search.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/unsubscribe',
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

import UnsubscribePage from '@/app/(public)/unsubscribe/page';

describe('/unsubscribe', () => {
  beforeEach(() => {
    search.current = new URLSearchParams();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('does not offer a button or call fetch when the link has no token', () => {
    render(<UnsubscribePage />);

    expect(screen.getByText(/missing a token/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Unsubscribe' })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts the token only after Unsubscribe is clicked', async () => {
    search.current = new URLSearchParams('token=tok-test');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<UnsubscribePage />);

    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Unsubscribe' }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Marketing email is off. You can turn individual messages back on in Settings → Notifications.',
        ),
      ).toBeDefined();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/notifications/unsubscribe',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ token: 'tok-test' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> };
    expect(init.headers?.Authorization).toBeUndefined();
  });
});
