// Smoke test: replay layout is metadata-only and returns children unchanged.
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

const { default: ReplayLayout } = await import(
  '@/app/(terminal)/auctions/[id]/replay/layout'
);

describe('(terminal)/auctions/[id]/replay/layout', () => {
  it('returns its children verbatim', () => {
    render(
      createElement(
        ReplayLayout,
        null,
        createElement('div', { 'data-testid': 'child' }, 'replay child'),
      ) as unknown as React.ReactElement,
    );
    expect(screen.getByTestId('child')).toBeDefined();
    expect(screen.getByText('replay child')).toBeDefined();
  });
});
