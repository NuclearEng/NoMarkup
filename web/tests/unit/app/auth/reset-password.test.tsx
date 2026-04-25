// Smoke test: ResetPasswordPage wraps ResetPasswordContent in a <Suspense> for
// useSearchParams. We assert the content renders (Suspense fallback is unused
// once the mocked client component is synchronous).
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/reset-password',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@/components/forms/ResetPasswordContent', () => ({
  ResetPasswordContent: () =>
    createElement('div', { 'data-testid': 'reset-content' }, 'Reset your password'),
}));

const { default: ResetPasswordPage } = await import('@/app/(auth)/reset-password/page');

describe('(auth)/reset-password/page', () => {
  it('renders the ResetPasswordContent', () => {
    render(createElement(ResetPasswordPage));
    expect(screen.getByTestId('reset-content')).toBeDefined();
    expect(screen.getByText('Reset your password')).toBeDefined();
  });
});
