// Smoke test: AuthLayout is a server component that wraps children with brand
// chrome (logo + animated background). We mock the visual decorations to keep
// the test focused on layout composition.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@/components/layout/Logo', () => ({
  Logo: () => createElement('div', { 'data-testid': 'logo' }, 'NoMarkup'),
}));

vi.mock('@/components/landing/GradientMesh', () => ({
  GradientMesh: () => createElement('div', { 'data-testid': 'gradient-mesh' }),
}));

const { default: AuthLayout } = await import('@/app/(auth)/layout');

describe('(auth)/layout', () => {
  it('renders the brand logo and child content', () => {
    render(
      createElement(
        AuthLayout,
        null,
        createElement('div', { 'data-testid': 'child' }, 'auth child'),
      ),
    );

    expect(screen.getByTestId('logo')).toBeDefined();
    expect(screen.getByTestId('gradient-mesh')).toBeDefined();
    expect(screen.getByTestId('child')).toBeDefined();
    expect(screen.getByText('auth child')).toBeDefined();
  });
});
