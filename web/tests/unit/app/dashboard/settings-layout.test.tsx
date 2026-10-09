// Smoke test for the settings layout (tab navigation).
import { render } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/settings/security',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

import SettingsLayout from '@/app/(dashboard)/settings/layout';

describe('SettingsLayout', () => {
  it('renders the settings heading and children', () => {
    const { container } = render(
      withQueryClient(createElement(SettingsLayout, { children: 'CHILD' })),
    );
    expect(container.textContent).toMatch(/Settings/);
    expect(container.textContent).toMatch(/CHILD/);
  });

  it('renders all four settings tabs', () => {
    const { container } = render(
      withQueryClient(createElement(SettingsLayout, { children: 'x' })),
    );
    const links = container.querySelectorAll('a');
    const hrefs = Array.from(links).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/settings/security');
    expect(hrefs).toContain('/settings/notifications');
    expect(hrefs).toContain('/settings/payment-methods');
    expect(hrefs).toContain('/settings/subscription');
  });
});
