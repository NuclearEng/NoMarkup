// Smoke test: VerifyEmailPage wraps VerifyEmailContent in a <Suspense>. We
// assert the inner content mounts.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/verify-email',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@/components/forms/VerifyEmailContent', () => ({
  VerifyEmailContent: () =>
    createElement('div', { 'data-testid': 'verify-content' }, 'Verifying your email'),
}));

const { default: VerifyEmailPage } = await import('@/app/(auth)/verify-email/page');

describe('(auth)/verify-email/page', () => {
  it('renders the VerifyEmailContent', () => {
    render(createElement(VerifyEmailPage));
    expect(screen.getByTestId('verify-content')).toBeDefined();
    expect(screen.getByText('Verifying your email')).toBeDefined();
  });
});
