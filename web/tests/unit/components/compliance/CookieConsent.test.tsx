import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CookieConsent } from '@/components/compliance/CookieConsent';

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

const { api } = (await import('@/lib/api')) as unknown as {
  api: { post: ReturnType<typeof vi.fn> };
};

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  if (typeof document !== 'undefined') {
    document.cookie = 'nm:consent=; Max-Age=0; Path=/';
  }
});

afterEach(() => {
  if (typeof document !== 'undefined') {
    document.cookie = 'nm:consent=; Max-Age=0; Path=/';
  }
});

describe('CookieConsent', () => {
  it('renders the banner on first visit', () => {
    render(
      <Wrapper>
        <CookieConsent />
      </Wrapper>,
    );
    expect(screen.getByTestId('cookie-consent-banner')).toBeDefined();
    expect(screen.getByText(/Cookie preferences/i)).toBeDefined();
  });

  it('does NOT render the banner when nm:consent cookie is set', () => {
    document.cookie = 'nm:consent=already; Max-Age=86400; Path=/';
    const { queryByTestId } = render(
      <Wrapper>
        <CookieConsent />
      </Wrapper>,
    );
    expect(queryByTestId('cookie-consent-banner')).toBeNull();
  });

  it('Accept all POSTs all-true and writes the cookie', async () => {
    api.post.mockResolvedValue({ recorded: true });
    const user = userEvent.setup();
    render(
      <Wrapper>
        <CookieConsent />
      </Wrapper>,
    );
    await user.click(screen.getByTestId('cookie-consent-accept'));
    expect(api.post).toHaveBeenCalledWith('/api/v1/cookie-consent', {
      necessary: true,
      analytics: true,
      marketing: true,
    });
    // Banner should hide after Save.
    expect(screen.queryByTestId('cookie-consent-banner')).toBeNull();
    // Cookie should now be set.
    expect(document.cookie).toContain('nm:consent=');
  });

  it('Reject all POSTs analytics=false marketing=false', async () => {
    api.post.mockResolvedValue({ recorded: true });
    const user = userEvent.setup();
    render(
      <Wrapper>
        <CookieConsent />
      </Wrapper>,
    );
    await user.click(screen.getByTestId('cookie-consent-reject'));
    expect(api.post).toHaveBeenCalledWith('/api/v1/cookie-consent', {
      necessary: true,
      analytics: false,
      marketing: false,
    });
  });

  it('defaults analytics and marketing checkboxes to off (opt-in)', () => {
    render(
      <Wrapper>
        <CookieConsent />
      </Wrapper>,
    );
    const analytics = screen.getByTestId('cookie-consent-analytics') as HTMLInputElement;
    const marketing = screen.getByTestId('cookie-consent-marketing') as HTMLInputElement;
    expect(analytics.checked).toBe(false);
    expect(marketing.checked).toBe(false);
  });

  it('Save preferences POSTs the user-selected toggles', async () => {
    api.post.mockResolvedValue({ recorded: true });
    const user = userEvent.setup();
    render(
      <Wrapper>
        <CookieConsent />
      </Wrapper>,
    );
    // Analytics defaults off (opt-in); enable analytics + marketing then save.
    await user.click(screen.getByTestId('cookie-consent-analytics'));
    await user.click(screen.getByTestId('cookie-consent-marketing'));
    await user.click(screen.getByTestId('cookie-consent-save'));
    expect(api.post).toHaveBeenCalledWith('/api/v1/cookie-consent', {
      necessary: true,
      analytics: true,
      marketing: true,
    });
  });

  it('Save with defaults POSTs analytics=false marketing=false', async () => {
    api.post.mockResolvedValue({ recorded: true });
    const user = userEvent.setup();
    render(
      <Wrapper>
        <CookieConsent />
      </Wrapper>,
    );
    await user.click(screen.getByTestId('cookie-consent-save'));
    expect(api.post).toHaveBeenCalledWith('/api/v1/cookie-consent', {
      necessary: true,
      analytics: false,
      marketing: false,
    });
  });
});
