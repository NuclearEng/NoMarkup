// Smoke test: PublicLayout renders <Header/>, child content, and a footer.
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

vi.mock('@/components/layout/Header', () => ({
  Header: () => createElement('header', { 'data-testid': 'site-header' }, 'NoMarkup'),
}));

const { default: PublicLayout } = await import('@/app/(public)/layout');

describe('(public)/layout', () => {
  it('renders header, child content, and footer', () => {
    render(
      createElement(
        PublicLayout,
        null,
        createElement('main', { 'data-testid': 'child' }, 'public child'),
      ),
    );

    expect(screen.getByTestId('site-header')).toBeDefined();
    expect(screen.getByTestId('child')).toBeDefined();
    expect(screen.getByText(/All rights reserved/)).toBeDefined();
  });
});
