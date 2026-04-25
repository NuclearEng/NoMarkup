import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OAuthButtons, OAuthDivider } from '@/components/auth/oauth-buttons';

describe('OAuthButtons', () => {
  let originalLocation: Location;

  beforeEach(() => {
    originalLocation = window.location;
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
});

describe('OAuthDivider', () => {
  it('renders the divider with descriptive text', () => {
    render(createElement(OAuthDivider));
    expect(screen.getByText(/or continue with email/i)).toBeDefined();
  });
});
