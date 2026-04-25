// Smoke test: spectator layout is a metadata-only wrapper that returns its
// children unchanged.
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

const { default: SpectatorLayout } = await import(
  '@/app/(public)/auctions/[id]/spectate/layout'
);

describe('(public)/auctions/[id]/spectate/layout', () => {
  it('returns children verbatim', () => {
    render(
      createElement(
        SpectatorLayout,
        null,
        createElement('div', { 'data-testid': 'child' }, 'spectate child'),
      ) as unknown as React.ReactElement,
    );
    expect(screen.getByTestId('child')).toBeDefined();
  });
});
