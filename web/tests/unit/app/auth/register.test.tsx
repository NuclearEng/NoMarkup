// Smoke test: RegisterPage just renders <RegisterForm/>. Form internals live
// in their own tests; we only check the page composes the form.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/register',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@/components/forms/RegisterForm', () => ({
  RegisterForm: () => createElement('form', { 'data-testid': 'register-form' }, 'Create account'),
}));

const { default: RegisterPage } = await import('@/app/(auth)/register/page');

describe('(auth)/register/page', () => {
  it('renders the RegisterForm', () => {
    render(createElement(RegisterPage));
    expect(screen.getByTestId('register-form')).toBeDefined();
    expect(screen.getByText('Create account')).toBeDefined();
  });
});
