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
});
