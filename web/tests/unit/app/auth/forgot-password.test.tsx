// Smoke test: ForgotPasswordPage just renders <ForgotPasswordForm/>.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/forgot-password',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@/components/forms/ForgotPasswordForm', () => ({
  ForgotPasswordForm: () =>
    createElement('form', { 'data-testid': 'forgot-form' }, 'Send reset link'),
}));

const { default: ForgotPasswordPage } = await import('@/app/(auth)/forgot-password/page');

describe('(auth)/forgot-password/page', () => {
  it('renders the ForgotPasswordForm', () => {
    render(createElement(ForgotPasswordPage));
    expect(screen.getByTestId('forgot-form')).toBeDefined();
    expect(screen.getByText('Send reset link')).toBeDefined();
  });
});
