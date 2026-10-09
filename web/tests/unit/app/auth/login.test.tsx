// Smoke test: LoginPage just renders <LoginForm/>. Form internals are covered
// by tests/unit/components/forms/LoginForm.test.tsx — we only assert that the
// page composes the form correctly.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/login',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@/components/forms/LoginForm', () => ({
  LoginForm: () => createElement('form', { 'data-testid': 'login-form' }, 'Sign in'),
}));

const { default: LoginPage } = await import('@/app/(auth)/login/page');

describe('(auth)/login/page', () => {
  it('renders the LoginForm', () => {
    render(createElement(LoginPage));
    expect(screen.getByTestId('login-form')).toBeDefined();
    expect(screen.getByText('Sign in')).toBeDefined();
  });
});
