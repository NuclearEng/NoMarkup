import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let searchParamsMock = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsMock,
}));

const { OAuthButtons, OAuthDivider, POST_LOGIN_NEXT_KEY } = await import(
  '@/components/auth/oauth-buttons'
);

describe('OAuthButtons', () => {
  let originalLocation: Location;

  beforeEach(() => {
    originalLocation = window.location;
    searchParamsMock = new URLSearchParams();
    sessionStorage.clear();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    sessionStorage.clear();
  });

  it('renders both Google and Apple buttons', () => {
    render(createElement(OAuthButtons));
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /continue with apple/i })).toBeDefined();
  });

  it('navigates to Google OAuth URL when Google button is clicked', async () => {
    const user = userEvent.setup();
    render(createElement(OAuthButtons));
    await user.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(window.location.href).toBe('/api/v1/auth/oauth/google');
  });

  it('navigates to Apple OAuth URL when Apple button is clicked', async () => {
    const user = userEvent.setup();
    render(createElement(OAuthButtons));
    await user.click(screen.getByRole('button', { name: /continue with apple/i }));
    expect(window.location.href).toBe('/api/v1/auth/oauth/apple');
  });

  it('persists a same-origin next path before starting OAuth', async () => {
    searchParamsMock = new URLSearchParams('next=/orders');
    const user = userEvent.setup();
    render(createElement(OAuthButtons));
    await user.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(sessionStorage.getItem(POST_LOGIN_NEXT_KEY)).toBe('/orders');
    expect(window.location.href).toBe(
      '/api/v1/auth/oauth/google?next=%2Forders',
    );
  });

  it('does not persist an absolute next URL', async () => {
    searchParamsMock = new URLSearchParams('next=https://evil.example/phish');
    const user = userEvent.setup();
    render(createElement(OAuthButtons));
    await user.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(sessionStorage.getItem(POST_LOGIN_NEXT_KEY)).toBeNull();
    expect(window.location.href).toBe('/api/v1/auth/oauth/google');
  });
});

describe('OAuthDivider', () => {
  it('renders the divider with descriptive text', () => {
    render(createElement(OAuthDivider));
    expect(screen.getByText(/or continue with email/i)).toBeDefined();
  });
});
