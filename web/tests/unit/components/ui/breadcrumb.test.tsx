import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Breadcrumb } from '@/components/ui/breadcrumb';

describe('Breadcrumb', () => {
  it('renders all item labels', () => {
    render(
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Jobs', href: '/jobs' },
          { label: 'Detail' },
        ]}
      />,
    );
    expect(screen.getByText('Home')).toBeDefined();
    expect(screen.getByText('Jobs')).toBeDefined();
    expect(screen.getByText('Detail')).toBeDefined();
  });

  it('renders middle items as anchor links', () => {
    render(
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Detail' },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/');
  });

  it('marks the last item with aria-current', () => {
    render(
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Detail' },
        ]}
      />,
    );
    expect(screen.getByText('Detail').getAttribute('aria-current')).toBe('page');
  });

  it('exposes a Breadcrumb landmark', () => {
    render(<Breadcrumb items={[{ label: 'Home' }]} />);
    expect(screen.getByLabelText('Breadcrumb')).toBeDefined();
  });

  it('renders non-last items without an href as muted-foreground spans (not links)', () => {
    render(
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Section' },
          { label: 'Detail' },
        ]}
      />,
    );
    const section = screen.getByText('Section');
    // Should be a span, not a link.
    expect(section.tagName).toBe('SPAN');
    // Non-last: no aria-current=page should be set.
    expect(section.getAttribute('aria-current')).toBeNull();
    expect(section.className).toContain('text-muted-foreground');
  });

  it('renders a chevron separator before non-first items', () => {
    const { container } = render(
      <Breadcrumb
        items={[
          { label: 'A' },
          { label: 'B' },
          { label: 'C' },
        ]}
      />,
    );
    // Two chevrons (one before B, one before C) — i.e. items.length - 1.
    const chevrons = container.querySelectorAll('svg');
    expect(chevrons.length).toBeGreaterThanOrEqual(2);
  });

  it('forwards className to the nav element', () => {
    render(<Breadcrumb items={[{ label: 'Home' }]} className="my-crumbs" />);
    expect(screen.getByLabelText('Breadcrumb').className).toContain('my-crumbs');
  });

  it('renders the last item as a span even if it has an href', () => {
    render(
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Detail', href: '/detail' },
        ]}
      />,
    );
    const detail = screen.getByText('Detail');
    expect(detail.tagName).toBe('SPAN');
    expect(detail.getAttribute('aria-current')).toBe('page');
  });
});
