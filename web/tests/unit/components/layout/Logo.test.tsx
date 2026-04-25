import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href, ...rest }, children),
}));

import { Logo } from '@/components/layout/Logo';

describe('Logo', () => {
  it('renders as a link by default pointing at /', () => {
    render(<Logo />);
    const link = screen.getByLabelText('NoMarkup Home');
    expect(link.getAttribute('href')).toBe('/');
  });

  it('renders without a link when asLink is false', () => {
    const { container } = render(<Logo asLink={false} />);
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders the brand text', () => {
    render(<Logo />);
    expect(screen.getByText('No')).toBeDefined();
    expect(screen.getByText('Markup')).toBeDefined();
  });

  it('applies the custom className', () => {
    render(<Logo asLink={false} className="extra-logo" />);
    expect(screen.getByText('No').className).toContain('extra-logo');
  });

  it('honors the size prop', () => {
    render(<Logo asLink={false} size="lg" />);
    expect(screen.getByText('No').className).toContain('text-3xl');
  });
});
