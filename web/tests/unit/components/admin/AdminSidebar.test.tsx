import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminSidebar } from '@/components/admin/AdminSidebar';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}));

const { usePathname } = await import('next/navigation');

describe('AdminSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePathname).mockReturnValue('/admin');
  });

  it('renders all primary admin nav items', () => {
    render(createElement(AdminSidebar));
    expect(screen.getByRole('navigation', { name: /admin navigation/i })).toBeDefined();

    expect(screen.getByRole('link', { name: /overview/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /users/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /verification/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /jobs/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /disputes/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /reviews/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /fraud/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /payments/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /advances/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /guarantee/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /taxonomy/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /challenges/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /feature flags/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /platform/i })).toBeDefined();
  });

  it('marks Overview as the active link when pathname is /admin', () => {
    vi.mocked(usePathname).mockReturnValue('/admin');
    render(createElement(AdminSidebar));
    const overview = screen.getByRole('link', { name: /overview/i });
    expect(overview.getAttribute('aria-current')).toBe('page');
  });

  it('marks the matching link as active for sub-pages', () => {
    vi.mocked(usePathname).mockReturnValue('/admin/fraud/123');
    render(createElement(AdminSidebar));
    const fraud = screen.getByRole('link', { name: /fraud/i });
    expect(fraud.getAttribute('aria-current')).toBe('page');
  });
});
